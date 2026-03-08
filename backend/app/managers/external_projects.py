import os
import re
from app.config import DATA_DIR


class ExternalProjectsConfig:
    """Singleton that parses projects.txt at startup and holds external project data in memory."""

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._loaded = False
        return cls._instance

    def __init__(self):
        if not self._loaded:
            self._projects: dict[str, list[str]] = {}
            self._load()
            self._loaded = True

    def _load(self):
        conf_path = os.path.join(DATA_DIR, "projects.txt")
        if not os.path.isfile(conf_path):
            return

        current_project = None
        with open(conf_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                m = re.match(r"^\[(.+)\]$", line)
                if m:
                    current_project = m.group(1)
                    if current_project not in self._projects:
                        self._projects[current_project] = []
                    continue
                if current_project is None:
                    continue
                # Strip trailing /* (recursive marker) — we only care about the base path
                path = re.sub(r"/\*$", "", line)
                if os.path.isdir(path):
                    self._projects[current_project].append(path)

    def is_external(self, project_id: str) -> bool:
        return project_id in self._projects

    def get_paths(self, project_id: str) -> list[str]:
        return list(self._projects.get(project_id, []))

    def all_external_projects(self) -> dict[str, list[str]]:
        return dict(self._projects)
