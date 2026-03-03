import os
import sys
import json
import asyncio
import shutil
import platform
from typing import Optional
from app.config import PROJECTS_DIR, SHARED_VENVS_DIR

DEFAULT_ENV_NAME = "Default"


class VenvManager:
    """Manages Python virtual environments and their packages."""

    def _project_venvs_dir(self, project_id: str) -> str:
        return os.path.join(PROJECTS_DIR, project_id, "venvs")

    def _resolve_venv_path(self, name: str, project_id: Optional[str] = None) -> str:
        if project_id:
            return os.path.join(self._project_venvs_dir(project_id), name)
        return os.path.join(SHARED_VENVS_DIR, name)

    @staticmethod
    def is_default(name: str) -> bool:
        return name == DEFAULT_ENV_NAME

    def _default_env_entry(self) -> dict:
        return {
            "name": DEFAULT_ENV_NAME,
            "path": None,
            "python": sys.executable,
            "python_version": platform.python_version(),
            "type": "default",
            "readonly": True,
        }

    def _validate_name(self, name: str):
        if ".." in name or "/" in name or "\\" in name or not name:
            raise ValueError("Invalid venv name")

    def _get_python_version(self, venv_path: str) -> Optional[str]:
        """Read Python version from pyvenv.cfg."""
        cfg = os.path.join(venv_path, "pyvenv.cfg")
        if not os.path.exists(cfg):
            return None
        try:
            with open(cfg) as f:
                for line in f:
                    key, _, val = line.partition("=")
                    if key.strip().lower() == "version":
                        return val.strip()
        except OSError:
            pass
        return None

    def get_python_path(self, name: str, project_id: Optional[str] = None) -> str:
        if self.is_default(name):
            return sys.executable
        venv_path = self._resolve_venv_path(name, project_id)
        python_path = os.path.join(venv_path, "bin", "python")
        if not os.path.exists(python_path):
            raise FileNotFoundError(f"Venv not found: {name}")
        return python_path

    def list_venvs(self, project_id: Optional[str] = None,
                   include_default: bool = False) -> list[dict]:
        if project_id:
            base_dir = self._project_venvs_dir(project_id)
        else:
            base_dir = SHARED_VENVS_DIR
        venvs = []
        if include_default:
            venvs.append(self._default_env_entry())
        if not os.path.exists(base_dir):
            return venvs
        for name in sorted(os.listdir(base_dir)):
            venv_path = os.path.join(base_dir, name)
            python_path = os.path.join(venv_path, "bin", "python")
            if os.path.isdir(venv_path) and os.path.exists(python_path):
                version = self._get_python_version(venv_path)
                venvs.append({
                    "name": name,
                    "path": venv_path,
                    "python": python_path,
                    "python_version": version,
                    "type": "project" if project_id else "shared"
                })
        return venvs

    async def create_venv(self, name: str, project_id: Optional[str] = None,
                          requirements: Optional[list[str]] = None) -> dict:
        self._validate_name(name)
        venv_path = self._resolve_venv_path(name, project_id)
        python_path = os.path.join(venv_path, "bin", "python")

        if os.path.exists(venv_path):
            if os.path.exists(python_path):
                raise FileExistsError(f"Venv already exists: {name}")
            # Broken leftover from a failed creation — clean it up
            shutil.rmtree(venv_path)

        os.makedirs(os.path.dirname(venv_path), exist_ok=True)

        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "venv", venv_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            # Clean up partial directory on failure
            if os.path.exists(venv_path):
                shutil.rmtree(venv_path)
            raise RuntimeError(f"Failed to create venv: {stderr.decode()}")

        # Install ipykernel so jupyter_client can use this venv
        pip_path = os.path.join(venv_path, "bin", "pip")
        proc = await asyncio.create_subprocess_exec(
            pip_path, "install", "ipykernel",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        await proc.communicate()

        if requirements:
            await self.install_packages(name, requirements, project_id)

        return {
            "name": name,
            "path": venv_path,
            "type": "project" if project_id else "shared",
            "created": True
        }

    async def delete_venv(self, name: str, project_id: Optional[str] = None) -> dict:
        if self.is_default(name):
            raise ValueError("Cannot delete the Default environment")
        self._validate_name(name)
        venv_path = self._resolve_venv_path(name, project_id)
        if not os.path.exists(venv_path):
            raise FileNotFoundError(f"Venv not found: {name}")
        shutil.rmtree(venv_path)
        return {"name": name, "deleted": True}

    async def list_packages(self, name: str,
                            project_id: Optional[str] = None) -> list[dict]:
        self._validate_name(name)
        pip_path = os.path.join(
            self._resolve_venv_path(name, project_id), "bin", "pip"
        )
        if not os.path.exists(pip_path):
            raise FileNotFoundError(f"Venv not found: {name}")

        proc = await asyncio.create_subprocess_exec(
            pip_path, "list", "--format=json",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(f"Failed to list packages: {stderr.decode()}")
        return json.loads(stdout.decode())

    async def install_packages(self, name: str, packages: list[str],
                               project_id: Optional[str] = None) -> dict:
        self._validate_name(name)
        pip_path = os.path.join(
            self._resolve_venv_path(name, project_id), "bin", "pip"
        )
        if not os.path.exists(pip_path):
            raise FileNotFoundError(f"Venv not found: {name}")

        proc = await asyncio.create_subprocess_exec(
            pip_path, "install", *packages,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(f"Failed to install packages: {stderr.decode()}")
        return {"installed": packages, "output": stdout.decode()}

    async def remove_packages(self, name: str, packages: list[str],
                              project_id: Optional[str] = None) -> dict:
        self._validate_name(name)
        pip_path = os.path.join(
            self._resolve_venv_path(name, project_id), "bin", "pip"
        )
        if not os.path.exists(pip_path):
            raise FileNotFoundError(f"Venv not found: {name}")

        proc = await asyncio.create_subprocess_exec(
            pip_path, "uninstall", "-y", *packages,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(f"Failed to remove packages: {stderr.decode()}")
        return {"removed": packages, "output": stdout.decode()}
