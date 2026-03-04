from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.managers.notebook_manager import NotebookManager

router = APIRouter(prefix="/api", tags=["notebooks"])
notebook_mgr = NotebookManager()


class CreateProjectRequest(BaseModel):
    project_id: str


class CreateNotebookRequest(BaseModel):
    name: str
    content: Optional[dict] = None


class UpdateNotebookRequest(BaseModel):
    content: dict


@router.get("/projects")
def list_projects():
    return notebook_mgr.list_projects()


@router.post("/projects")
def create_project(req: CreateProjectRequest):
    try:
        return notebook_mgr.create_project(req.project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/projects/{project_id}/notebooks")
def list_notebooks(project_id: str):
    return notebook_mgr.list_notebooks(project_id)


@router.get("/projects/{project_id}/notebooks/{notebook_name}")
def get_notebook(project_id: str, notebook_name: str):
    try:
        return notebook_mgr.get_notebook(project_id, notebook_name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/projects/{project_id}/notebooks")
def create_notebook(project_id: str, req: CreateNotebookRequest):
    try:
        return notebook_mgr.create_notebook(project_id, req.name, req.content)
    except FileExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/projects/{project_id}/notebooks/{notebook_name}")
def update_notebook(project_id: str, notebook_name: str, req: UpdateNotebookRequest):
    try:
        return notebook_mgr.update_notebook(project_id, notebook_name, req.content)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/projects/{project_id}/notebooks/{notebook_name}")
def delete_notebook(project_id: str, notebook_name: str):
    try:
        return notebook_mgr.delete_notebook(project_id, notebook_name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


