import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR = os.path.join(BASE_DIR, "data")
PROJECTS_DIR = os.path.join(DATA_DIR, "projects")
SHARED_VENVS_DIR = os.path.join(DATA_DIR, "shared_venvs")
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

KERNEL_IDLE_TIMEOUT_SECONDS = 600
CELL_LOCK_TTL_SECONDS = 60
HEARTBEAT_INTERVAL_SECONDS = 30

DEFAULT_VENV_NAME = "default"
SYSTEM_PYTHON = "/usr/bin/python3"

os.makedirs(PROJECTS_DIR, exist_ok=True)
os.makedirs(SHARED_VENVS_DIR, exist_ok=True)
