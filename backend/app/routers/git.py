import subprocess
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from app.managers.git_manager import GitManager

router = APIRouter(prefix="/api", tags=["git"])
git_mgr = GitManager()


class CommitRequest(BaseModel):
    message: str
    files: Optional[List[str]] = None
    author_name: Optional[str] = None
    author_email: Optional[str] = None


@router.post("/projects/{project_id}/git/init")
def init_repo(project_id: str):
    try:
        return git_mgr.init(project_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail=e.stderr or str(e))


@router.get("/projects/{project_id}/git/status")
def get_status(project_id: str):
    try:
        return git_mgr.status(project_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail=e.stderr or str(e))


@router.post("/projects/{project_id}/git/commit")
def commit(project_id: str, body: CommitRequest):
    try:
        return git_mgr.commit(project_id, body.message, body.files, body.author_name, body.author_email)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail=e.stderr or str(e))


@router.get("/projects/{project_id}/git/log")
def get_log(
    project_id: str,
    limit: int = Query(30, le=100),
    path: Optional[str] = None,
):
    try:
        return git_mgr.log(project_id, limit, path)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/projects/{project_id}/git/diff")
def get_diff(
    project_id: str,
    path: Optional[str] = Query(None),
    ref: Optional[str] = Query(None),
):
    try:
        return git_mgr.diff(project_id, path, ref)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/projects/{project_id}/git/show/{ref}")
def show_commit(project_id: str, ref: str):
    try:
        return git_mgr.show_commit(project_id, ref)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class BranchRequest(BaseModel):
    branch: str


@router.get("/projects/{project_id}/git/branches")
def get_branches(project_id: str):
    try:
        return git_mgr.branches(project_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/projects/{project_id}/git/checkout")
def checkout(project_id: str, body: BranchRequest):
    try:
        return git_mgr.checkout(project_id, body.branch)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail=e.stderr or str(e))


@router.post("/projects/{project_id}/git/branches")
def create_branch(project_id: str, body: BranchRequest):
    try:
        return git_mgr.create_branch(project_id, body.branch)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail=e.stderr or str(e))
