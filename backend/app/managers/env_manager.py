import os
import json
import asyncio
import shutil
import logging
from typing import Optional
from app.config import ENVIRONMENTS_DIR, RUNTIMES_DIR

logger = logging.getLogger(__name__)


class RuntimeRegistry:
    """Discovers available runtimes from data/runtimes/{language}/{version}/runtime.json."""

    def __init__(self, runtimes_dir: str = RUNTIMES_DIR):
        self._runtimes_dir = runtimes_dir
        self._cache: dict[str, dict] = {}  # key: "language/version"
        self._loaded = False

    def _load(self):
        self._cache.clear()
        if not os.path.exists(self._runtimes_dir):
            self._loaded = True
            return
        required_keys = (
            "language", "version", "display_name", "executable",
            "env_create_cmd", "kernel_cmd", "kernel_language",
        )
        for language in sorted(os.listdir(self._runtimes_dir)):
            lang_dir = os.path.join(self._runtimes_dir, language)
            if not os.path.isdir(lang_dir):
                continue
            for version in sorted(os.listdir(lang_dir)):
                ver_dir = os.path.join(lang_dir, version)
                runtime_file = os.path.join(ver_dir, "runtime.json")
                if not os.path.isfile(runtime_file):
                    continue
                try:
                    with open(runtime_file) as f:
                        spec = json.load(f)
                    if not all(k in spec for k in required_keys):
                        logger.warning(f"Skipping incomplete runtime: {runtime_file}")
                        continue
                    self._cache[f"{language}/{version}"] = spec
                except (json.JSONDecodeError, OSError) as e:
                    logger.warning(f"Failed to load runtime {runtime_file}: {e}")
        self._loaded = True
        logger.info(f"Loaded {len(self._cache)} runtimes: {list(self._cache.keys())}")

    def list_runtimes(self) -> list[dict]:
        if not self._loaded:
            self._load()
        return [
            {
                "language": spec["language"],
                "version": spec["version"],
                "display_name": spec["display_name"],
                "runtime_id": f"{spec['language']}/{spec['version']}",
            }
            for spec in self._cache.values()
        ]

    def get_runtime(self, runtime_id: str) -> Optional[dict]:
        if not self._loaded:
            self._load()
        return self._cache.get(runtime_id)

    def resolve_template(self, template: list[str], **kwargs) -> list[str]:
        result = []
        for part in template:
            for key, value in kwargs.items():
                part = part.replace(f"{{{key}}}", value)
            result.append(part)
        return result


