import asyncio
import logging
from jupyter_client import KernelClient
from app.managers.kernel_manager import KernelManagerService

logger = logging.getLogger(__name__)


class ExecutionBridge:
    """Bridges Socket.IO events with Jupyter kernel ZMQ channels."""

    def __init__(self, kernel_manager: KernelManagerService, sio):
        self._kernel_manager = kernel_manager
        self._sio = sio
        self._iopub_tasks: dict[str, asyncio.Task] = {}

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

        self._kernel_manager.update_status(session_id, "busy")
        await self._sio.emit("kernel:status", {"status": "busy"}, room=room)

        try:
            msg_id = kc.execute(code)
            logger.info(f"Execute sent for cell {cell_index}, msg_id={msg_id}")
            await self._listen_for_outputs(kc, msg_id, session_id, cell_index, room)
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
            self._kernel_manager.update_status(session_id, "idle")
            await self._sio.emit("kernel:status", {"status": "idle"}, room=room)
            try:
                kc.stop_channels()
            except Exception:
                pass

    async def _listen_for_outputs(self, kc: KernelClient, msg_id: str,
                                  session_id: str, cell_index: int, room: str):
        execution_count = None
        logger.info(f"IOPub listener started for session {session_id}, cell {cell_index}, msg_id={msg_id}")
        while True:
            try:
                msg = await asyncio.get_event_loop().run_in_executor(
                    None, lambda: kc.get_iopub_msg(timeout=30)
                )
            except Exception as e:
                logger.warning(f"IOPub timeout/error for session {session_id}, cell {cell_index}: {e}")
                await self._sio.emit("cell:execute_complete", {
                    "cell_index": cell_index,
                    "execution_count": execution_count
                }, room=room)
                break

            parent_msg_id = msg.get("parent_header", {}).get("msg_id")
            msg_type = msg.get("msg_type", "")
            if parent_msg_id != msg_id:
                logger.debug(f"IOPub skipping msg_type={msg_type} (parent={parent_msg_id}, expected={msg_id})")
                continue

            msg_type = msg.get("msg_type", "")
            content = msg.get("content", {})

            if msg_type == "stream":
                await self._sio.emit("cell:output", {
                    "cell_index": cell_index,
                    "output": {
                        "output_type": "stream",
                        "name": content.get("name", "stdout"),
                        "text": content.get("text", "")
                    }
                }, room=room)

            elif msg_type == "display_data":
                await self._sio.emit("cell:output", {
                    "cell_index": cell_index,
                    "output": {
                        "output_type": "display_data",
                        "data": content.get("data", {}),
                        "metadata": content.get("metadata", {})
                    }
                }, room=room)

            elif msg_type == "execute_result":
                execution_count = content.get("execution_count")
                await self._sio.emit("cell:output", {
                    "cell_index": cell_index,
                    "output": {
                        "output_type": "execute_result",
                        "data": content.get("data", {}),
                        "metadata": content.get("metadata", {}),
                        "execution_count": execution_count
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

            elif msg_type == "status":
                logger.info(f"IOPub status: {content.get('execution_state')} for cell {cell_index}")
                if content.get("execution_state") == "idle":
                    logger.info(f"Execution complete for cell {cell_index}, session {session_id}")
                    await self._sio.emit("cell:execute_complete", {
                        "cell_index": cell_index,
                        "execution_count": execution_count
                    }, room=room)
                    break

    def stop_iopub_listener(self, session_id: str):
        task = self._iopub_tasks.pop(session_id, None)
        if task:
            task.cancel()
