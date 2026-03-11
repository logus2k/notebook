from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.managers.source_file_manager import SourceFileManager

router = APIRouter(prefix="/api", tags=["source_files"])
src_mgr = SourceFileManager()


class CreateFileRequest(BaseModel):
    name: str


class UpdateFileRequest(BaseModel):
    content: str


class RenameFileRequest(BaseModel):
    new_name: str


@router.get("/projects/{project_id}/src")
def list_files(project_id: str):
    try:
        return src_mgr.list_files(project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/projects/{project_id}/src")
def create_file(project_id: str, req: CreateFileRequest):
    try:
        return src_mgr.create_file(project_id, req.name)
    except FileExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/projects/{project_id}/src/{filename}")
def get_file(project_id: str, filename: str):
    try:
        return src_mgr.get_file(project_id, filename)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/projects/{project_id}/src/{filename}")
def update_file(project_id: str, filename: str, req: UpdateFileRequest):
    try:
        return src_mgr.update_file(project_id, filename, req.content)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/projects/{project_id}/src/{filename}")
def delete_file(project_id: str, filename: str):
    try:
        return src_mgr.delete_file(project_id, filename)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/projects/{project_id}/src/{filename}/rename")
def rename_file(project_id: str, filename: str, req: RenameFileRequest):
    try:
        return src_mgr.rename_file(project_id, filename, req.new_name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except FileExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