class EnvironmentManager:
    """Manages environments across all runtime types. Language-agnostic."""

    def __init__(self, environments_dir: str = ENVIRONMENTS_DIR,
                 registry: Optional[RuntimeRegistry] = None):
        self._environments_dir = environments_dir
        self._registry = registry or RuntimeRegistry()
        self._migrate_flat_environments()

    def _migrate_flat_environments(self):
        """Move old flat data/environments/{name} to data/environments/python/3.12/{name}."""
        if not os.path.exists(self._environments_dir):
            return
        default_runtime = "python/3.12"
        for item in os.listdir(self._environments_dir):
            item_path = os.path.join(self._environments_dir, item)
            if not os.path.isdir(item_path):
                continue
            # Old flat env: has bin/python directly (even if symlink is broken)
            if os.path.lexists(os.path.join(item_path, "bin", "python")):
                target_dir = os.path.join(self._environments_dir, default_runtime)
                os.makedirs(target_dir, exist_ok=True)
                target_path = os.path.join(target_dir, item)
                if not os.path.exists(target_path):
                    try:
                        shutil.move(item_path, target_path)
                        logger.info(f"Migrated environment '{item}' to {default_runtime}/{item}")
                    except OSError as e:
                        logger.warning(f"Failed to migrate environment '{item}': {e}")

    def _validate_name(self, name: str):
        if ".." in name or "/" in name or "\\" in name or not name:
            raise ValueError("Invalid environment name")

    def _env_path(self, runtime_id: str, name: str) -> str:
        return os.path.join(self._environments_dir, runtime_id, name)

    def list_envs(self) -> list[dict]:
        envs = []
        if not os.path.exists(self._environments_dir):
            return envs
        for language in sorted(os.listdir(self._environments_dir)):
            lang_dir = os.path.join(self._environments_dir, language)
            if not os.path.isdir(lang_dir):
                continue
            # Skip un-migrated flat envs (have bin/python at top level)
            if os.path.lexists(os.path.join(lang_dir, "bin", "python")):
                continue
            for version in sorted(os.listdir(lang_dir)):
                ver_dir = os.path.join(lang_dir, version)
                if not os.path.isdir(ver_dir):
                    continue
                runtime_id = f"{language}/{version}"
                runtime = self._registry.get_runtime(runtime_id)
                for env_name in sorted(os.listdir(ver_dir)):
                    env_path = os.path.join(ver_dir, env_name)
                    if not os.path.isdir(env_path):
                        continue
                    envs.append({
                        "name": env_name,
                        "runtime_id": runtime_id,
                        "language": language,
                        "version": version,
                        "display_name": runtime["display_name"] if runtime else f"{language} {version}",
                    })
        return envs

    async def create_env(self, runtime_id: str, name: str,
                         requirements: Optional[list[str]] = None) -> dict:
        self._validate_name(name)
        runtime = self._registry.get_runtime(runtime_id)
        if not runtime:
            raise ValueError(f"Unknown runtime: {runtime_id}")

        env_path = self._env_path(runtime_id, name)
        if os.path.exists(env_path):
            raise FileExistsError(f"Environment already exists: {name}")

        os.makedirs(os.path.dirname(env_path), exist_ok=True)

        # Run create command
        create_cmd = self._registry.resolve_template(
            runtime["env_create_cmd"],
            executable=runtime["executable"],
            env_path=env_path,
        )
        proc = await asyncio.create_subprocess_exec(
            *create_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            if os.path.exists(env_path):
                shutil.rmtree(env_path)
            raise RuntimeError(f"Failed to create environment: {stderr.decode()}")

        # Run post-create commands (e.g., install ipykernel)
        for post_cmd_template in runtime.get("env_post_create_cmds", []):
            post_cmd = self._registry.resolve_template(
                post_cmd_template,
                executable=runtime["executable"],
                env_path=env_path,
            )
            proc = await asyncio.create_subprocess_exec(
                *post_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()
            if proc.returncode != 0:
                shutil.rmtree(env_path)
                raise RuntimeError(f"Post-create step failed: {stderr.decode()}")

        # Install additional packages if requested
        if requirements:
            await self.install_packages(runtime_id, name, requirements)

        return {"name": name, "runtime_id": runtime_id, "created": True}

    async def delete_env(self, runtime_id: str, name: str) -> dict:
        self._validate_name(name)
        env_path = self._env_path(runtime_id, name)
        if not os.path.exists(env_path):
            raise FileNotFoundError(f"Environment not found: {name}")
        shutil.rmtree(env_path)
        return {"name": name, "runtime_id": runtime_id, "deleted": True}

    def get_kernel_cmd(self, runtime_id: str, name: str) -> tuple[list[str], str]:
        """Returns (kernel_cmd, kernel_language) for starting a kernel."""
        runtime = self._registry.get_runtime(runtime_id)
        if not runtime:
            raise ValueError(f"Unknown runtime: {runtime_id}")
        env_path = self._env_path(runtime_id, name)
        if not os.path.exists(env_path):
            raise FileNotFoundError(f"Environment not found: {name}")
        kernel_cmd = self._registry.resolve_template(
            runtime["kernel_cmd"],
            env_path=env_path,
            executable=runtime["executable"],
        )
        return kernel_cmd, runtime["kernel_language"]

    async def list_packages(self, runtime_id: str, name: str) -> list[dict]:
        runtime = self._registry.get_runtime(runtime_id)
        if not runtime or "package_manager" not in runtime:
            raise ValueError(f"No package manager for runtime: {runtime_id}")
        env_path = self._env_path(runtime_id, name)
        if not os.path.exists(env_path):
            raise FileNotFoundError(f"Environment not found: {name}")
        pm = runtime["package_manager"]
        cmd = self._registry.resolve_template(
            pm["list_cmd"],
            env_path=env_path,
            executable=runtime["executable"],
        )
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(f"Failed to list packages: {stderr.decode()}")
        return json.loads(stdout.decode())

    async def install_packages(self, runtime_id: str, name: str,
                               packages: list[str]) -> dict:
        runtime = self._registry.get_runtime(runtime_id)
        if not runtime or "package_manager" not in runtime:
            raise ValueError(f"No package manager for runtime: {runtime_id}")
        env_path = self._env_path(runtime_id, name)
        if not os.path.exists(env_path):
            raise FileNotFoundError(f"Environment not found: {name}")
        pm = runtime["package_manager"]
        cmd = self._registry.resolve_template(
            pm["install_cmd"],
            env_path=env_path,
            executable=runtime["executable"],
        )
        proc = await asyncio.create_subprocess_exec(
            *cmd, *packages,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(
                f"pip install failed:\n{stderr.decode()}\n{stdout.decode()}"
            )
        return {"installed": packages, "output": stdout.decode()}

    async def remove_packages(self, runtime_id: str, name: str,
                              packages: list[str]) -> dict:
        runtime = self._registry.get_runtime(runtime_id)
        if not runtime or "package_manager" not in runtime:
            raise ValueError(f"No package manager for runtime: {runtime_id}")
        env_path = self._env_path(runtime_id, name)
        if not os.path.exists(env_path):
            raise FileNotFoundError(f"Environment not found: {name}")
        pm = runtime["package_manager"]
        cmd = self._registry.resolve_template(
            pm["remove_cmd"],
            env_path=env_path,
            executable=runtime["executable"],
        )
        proc = await asyncio.create_subprocess_exec(
            *cmd, *packages,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(f"Failed to remove packages: {stderr.decode()}")
        return {"removed": packages, "output": stdout.decode()}
