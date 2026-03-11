import asyncio
import logging
import os
from datetime import datetime, timedelta
from typing import Optional
from dataclasses import dataclass, field
from jupyter_client import KernelManager as JupyterKernelManager
from app.config import KERNEL_IDLE_TIMEOUT_SECONDS

logger = logging.getLogger(__name__)


@dataclass
class KernelSession:
    session_id: str
    kernel_manager: JupyterKernelManager
    kernel_cmd: list[str]
    kernel_language: str
    display_name: str
    project_id: str
    notebook_path: str
    client_sid: str
    last_heartbeat: datetime = field(default_factory=datetime.utcnow)
    status: str = "starting"
    _cached_client: object = field(default=None, repr=False)


class KernelManagerService:
    """Manages Jupyter kernel processes."""

    def __init__(self):
        self._kernels: dict[str, KernelSession] = {}
        self._cleanup_task: Optional[asyncio.Task] = None
        self._client_locks: dict[str, asyncio.Lock] = {}

    async def start(self):
        self._cleanup_task = asyncio.create_task(self._idle_cleanup_loop())

    async def stop(self):
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
        for session_id in list(self._kernels.keys()):
            await self.stop_kernel(session_id)

    async def start_kernel(self, session_id: str, kernel_cmd: list[str],
                           kernel_language: str, display_name: str,
                           project_id: str, notebook_path: str,
                           client_sid: str) -> KernelSession:
        if session_id in self._kernels:
            await self.stop_kernel(session_id)

        km = JupyterKernelManager(kernel_name="python3")

        # Bypass kernel spec lookup by providing the command directly.
        km.kernel_cmd = kernel_cmd

        # Provide a minimal kernel spec so the manager doesn't try to
        # look one up from disk.
        from jupyter_client.kernelspec import KernelSpec
        km._kernel_spec = KernelSpec(
            argv=kernel_cmd,
            display_name=display_name,
            language=kernel_language,
        )

        # Set kernel working directory to the project's notebooks folder
        from app.config import PROJECTS_DIR
        kernel_cwd = os.path.join(PROJECTS_DIR, project_id, "notebooks") if project_id else None
        if not kernel_cwd or not os.path.isdir(kernel_cwd):
            kernel_cwd = None

        # Build a clean environment for the kernel subprocess.
        # The server process may lack GPU library paths, so we ensure
        # CUDA/WSL driver paths are included in LD_LIBRARY_PATH.
        kernel_env = os.environ.copy()
        gpu_lib_paths = [
            "/usr/lib/wsl/lib",
            "/usr/local/cuda/lib64",
        ]
        existing_ld = kernel_env.get("LD_LIBRARY_PATH", "")
        extra = ":".join(p for p in gpu_lib_paths if os.path.isdir(p))
        if extra:
            kernel_env["LD_LIBRARY_PATH"] = f"{extra}:{existing_ld}" if existing_ld else extra

        # Run blocking kernel start in executor to avoid blocking the event loop
        kw = {"env": kernel_env}
        if kernel_cwd:
            kw["cwd"] = kernel_cwd
        await asyncio.get_event_loop().run_in_executor(
            None, lambda: km.start_kernel(**kw)
        )

        # Give kernel process a moment to either start or crash
        await asyncio.sleep(1)
        if not km.is_alive():
            logger.error(f"Kernel process died immediately for {session_id}")
            raise RuntimeError(
                f"Kernel process failed to start. Check that the kernel is properly installed in the environment."
            )

        session = KernelSession(
            session_id=session_id,
            kernel_manager=km,
            kernel_cmd=kernel_cmd,
            kernel_language=kernel_language,
            display_name=display_name,
            project_id=project_id,
            notebook_path=notebook_path,
            client_sid=client_sid,
            status="idle",
        )
        self._kernels[session_id] = session
        self._client_locks[session_id] = asyncio.Lock()

        # Eagerly create and cache the kernel client
        kc = km.client()
        kc.start_channels()
        try:
            await asyncio.get_event_loop().run_in_executor(
                None, lambda: kc.wait_for_ready(timeout=15)
            )
            session._cached_client = kc
        except RuntimeError as e:
            logger.warning(f"Kernel client not immediately ready: {e}")
            kc.stop_channels()

        # Run silent init code to configure the kernel environment
        if session._cached_client:
            init_code = (
                "try:\n"
                "    import plotly.io as pio; pio.renderers.default = 'notebook'\n"
                "except Exception:\n"
                "    pass\n"
            )
            session._cached_client.execute(init_code, silent=True, store_history=False)

        logger.info(f"Kernel started: {session_id} ({display_name})")
        return session

    async def stop_kernel(self, session_id: str) -> bool:
        session = self._kernels.pop(session_id, None)
        self._client_locks.pop(session_id, None)
        if not session:
            return False
        try:
            if session._cached_client:
                session._cached_client.stop_channels()
                session._cached_client = None
        except Exception as e:
            logger.error(f"Error stopping kernel client channels {session_id}: {e}")
        try:
            if session.kernel_manager.is_alive():
                # Run blocking shutdown in executor to avoid blocking the event loop
                await asyncio.get_event_loop().run_in_executor(
                    None, lambda: session.kernel_manager.shutdown_kernel(now=True)
                )
            session.kernel_manager.cleanup_resources()
        except Exception as e:
            logger.error(f"Error stopping kernel {session_id}: {e}")
        logger.info(f"Kernel stopped: {session_id}")
        return True

    async def restart_kernel(self, session_id: str) -> Optional[KernelSession]:
        session = self._kernels.get(session_id)
        if not session:
            return None
        await self.stop_kernel(session_id)
        return await self.start_kernel(
            session_id, session.kernel_cmd,
            session.kernel_language, session.display_name,
            session.project_id, session.notebook_path,
            session.client_sid,
        )

    async def interrupt_kernel(self, session_id: str) -> bool:
        session = self._kernels.get(session_id)
        if not session:
            return False
        try:
            session.kernel_manager.interrupt_kernel()
            return True
        except Exception as e:
            logger.error(f"Error interrupting kernel {session_id}: {e}")
            return False

    def get_session(self, session_id: str) -> Optional[KernelSession]:
        return self._kernels.get(session_id)

    def get_session_by_sid(self, client_sid: str) -> Optional[KernelSession]:
        for session in self._kernels.values():
            if session.client_sid == client_sid:
                return session
        return None

    async def get_kernel_client(self, session_id: str):
        session = self._kernels.get(session_id)
        if not session:
            return None
        if not session.kernel_manager.is_alive():
            logger.error(f"Kernel process is not alive for session {session_id}")
            return None
        # Fast path: return cached client without locking
        if session._cached_client and session._cached_client.channels_running:
            return session._cached_client
        # Slow path: create client under lock to prevent concurrent creation
        lock = self._client_locks.get(session_id)
        if not lock:
            return None
        async with lock:
            # Re-check after acquiring lock
            if session._cached_client and session._cached_client.channels_running:
                return session._cached_client
            kc = session.kernel_manager.client()
            kc.start_channels()
            try:
                await asyncio.get_event_loop().run_in_executor(
                    None, lambda: kc.wait_for_ready(timeout=15)
                )
            except RuntimeError as e:
                logger.error(f"Kernel not ready for session {session_id}: {e}")
                kc.stop_channels()
                return None
            session._cached_client = kc
            return kc

    def heartbeat(self, session_id: str):
        session = self._kernels.get(session_id)
        if session:
            session.last_heartbeat = datetime.utcnow()

    def update_status(self, session_id: str, status: str):
        session = self._kernels.get(session_id)
        if session:
            session.status = status

    def list_kernels(self) -> list[dict]:
        return [
            {
                "session_id": s.session_id,
                "project_id": s.project_id,
                "notebook_path": s.notebook_path,
                "client_sid": s.client_sid,
                "status": s.status,
                "last_heartbeat": s.last_heartbeat.isoformat(),
                "alive": s.kernel_manager.is_alive()
            }
            for s in self._kernels.values()
        ]

    async def _idle_cleanup_loop(self):
        while True:
            await asyncio.sleep(60)
            now = datetime.utcnow()
            timeout = timedelta(seconds=KERNEL_IDLE_TIMEOUT_SECONDS)
            expired = [
                sid for sid, session in self._kernels.items()
                if now - session.last_heartbeat > timeout
            ]
            for sid in expired:
                logger.info(f"Idle timeout - stopping kernel: {sid}")
                await self.stop_kernel(sid)
