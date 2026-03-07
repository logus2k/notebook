import asyncio
import logging
from jupyter_client import KernelClient
from app.managers.kernel_manager import KernelManagerService

logger = logging.getLogger(__name__)


class _CellHandler:
    """Tracks state for a single cell execution."""
    __slots__ = ('cell_index', 'room', 'execution_count', 'done')

    def __init__(self, cell_index: int, room: str):
        self.cell_index = cell_index
        self.room = room
        self.execution_count = None
        self.done = asyncio.Event()


class ExecutionBridge:
    """Bridges Socket.IO events with Jupyter kernel ZMQ channels.

    Uses a single iopub listener per kernel session that dispatches
    messages to the correct cell handler based on parent msg_id.
    """

    def __init__(self, kernel_manager: KernelManagerService, sio):
        self._kernel_manager = kernel_manager
        self._sio = sio
        # session_id -> asyncio.Task running the iopub listener
        self._iopub_tasks: dict[str, asyncio.Task] = {}
        # session_id -> { msg_id: _CellHandler }
        self._pending: dict[str, dict[str, _CellHandler]] = {}

    async def execute_cell(self, session_id: str, cell_index: int,
                           code: str, room: str):
        session = self._kernel_manager.get_session(session_id)
        if not session:
            await self._sio.emit("error", {
                "message": "No active kernel",
                "code": "NO_KERNEL"
            }, room=room)
            return

        kc = await self._kernel_manager.get_kernel_client(session_id)
        if not kc:
            await self._sio.emit("cell:output", {
                "cell_index": cell_index,
                "output": {
                    "output_type": "error",
                    "ename": "KernelError",
                    "evalue": "Kernel is not running or not responding. Try restarting the kernel.",
                    "traceback": ["Kernel is not running or not responding. Try restarting the kernel."]
                }
            }, room=room)
            await self._sio.emit("cell:execute_complete", {
                "cell_index": cell_index,
                "execution_count": None
            }, room=room)
            return

        # Ensure iopub listener is running for this session
        self._ensure_iopub_listener(session_id, kc)

        self._kernel_manager.update_status(session_id, "busy")
        await self._sio.emit("kernel:status", {"status": "busy"}, room=room)

        handler = _CellHandler(cell_index, room)

        try:
            msg_id = kc.execute(code)
            logger.info(f"Execute sent for cell {cell_index}, msg_id={msg_id}")

            # Register handler so the iopub listener can dispatch to it
            self._pending.setdefault(session_id, {})[msg_id] = handler

            # Wait for completion (no timeout — training can take hours)
            try:
                await handler.done.wait()
            finally:
                # Clean up handler
                pending = self._pending.get(session_id, {})
                pending.pop(msg_id, None)

        except Exception as e:
            logger.error(f"Execution error: {e}")
            await self._sio.emit("cell:output", {
                "cell_index": cell_index,
                "output": {
                    "output_type": "error",
                    "ename": type(e).__name__,
                    "evalue": str(e),
                    "traceback": [str(e)]
                }
            }, room=room)
        finally:
            # Always emit cell:execute_complete so the frontend never
            # gets stuck on "Running..." — even if the iopub loop crashed
            # before it could send the status:idle completion signal.
            if not handler.execution_count:
                logger.warning(
                    f"Cell {cell_index} completed without execution_count "
                    f"(iopub listener may have crashed)"
                )
            await self._sio.emit("cell:execute_complete", {
                "cell_index": cell_index,
                "execution_count": handler.execution_count
            }, room=room)

            # If no more pending executions, mark kernel idle
            if not self._pending.get(session_id):
                self._kernel_manager.update_status(session_id, "idle")
                await self._sio.emit("kernel:status", {"status": "idle"}, room=room)

    def _ensure_iopub_listener(self, session_id: str, kc: KernelClient):
        """Start the iopub listener task if not already running."""
        task = self._iopub_tasks.get(session_id)
        if task and not task.done():
            return
        self._pending.setdefault(session_id, {})
        task = asyncio.create_task(self._iopub_loop(session_id, kc))
        self._iopub_tasks[session_id] = task

    async def _iopub_loop(self, session_id: str, kc: KernelClient):
        """Single iopub listener that dispatches messages to cell handlers."""
        logger.info(f"IOPub listener started for session {session_id}")
        try:
            while True:
                try:
                    msg = await asyncio.get_event_loop().run_in_executor(
                        None, lambda: kc.get_iopub_msg(timeout=60)
                    )
                except Exception:
                    # Timeout with no message — check if we should keep running
                    if not self._pending.get(session_id):
                        logger.info(f"IOPub listener idle, stopping for session {session_id}")
                        break
                    continue

                # Process each message in its own try/except so one bad
                # message never kills the listener (e.g. serialization
                # errors on large display_data payloads).
                try:
                    await self._dispatch_iopub_msg(session_id, msg)
                except Exception as e:
                    parent_msg_id = msg.get("parent_header", {}).get("msg_id")
                    msg_type = msg.get("msg_type", "")
                    logger.error(
                        f"Error dispatching IOPub {msg_type} for session "
                        f"{session_id}, parent={parent_msg_id}: {e}",
                        exc_info=True,
                    )

        except asyncio.CancelledError:
            logger.info(f"IOPub listener cancelled for session {session_id}")
        except Exception as e:
            logger.error(f"IOPub listener fatal error for session {session_id}: {e}", exc_info=True)
            # Signal all pending handlers so they don't hang
            for handler in list(self._pending.get(session_id, {}).values()):
                handler.done.set()
        finally:
            self._iopub_tasks.pop(session_id, None)

    async def _dispatch_iopub_msg(self, session_id: str, msg: dict):
        """Dispatch a single iopub message to the appropriate cell handler."""
        parent_msg_id = msg.get("parent_header", {}).get("msg_id")
        msg_type = msg.get("msg_type", "")
        content = msg.get("content", {})

        # Find the handler for this message
        pending = self._pending.get(session_id, {})
        handler = pending.get(parent_msg_id)
        if not handler:
            return

        cell_index = handler.cell_index
        room = handler.room
        logger.info(f"IOPub msg: type={msg_type}, cell={cell_index}")

        if msg_type == "execute_input":
            handler.execution_count = content.get("execution_count")

        elif msg_type == "stream":
            await self._sio.emit("cell:output", {
                "cell_index": cell_index,
                "output": {
                    "output_type": "stream",
                    "name": content.get("name", "stdout"),
                    "text": content.get("text", "")
                }
            }, room=room)

        elif msg_type == "display_data":
            transient = content.get("transient", {}) or msg.get("transient", {})
            await self._sio.emit("cell:output", {
                "cell_index": cell_index,
                "output": {
                    "output_type": "display_data",
                    "data": content.get("data", {}),
                    "metadata": content.get("metadata", {}),
                    "transient": transient
                }
            }, room=room)

        elif msg_type == "execute_result":
            handler.execution_count = content.get("execution_count")
            await self._sio.emit("cell:output", {
                "cell_index": cell_index,
                "output": {
                    "output_type": "execute_result",
                    "data": content.get("data", {}),
                    "metadata": content.get("metadata", {}),
                    "execution_count": handler.execution_count
                }
            }, room=room)

        elif msg_type == "error":
            await self._sio.emit("cell:output", {
                "cell_index": cell_index,
                "output": {
                    "output_type": "error",
                    "ename": content.get("ename", ""),
                    "evalue": content.get("evalue", ""),
                    "traceback": content.get("traceback", [])
                }
            }, room=room)

        elif msg_type == "update_display_data":
            await self._sio.emit("cell:output", {
                "cell_index": cell_index,
                "output": {
                    "output_type": "update_display_data",
                    "data": content.get("data", {}),
                    "metadata": content.get("metadata", {}),
                    "transient": content.get("transient", {})
                }
            }, room=room)

        elif msg_type == "clear_output":
            await self._sio.emit("cell:output", {
                "cell_index": cell_index,
                "output": {
                    "output_type": "clear_output",
                    "wait": content.get("wait", False)
                }
            }, room=room)

        elif msg_type == "status":
            if content.get("execution_state") == "idle":
                logger.info(f"Execution complete for cell {cell_index}, session {session_id}")
                handler.done.set()

    def stop_iopub_listener(self, session_id: str):
        task = self._iopub_tasks.pop(session_id, None)
        if task:
            task.cancel()
        # Signal all pending handlers
        for handler in list(self._pending.pop(session_id, {}).values()):
            handler.done.set()
