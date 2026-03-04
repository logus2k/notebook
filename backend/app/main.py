import asyncio
import logging
import uuid
import socketio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.config import FRONTEND_DIR
from app.routers import notebooks, venvs
from app.managers.kernel_manager import KernelManagerService
from app.managers.execution_bridge import ExecutionBridge
from app.managers.collaboration import CollaborationManager
from app.managers.notebook_manager import NotebookManager
from app.managers.venv_manager import VenvManager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Socket.IO server
sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")

# Managers
kernel_mgr = KernelManagerService()
collab_mgr = CollaborationManager(sio)
execution_bridge = ExecutionBridge(kernel_mgr, sio)
notebook_mgr = NotebookManager()
venv_mgr = VenvManager()

# Track client context: sid -> {project_id, notebook_path, user_name}
client_context: dict[str, dict] = {}

# Pending disconnect cleanup tasks: sid -> asyncio.Task
_pending_disconnects: dict[str, asyncio.Task] = {}

DISCONNECT_GRACE_SECONDS = 15


@asynccontextmanager
async def lifespan(app: FastAPI):
    notebook_mgr.ensure_welcome_notebook()
    await kernel_mgr.start()
    logger.info("Notebook server started")
    yield
    await kernel_mgr.stop()
    logger.info("Notebook server stopped")


app = FastAPI(title="Notebook Collaboration Platform", lifespan=lifespan)
app.include_router(notebooks.router)
app.include_router(venvs.router)


# --- Socket.IO Events ---

@sio.event
async def connect(sid, environ):
    logger.info(f"Client connected: {sid}")


@sio.event
async def disconnect(sid):
    logger.info(f"Client disconnected: {sid}")
    # Schedule delayed cleanup to allow reconnection
    task = asyncio.create_task(_delayed_disconnect_cleanup(sid))
    _pending_disconnects[sid] = task


async def _delayed_disconnect_cleanup(sid):
    """Wait before cleaning up, allowing the client to reconnect."""
    try:
        await asyncio.sleep(DISCONNECT_GRACE_SECONDS)
        # Grace period expired — client didn't reconnect
        logger.info(f"Disconnect grace period expired for {sid}, cleaning up")
        await collab_mgr.leave_all_rooms(sid)
        session = kernel_mgr.get_session_by_sid(sid)
        if session:
            execution_bridge.stop_iopub_listener(session.session_id)
            await kernel_mgr.stop_kernel(session.session_id)
        client_context.pop(sid, None)
    except asyncio.CancelledError:
        # Reconnection happened — cleanup was cancelled
        logger.info(f"Disconnect cleanup cancelled for {sid} (reconnected)")
    finally:
        _pending_disconnects.pop(sid, None)


# --- Notebook events ---

@sio.on("notebook:open")
async def on_notebook_open(sid, data):
    project_id = data.get("project_id")
    notebook_path = data.get("notebook_path")
    user_name = data.get("user_name", "Anonymous")

    if not project_id or not notebook_path:
        await sio.emit("error", {
            "message": "project_id and notebook_path required",
            "code": "INVALID_REQUEST"
        }, to=sid)
        return

    # Check for pending disconnects from same user (reconnection scenario).
    # Transfer kernel session and cancel cleanup.
    for old_sid, ctx in list(client_context.items()):
        if (old_sid != sid and
                ctx.get("project_id") == project_id and
                ctx.get("notebook_path") == notebook_path and
                ctx.get("user_name") == user_name):
            # Cancel pending disconnect cleanup
            pending = _pending_disconnects.get(old_sid)
            if pending:
                pending.cancel()
                _pending_disconnects.pop(old_sid, None)
            # Transfer kernel session to new sid
            session = kernel_mgr.get_session_by_sid(old_sid)
            if session:
                session.client_sid = sid
                logger.info(f"Transferred kernel {session.session_id} from {old_sid} to {sid}")
            # Clean up old context
            await collab_mgr.leave_all_rooms(old_sid)
            client_context.pop(old_sid, None)

    client_context[sid] = {
        "project_id": project_id,
        "notebook_path": notebook_path,
        "user_name": user_name
    }

    await collab_mgr.join_room(sid, project_id, notebook_path, user_name)

    try:
        nb = notebook_mgr.get_notebook(project_id, notebook_path)
        wire_nb = notebook_mgr.prepare_for_wire(nb)
        room_state = collab_mgr.get_room_state(project_id, notebook_path)
        await sio.emit("notebook:state", {
            "notebook": wire_nb,
            "locks": room_state["cell_locks"],
            "connected_users": room_state["clients"]
        }, to=sid)

        # If kernel was transferred, notify about its status
        session = kernel_mgr.get_session_by_sid(sid)
        if session:
            await sio.emit("kernel:status", {"status": session.status}, to=sid)
    except FileNotFoundError:
        await sio.emit("error", {
            "message": f"Notebook not found: {notebook_path}",
            "code": "NOT_FOUND"
        }, to=sid)


