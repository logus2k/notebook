import os
import json
import uuid
import hashlib
from typing import Optional
from app.config import PROJECTS_DIR


class NotebookManager:
    """Handles CRUD operations for .ipynb files on disk."""

    def _project_notebooks_dir(self, project_id: str) -> str:
        return os.path.join(PROJECTS_DIR, project_id, "notebooks")

    def _notebook_path(self, project_id: str, notebook_name: str) -> str:
        return os.path.join(self._project_notebooks_dir(project_id), notebook_name)

    def _validate_notebook_name(self, name: str) -> str:
        if ".." in name or "/" in name or "\\" in name:
            raise ValueError("Invalid notebook name")
        if not name.endswith(".ipynb"):
            name += ".ipynb"
        return name

    def _empty_notebook(self, name: str) -> dict:
        return {
            "nbformat": 4,
            "nbformat_minor": 5,
            "metadata": {
                "kernelspec": {
                    "display_name": "Python 3",
                    "language": "python",
                    "name": "python3"
                },
                "language_info": {
                    "name": "python",
                    "version": "3.10.0"
                },
                "venv_ref": {
                    "type": "project",
                    "name": "default"
                }
            },
            "cells": [
                {
                    "cell_type": "code",
                    "id": str(uuid.uuid4())[:8],
                    "metadata": {},
                    "source": [],
                    "outputs": [],
                    "execution_count": None
                }
            ]
        }

    def ensure_welcome_notebook(self) -> tuple[str, str]:
        """Create the Welcome project and notebook if they don't exist.
        Returns (project_id, notebook_name)."""
        project_id = "Examples"
        notebook_name = "Welcome.ipynb"
        project_path = os.path.join(PROJECTS_DIR, project_id)
        notebooks_dir = os.path.join(project_path, "notebooks")
        filepath = os.path.join(notebooks_dir, notebook_name)

        if os.path.exists(filepath):
            return project_id, notebook_name

        os.makedirs(notebooks_dir, exist_ok=True)
        notebook = {
            "nbformat": 4,
            "nbformat_minor": 5,
            "metadata": {
                "kernelspec": {
                    "display_name": "Python 3",
                    "language": "python",
                    "name": "python3"
                },
                "language_info": {"name": "python"}
            },
            "cells": [
                {
                    "cell_type": "markdown",
                    "id": str(uuid.uuid4())[:8],
                    "metadata": {},
                    "source": [
                        "# Welcome to Note!\n",
                        "\n",
                        "Write Python in a **code cell** and press `Shift + Enter` to run it.  \n",
                        "Use the toolbar icons to **open** a project, **save**, or manage **environments**.\n",
                        "\n",
                        "| Shortcut | Action |\n",
                        "| --- | --- |\n",
                        "| `Shift + Enter` | Run cell and advance |\n",
                        "| `Ctrl + Enter` | Run cell (stay) |\n",
                        "| `Ctrl + S` | Save notebook |"
                    ]
                },
                {
                    "cell_type": "code",
                    "id": str(uuid.uuid4())[:8],
                    "metadata": {},
                    "source": [
                        "# Libraries available in the Default environment\n",
                        "import numpy as np\n",
                        "import pandas as pd\n",
                        "import matplotlib.pyplot as plt\n",
                        "import seaborn as sns\n",
                        "import sklearn\n",
                        "import scipy\n",
                        "import plotly\n",
                        "import statsmodels\n",
                        "from PIL import Image\n",
                        "\n",
                        "print(f\"NumPy {np.__version__}, Pandas {pd.__version__}, \"\n",
                        "      f\"Matplotlib {plt.matplotlib.__version__}, Seaborn {sns.__version__}\")"
                    ],
                    "outputs": [],
                    "execution_count": None
                },
                {
                    "cell_type": "code",
                    "id": str(uuid.uuid4())[:8],
                    "metadata": {},
                    "source": [
                        "# Quick example: Fibonacci with NumPy\n",
                        "import math\n",
                        "\n",
                        "phi = (1 + math.sqrt(5)) / 2\n",
                        "print(f\"The golden ratio is {phi:.6f}\")\n",
                        "\n",
                        "fib = [0, 1]\n",
                        "for _ in range(8):\n",
                        "    fib.append(fib[-1] + fib[-2])\n",
                        "print(f\"Fibonacci: {fib}\")"
                    ],
                    "outputs": [],
                    "execution_count": None
                }
            ]
        }
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(notebook, f, indent=2)
        return project_id, notebook_name

    def list_projects(self) -> list[dict]:
        projects = []
        if not os.path.exists(PROJECTS_DIR):
            return projects
        for name in sorted(os.listdir(PROJECTS_DIR)):
            project_path = os.path.join(PROJECTS_DIR, name)
            if os.path.isdir(project_path):
                projects.append({
                    "id": name,
                    "notebooks_count": len(self.list_notebooks(name))
                })
        return projects

    def create_project(self, project_id: str) -> dict:
        if ".." in project_id or "/" in project_id or "\\" in project_id:
            raise ValueError("Invalid project ID")
        project_path = os.path.join(PROJECTS_DIR, project_id)
        os.makedirs(os.path.join(project_path, "notebooks"), exist_ok=True)
        os.makedirs(os.path.join(project_path, "venvs"), exist_ok=True)
        return {"id": project_id}

    def list_notebooks(self, project_id: str) -> list[dict]:
        notebooks_dir = self._project_notebooks_dir(project_id)
        if not os.path.exists(notebooks_dir):
            return []
        notebooks = []
        for name in sorted(os.listdir(notebooks_dir)):
            if name.endswith(".ipynb"):
                filepath = os.path.join(notebooks_dir, name)
                stat = os.stat(filepath)
                notebooks.append({
                    "name": name,
                    "size": stat.st_size,
                    "modified": stat.st_mtime
                })
        return notebooks

    def get_notebook(self, project_id: str, notebook_name: str) -> dict:
        notebook_name = self._validate_notebook_name(notebook_name)
        filepath = self._notebook_path(project_id, notebook_name)
        if not os.path.exists(filepath):
            raise FileNotFoundError(f"Notebook not found: {notebook_name}")
        with open(filepath, "r", encoding="utf-8") as f:
            notebook = json.load(f)
        for cell in notebook.get("cells", []):
            if "id" not in cell:
                cell["id"] = str(uuid.uuid4())[:8]
        return notebook

    def create_notebook(self, project_id: str, notebook_name: str,
                        content: Optional[dict] = None) -> dict:
        notebook_name = self._validate_notebook_name(notebook_name)
        notebooks_dir = self._project_notebooks_dir(project_id)
        os.makedirs(notebooks_dir, exist_ok=True)
        filepath = self._notebook_path(project_id, notebook_name)
        if os.path.exists(filepath):
            raise FileExistsError(f"Notebook already exists: {notebook_name}")
        notebook = content if content else self._empty_notebook(notebook_name)
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(notebook, f, indent=2)
        return {"name": notebook_name, "created": True}

    def update_notebook(self, project_id: str, notebook_name: str,
                        content: dict) -> dict:
        notebook_name = self._validate_notebook_name(notebook_name)
        filepath = self._notebook_path(project_id, notebook_name)
        if not os.path.exists(filepath):
            raise FileNotFoundError(f"Notebook not found: {notebook_name}")
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(content, f, indent=2)
        return {"name": notebook_name, "updated": True}

    def delete_notebook(self, project_id: str, notebook_name: str) -> dict:
        notebook_name = self._validate_notebook_name(notebook_name)
        filepath = self._notebook_path(project_id, notebook_name)
        if not os.path.exists(filepath):
            raise FileNotFoundError(f"Notebook not found: {notebook_name}")
        os.remove(filepath)
        return {"name": notebook_name, "deleted": True}

    def get_notebook_hash(self, project_id: str, notebook_name: str) -> str:
        notebook_name = self._validate_notebook_name(notebook_name)
        filepath = self._notebook_path(project_id, notebook_name)
        with open(filepath, "rb") as f:
            return hashlib.md5(f.read()).hexdigest()
