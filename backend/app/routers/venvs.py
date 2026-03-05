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


@router.get("/venvs")
def list_envs():
    return venv_mgr.list_envs()


@router.post("/venvs")
async def create_env(req: CreateVenvRequest):
    try:
        return await venv_mgr.create_env(req.name, requirements=req.requirements)
    except FileExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/venvs/{name}")
async def delete_env(name: str):
    try:
        return await venv_mgr.delete_env(name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/venvs/{name}/packages")
async def list_packages(name: str):
    try:
        return await venv_mgr.list_packages(name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/venvs/{name}/packages")
async def install_packages(name: str, req: PackagesRequest):
    try:
        return await venv_mgr.install_packages(name, req.packages)
    except (FileNotFoundError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/venvs/{name}/packages")
async def remove_packages(name: str, req: PackagesRequest):
    try:
        return await venv_mgr.remove_packages(name, req.packages)
    except (FileNotFoundError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))