@sio.on("notebook:close")
async def on_notebook_close(sid, data):
    ctx = client_context.get(sid, {})
    project_id = ctx.get("project_id", data.get("project_id"))
    notebook_path = ctx.get("notebook_path", data.get("notebook_path"))
    if project_id and notebook_path:
        await collab_mgr.leave_room(sid, project_id, notebook_path)
    client_context.pop(sid, None)


@sio.on("notebook:save")
async def on_notebook_save(sid, data):
    ctx = client_context.get(sid, {})
    project_id = ctx.get("project_id")
    notebook_path = ctx.get("notebook_path")
    content = data.get("content")

    if not project_id or not notebook_path or not content:
        await sio.emit("error", {
            "message": "Missing save data", "code": "INVALID_REQUEST"
        }, to=sid)
        return

    try:
        notebook_mgr.update_notebook(project_id, notebook_path, content)
        room_id = f"notebook:{project_id}:{notebook_path}"
        await sio.emit("notebook:saved", {"success": True}, room=room_id)
    except Exception as e:
        await sio.emit("notebook:saved", {
            "success": False, "error": str(e)
        }, to=sid)


# --- Cell events ---

@sio.on("cell:lock")
async def on_cell_lock(sid, data):
    ctx = client_context.get(sid, {})
    success = await collab_mgr.acquire_lock(
        sid, ctx.get("project_id", ""), ctx.get("notebook_path", ""),
        data.get("cell_index", -1), ctx.get("user_name", "Anonymous")
    )
    if not success:
        await sio.emit("error", {
            "message": "Cell is locked by another user", "code": "LOCK_DENIED"
        }, to=sid)


@sio.on("cell:unlock")
async def on_cell_unlock(sid, data):
    ctx = client_context.get(sid, {})
    await collab_mgr.release_lock(
        sid, ctx.get("project_id", ""), ctx.get("notebook_path", ""),
        data.get("cell_index", -1)
    )


@sio.on("cell:update")
async def on_cell_update(sid, data):
    ctx = client_context.get(sid, {})
    await collab_mgr.broadcast_cell_update(
        sid, ctx.get("project_id", ""), ctx.get("notebook_path", ""),
        data.get("cell_index"), data.get("source", "")
    )


@sio.on("cell:add")
async def on_cell_add(sid, data):
    ctx = client_context.get(sid, {})
    cell_id = data.get("cell_id", str(uuid.uuid4())[:8])
    await collab_mgr.broadcast_cell_add(
        sid, ctx.get("project_id", ""), ctx.get("notebook_path", ""),
        data.get("cell_index"), data.get("cell_type", "code"), cell_id
    )


@sio.on("cell:delete")
async def on_cell_delete(sid, data):
    ctx = client_context.get(sid, {})
    await collab_mgr.broadcast_cell_delete(
        sid, ctx.get("project_id", ""), ctx.get("notebook_path", ""),
        data.get("cell_index")
    )


@sio.on("cell:move")
async def on_cell_move(sid, data):
    ctx = client_context.get(sid, {})
    await collab_mgr.broadcast_cell_move(
        sid, ctx.get("project_id", ""), ctx.get("notebook_path", ""),
        data.get("from_index"), data.get("to_index")
    )


