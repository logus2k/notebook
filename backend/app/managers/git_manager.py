import os
import subprocess
from app.config import PROJECTS_DIR

GITIGNORE_DEFAULTS = """\
__pycache__/
.ipynb_checkpoints/
*.pyc
*.pyo
.DS_Store
"""


class GitManager:
    """Per-project git repository management using subprocess."""

    def _validate_project(self, project_id: str):
        if ".." in project_id or "/" in project_id or "\\" in project_id:
            raise ValueError(f"Invalid project ID: {project_id}")

    def _project_path(self, project_id: str) -> str:
        self._validate_project(project_id)
        path = os.path.join(PROJECTS_DIR, project_id)
        if not os.path.isdir(path):
            raise FileNotFoundError(f"Project not found: {project_id}")
        return path

    def _run(self, args: list, cwd: str, check: bool = True) -> subprocess.CompletedProcess:
        env = os.environ.copy()
        env["GIT_TERMINAL_PROMPT"] = "0"  # Disable interactive prompts
        return subprocess.run(
            args, cwd=cwd, capture_output=True, text=True, check=check, env=env
        )

    def _ensure_git_config(self, path: str):
        """Set local git user if not already configured (needed in container)."""
        result = self._run(["git", "config", "user.email"], path, check=False)
        if not result.stdout.strip():
            self._run(["git", "config", "user.email", "noted@local"], path)
            self._run(["git", "config", "user.name", "noted"], path)

    def is_initialized(self, project_id: str) -> bool:
        try:
            path = self._project_path(project_id)
        except (ValueError, FileNotFoundError):
            return False
        return os.path.isdir(os.path.join(path, ".git"))

    def init(self, project_id: str) -> dict:
        path = self._project_path(project_id)
        self._run(["git", "init"], path)
        self._ensure_git_config(path)

        gitignore = os.path.join(path, ".gitignore")
        if not os.path.exists(gitignore):
            with open(gitignore, "w") as f:
                f.write(GITIGNORE_DEFAULTS)

        return {"initialized": True, "path": path}

    def status(self, project_id: str) -> dict:
        if not self.is_initialized(project_id):
            return {"initialized": False, "branch": None, "files": [], "ahead": 0, "behind": 0}

        path = self._project_path(project_id)

        branch_res = self._run(["git", "branch", "--show-current"], path, check=False)
        branch = branch_res.stdout.strip() or "main"

        status_res = self._run(["git", "status", "--porcelain=v1", "--untracked-files=all"], path)
        files = []
        for line in status_res.stdout.splitlines():
            if len(line) < 4:
                continue
            xy = line[:2]
            filepath = line[3:]
            # Handle renames: "old -> new"
            if " -> " in filepath:
                filepath = filepath.split(" -> ", 1)[1]
            files.append({
                "path": filepath.strip(),
                "index": xy[0],    # staged status
                "worktree": xy[1], # unstaged status
                "label": _status_label(xy),
            })

        return {
            "initialized": True,
            "branch": branch,
            "files": files,
        }

    def commit(self, project_id: str, message: str, files: list = None,
               author_name: str = None, author_email: str = None) -> dict:
        if not message or not message.strip():
            raise ValueError("Commit message cannot be empty")

        if not self.is_initialized(project_id):
            self.init(project_id)

        path = self._project_path(project_id)
        self._ensure_git_config(path)

        if files:
            for f in files:
                self._run(["git", "add", "--", f], path)
        else:
            self._run(["git", "add", "-A"], path)

        env = os.environ.copy()
        env["GIT_TERMINAL_PROMPT"] = "0"
        if author_name:
            env["GIT_AUTHOR_NAME"] = author_name
            env["GIT_COMMITTER_NAME"] = author_name
        if author_email:
            env["GIT_AUTHOR_EMAIL"] = author_email
            env["GIT_COMMITTER_EMAIL"] = author_email

        result = subprocess.run(
            ["git", "commit", "-m", message.strip()],
            cwd=path, capture_output=True, text=True, check=True, env=env
        )

        hash_res = self._run(["git", "rev-parse", "HEAD"], path)
        return {
            "commit_hash": hash_res.stdout.strip(),
            "short_hash": hash_res.stdout.strip()[:7],
            "message": message.strip(),
        }

    def log(self, project_id: str, limit: int = 30, file_path: str = None) -> dict:
        if not self.is_initialized(project_id):
            return {"commits": []}

        path = self._project_path(project_id)
        fmt = "%H%x00%h%x00%s%x00%an%x00%ai%x00%ar"
        args = ["git", "log", f"--pretty=format:{fmt}", f"-{limit}"]
        if file_path:
            args += ["--", file_path]

        result = self._run(args, path, check=False)
        if result.returncode != 0:
            # No commits yet
            return {"commits": []}

        commits = []
        for line in result.stdout.splitlines():
            parts = line.split("\x00")
            if len(parts) == 6:
                commits.append({
                    "hash": parts[0],
                    "short_hash": parts[1],
                    "message": parts[2],
                    "author": parts[3],
                    "date": parts[4],
                    "date_relative": parts[5],
                })

        return {"commits": commits}

    def diff(self, project_id: str, file_path: str = None, ref: str = None) -> dict:
        if not self.is_initialized(project_id):
            return {"diff": ""}

        path = self._project_path(project_id)

        if ref:
            args = ["git", "show", ref, "--stat", "--patch"]
            if file_path:
                args += ["--", file_path]
        else:
            args = ["git", "diff", "HEAD"]
            if file_path:
                args += ["--", file_path]

        result = self._run(args, path, check=False)
        return {"diff": result.stdout}

    def show_commit(self, project_id: str, ref: str) -> dict:
        if not self.is_initialized(project_id):
            return {"diff": "", "files": []}

        path = self._project_path(project_id)

        # Get list of files changed
        name_res = self._run(
            ["git", "show", "--name-status", "--pretty=format:", ref], path, check=False
        )
        files = []
        for line in name_res.stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            parts = line.split("\t", 1)
            if len(parts) == 2:
                files.append({"status": parts[0], "path": parts[1]})

        # Get patch
        diff_res = self._run(["git", "show", "--patch", "--stat", ref], path, check=False)

        return {"diff": diff_res.stdout, "files": files}


def _status_label(xy: str) -> str:
    x, y = xy[0], xy[1]
    if x == "?" and y == "?":
        return "untracked"
    if x == "A":
        return "added"
    if x == "D" or y == "D":
        return "deleted"
    if x == "R":
        return "renamed"
    if x == "M" or y == "M":
        return "modified"
    return "changed"
