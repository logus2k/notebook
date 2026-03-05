import os
import sys
import json
import asyncio
import shutil
from typing import Optional
from app.config import ENVIRONMENTS_DIR


class VenvManager:
    """Manages Python virtual environments in a single flat directory."""

    def _validate_name(self, name: str):
        if ".." in name or "/" in name or "\\" in name or not name:
            raise ValueError("Invalid environment name")

    def _venv_path(self, name: str) -> str:
        return os.path.join(ENVIRONMENTS_DIR, name)

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

    def get_python_path(self, name: str) -> str:
        venv_path = self._venv_path(name)
        python_path = os.path.join(venv_path, "bin", "python")
        if not os.path.exists(python_path):
            raise FileNotFoundError(f"Environment not found: {name}")
        return python_path

    def list_envs(self) -> list[dict]:
        envs = []
        if not os.path.exists(ENVIRONMENTS_DIR):
            return envs
        for name in sorted(os.listdir(ENVIRONMENTS_DIR)):
            venv_path = os.path.join(ENVIRONMENTS_DIR, name)
            python_path = os.path.join(venv_path, "bin", "python")
            if os.path.isdir(venv_path) and os.path.exists(python_path):
                version = self._get_python_version(venv_path)
                envs.append({
                    "name": name,
                    "python_version": version,
                })
        return envs

    async def create_env(self, name: str,
                         requirements: Optional[list[str]] = None) -> dict:
        self._validate_name(name)
        venv_path = self._venv_path(name)
        python_path = os.path.join(venv_path, "bin", "python")

        if os.path.exists(venv_path):
            if os.path.exists(python_path):
                raise FileExistsError(f"Environment already exists: {name}")
            # Broken leftover from a failed creation
            shutil.rmtree(venv_path)

        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "venv", venv_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            if os.path.exists(venv_path):
                shutil.rmtree(venv_path)
            raise RuntimeError(f"Failed to create environment: {stderr.decode()}")

        # Install ipykernel so jupyter_client can use this env
        pip_path = os.path.join(venv_path, "bin", "pip")
        proc = await asyncio.create_subprocess_exec(
            pip_path, "install", "ipykernel",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            shutil.rmtree(venv_path)
            raise RuntimeError(
                f"Failed to install ipykernel: {stderr.decode()}"
            )

        if requirements:
            await self.install_packages(name, requirements)

        return {"name": name, "created": True}

    async def delete_env(self, name: str) -> dict:
        self._validate_name(name)
        venv_path = self._venv_path(name)
        if not os.path.exists(venv_path):
            raise FileNotFoundError(f"Environment not found: {name}")
        shutil.rmtree(venv_path)
        return {"name": name, "deleted": True}

    def _get_pip_path(self, name: str) -> str:
        pip_path = os.path.join(self._venv_path(name), "bin", "pip")
        if not os.path.exists(pip_path):
            raise FileNotFoundError(f"Environment not found: {name}")
        return pip_path

    async def list_packages(self, name: str) -> list[dict]:
        self._validate_name(name)
        pip_path = self._get_pip_path(name)

        proc = await asyncio.create_subprocess_exec(
            pip_path, "list", "--format=json",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(f"Failed to list packages: {stderr.decode()}")
        return json.loads(stdout.decode())

    async def install_packages(self, name: str, packages: list[str]) -> dict:
        self._validate_name(name)
        pip_path = self._get_pip_path(name)

        proc = await asyncio.create_subprocess_exec(
            pip_path, "install", *packages,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(
                f"pip install failed:\n{stderr.decode()}\n{stdout.decode()}"
            )
        return {"installed": packages, "output": stdout.decode()}

    async def remove_packages(self, name: str, packages: list[str]) -> dict:
        self._validate_name(name)
        pip_path = self._get_pip_path(name)

        proc = await asyncio.create_subprocess_exec(
            pip_path, "uninstall", "-y", *packages,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(f"Failed to remove packages: {stderr.decode()}")
        return {"removed": packages, "output": stdout.decode()}