@sio.on("cell:execute")
async def on_cell_execute(sid, data):
    ctx = client_context.get(sid, {})
    logger.info(f"Cell execute request from {sid}, cell_index={data.get('cell_index')}")
    session = kernel_mgr.get_session_by_sid(sid)
    if not session:
        logger.warning(f"No kernel session for {sid}")
        await sio.emit("error", {
            "message": "No active kernel. Start a kernel first.",
            "code": "NO_KERNEL"
        }, to=sid)
        return

    logger.info(f"Using kernel session {session.session_id}, alive={session.kernel_manager.is_alive()}")
    room_id = f"notebook:{ctx['project_id']}:{ctx['notebook_path']}"
    # Fire and forget — don't block the event handler so other events can be processed
    asyncio.create_task(execution_bridge.execute_cell(
        session.session_id, data.get("cell_index"), data.get("code", ""), room_id
    ))


# --- Kernel events ---

@sio.on("kernel:start")
async def on_kernel_start(sid, data):
    ctx = client_context.get(sid, {})
    venv_ref = data.get("venv_ref", {})
    venv_type = venv_ref.get("type", "project")
    venv_name = venv_ref.get("name", "default")

    try:
        project_id = ctx.get("project_id")
        if venv_type == "default":
            python_path = venv_mgr.get_python_path(venv_name)
        elif venv_type == "project":
            python_path = venv_mgr.get_python_path(venv_name, project_id)
        else:
            python_path = venv_mgr.get_python_path(venv_name)

        session_id = f"{sid}_{uuid.uuid4().hex[:8]}"
        await kernel_mgr.start_kernel(
            session_id, python_path,
            project_id, ctx.get("notebook_path", ""), sid
        )
        room_id = f"notebook:{project_id}:{ctx.get('notebook_path', '')}"
        await sio.emit("kernel:status", {"status": "idle"}, room=room_id)

    except FileNotFoundError as e:
        await sio.emit("error", {
            "message": str(e), "code": "VENV_NOT_FOUND"
        }, to=sid)
    except Exception as e:
        await sio.emit("error", {
            "message": f"Failed to start kernel: {e}", "code": "KERNEL_ERROR"
        }, to=sid)


@sio.on("kernel:stop")
async def on_kernel_stop(sid, data):
    session = kernel_mgr.get_session_by_sid(sid)
    if session:
        execution_bridge.stop_iopub_listener(session.session_id)
        await kernel_mgr.stop_kernel(session.session_id)
        ctx = client_context.get(sid, {})
        room_id = f"notebook:{ctx.get('project_id', '')}:{ctx.get('notebook_path', '')}"
        await sio.emit("kernel:status", {"status": "dead"}, room=room_id)


@sio.on("kernel:restart")
async def on_kernel_restart(sid, data):
    session = kernel_mgr.get_session_by_sid(sid)
    if session:
        execution_bridge.stop_iopub_listener(session.session_id)
        ctx = client_context.get(sid, {})
        room_id = f"notebook:{ctx.get('project_id', '')}:{ctx.get('notebook_path', '')}"
        await sio.emit("kernel:status", {"status": "starting"}, room=room_id)
        try:
            result = await kernel_mgr.restart_kernel(session.session_id)
            if result:
                await sio.emit("kernel:status", {"status": "idle"}, room=room_id)
            else:
                await sio.emit("kernel:status", {"status": "dead"}, room=room_id)
                await sio.emit("error", {
                    "message": "Kernel restart failed",
                    "code": "RESTART_FAILED"
                }, room=room_id)
        except Exception as e:
            logger.error(f"Kernel restart error: {e}")
            await sio.emit("kernel:status", {"status": "dead"}, room=room_id)
            await sio.emit("error", {
                "message": f"Kernel restart failed: {e}",
                "code": "RESTART_FAILED"
            }, room=room_id)


@sio.on("kernel:interrupt")
async def on_kernel_interrupt(sid, data):
    session = kernel_mgr.get_session_by_sid(sid)
    if session:
        await kernel_mgr.interrupt_kernel(session.session_id)


@sio.on("heartbeat")
async def on_heartbeat(sid, data):
    collab_mgr.renew_locks(sid)
    session = kernel_mgr.get_session_by_sid(sid)
    if session:
        kernel_mgr.heartbeat(session.session_id)


# --- Static files ---

app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/")
async def index():
    return FileResponse(f"{FRONTEND_DIR}/index.html")


# Wrap FastAPI with Socket.IO ASGI app
socket_app = socketio.ASGIApp(sio, other_asgi_app=app)
