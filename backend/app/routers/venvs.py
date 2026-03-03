from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.managers.venv_manager import VenvManager

router = APIRouter(prefix="/api", tags=["venvs"])
venv_mgr = VenvManager()


class CreateVenvRequest(BaseModel):
    name: str
    requirements: Optional[list[str]] = None


class PackagesRequest(BaseModel):
    packages: list[str]


# --- Shared venvs ---

@router.get("/venvs")
def list_shared_venvs():
    return venv_mgr.list_venvs(include_default=True)


@router.post("/venvs")
async def create_shared_venv(req: CreateVenvRequest):
    try:
        return await venv_mgr.create_venv(req.name, requirements=req.requirements)
    except FileExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/venvs/{name}")
async def delete_shared_venv(name: str):
    try:
        return await venv_mgr.delete_venv(name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/venvs/{name}/packages")
async def list_shared_venv_packages(name: str):
    try:
        return await venv_mgr.list_packages(name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/venvs/{name}/packages")
async def install_shared_venv_packages(name: str, req: PackagesRequest):
    try:
        return await venv_mgr.install_packages(name, req.packages)
    except (FileNotFoundError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/venvs/{name}/packages")
async def remove_shared_venv_packages(name: str, req: PackagesRequest):
    try:
        return await venv_mgr.remove_packages(name, req.packages)
    except (FileNotFoundError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))


# --- Project venvs ---

@router.get("/projects/{project_id}/venvs")
def list_project_venvs(project_id: str):
    return venv_mgr.list_venvs(project_id)


@router.post("/projects/{project_id}/venvs")
async def create_project_venv(project_id: str, req: CreateVenvRequest):
    try:
        return await venv_mgr.create_venv(
            req.name, project_id=project_id, requirements=req.requirements
        )
    except FileExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/projects/{project_id}/venvs/{name}")
async def delete_project_venv(project_id: str, name: str):
    try:
        return await venv_mgr.delete_venv(name, project_id=project_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/projects/{project_id}/venvs/{name}/packages")
async def list_project_venv_packages(project_id: str, name: str):
    try:
        return await venv_mgr.list_packages(name, project_id=project_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/projects/{project_id}/venvs/{name}/packages")
async def install_project_venv_packages(project_id: str, name: str, req: PackagesRequest):
    try:
        return await venv_mgr.install_packages(name, req.packages, project_id=project_id)
    except (FileNotFoundError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/projects/{project_id}/venvs/{name}/packages")
async def remove_project_venv_packages(project_id: str, name: str, req: PackagesRequest):
    try:
        return await venv_mgr.remove_packages(name, req.packages, project_id=project_id)
    except (FileNotFoundError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))
