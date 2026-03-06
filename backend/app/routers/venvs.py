from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional
from app.managers.venv_manager import VenvManager

router = APIRouter(prefix="/api", tags=["venvs"])
venv_mgr = VenvManager()


# --- Request models ---

class CreateVenvRequest(BaseModel):
    name: str
    requirements: Optional[list[str]] = None


class CreateEnvRequest(BaseModel):
    runtime_id: str
    name: str
    requirements: Optional[list[str]] = None


class PackagesRequest(BaseModel):
    packages: list[str]


# --- New runtime-aware endpoints ---

@router.get("/runtimes")
def list_runtimes():
    return venv_mgr.registry.list_runtimes()


@router.get("/envs")
def list_envs_new():
    return venv_mgr.env_manager.list_envs()


@router.post("/envs")
async def create_env_new(req: CreateEnvRequest):
    try:
        return await venv_mgr.env_manager.create_env(
            req.runtime_id, req.name, requirements=req.requirements
        )
    except FileExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/envs/{runtime_id:path}/{name}")
async def delete_env_new(runtime_id: str, name: str):
    try:
        return await venv_mgr.env_manager.delete_env(runtime_id, name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/envs/{runtime_id:path}/{name}/packages")
async def list_packages_new(runtime_id: str, name: str):
    try:
        return await venv_mgr.env_manager.list_packages(runtime_id, name)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/envs/{runtime_id:path}/{name}/packages")
async def install_packages_new(runtime_id: str, name: str, req: PackagesRequest):
    try:
        return await venv_mgr.env_manager.install_packages(
            runtime_id, name, req.packages
        )
    except (FileNotFoundError, ValueError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/envs/{runtime_id:path}/{name}/packages")
async def remove_packages_new(runtime_id: str, name: str, req: PackagesRequest):
    try:
        return await venv_mgr.env_manager.remove_packages(
            runtime_id, name, req.packages
        )
    except (FileNotFoundError, ValueError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))


# --- Legacy endpoints (backward compatibility) ---

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
