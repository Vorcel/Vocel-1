"""Cloudflare R2 object storage integration + file routes."""
import os
import uuid
import logging

import boto3
from botocore.exceptions import ClientError
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Query, Header, Response

from db import db, now_iso
from auth import get_current_user

logger = logging.getLogger(__name__)

BUCKET = os.environ["OBJECT_STORAGE_BUCKET"]
ENDPOINT = os.environ["OBJECT_STORAGE_ENDPOINT"]
ACCESS_KEY = os.environ["OBJECT_STORAGE_ACCESS_KEY"]
SECRET_KEY = os.environ["OBJECT_STORAGE_SECRET_KEY"]

APP_NAME = "vorcel"

MIME_TYPES = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
    "gif": "image/gif", "webp": "image/webp", "pdf": "application/pdf",
    "json": "application/json", "csv": "text/csv", "txt": "text/plain",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

MAX_SIZE = 10 * 1024 * 1024  # 10MB

files_router = APIRouter(prefix="/api", tags=["files"])

s3 = boto3.client(
    "s3",
    endpoint_url=ENDPOINT,
    aws_access_key_id=ACCESS_KEY,
    aws_secret_access_key=SECRET_KEY,
    region_name="auto",
)


def init_storage():
    return True


def put_object(path: str, data: bytes, content_type: str) -> dict:
    try:
        s3.put_object(
            Bucket=BUCKET,
            Key=path,
            Body=data,
            ContentType=content_type,
        )
        return {"path": path, "size": len(data)}
    except ClientError as e:
        logger.error(f"R2 upload failed: {e}")
        raise


def get_object(path: str):
    try:
        obj = s3.get_object(Bucket=BUCKET, Key=path)
        data = obj["Body"].read()
        content_type = obj.get("ContentType", "application/octet-stream")
        return data, content_type
    except ClientError as e:
        logger.error(f"R2 download failed: {e}")
        raise


@files_router.post("/upload")
async def upload(file: UploadFile = File(...), current=Depends(get_current_user)):
    data = await file.read()

    if len(data) > MAX_SIZE:
        raise HTTPException(status_code=400, detail="Arquivo excede 10MB")

    ext = file.filename.split(".")[-1].lower() if "." in file.filename else "bin"
    content_type = file.content_type or MIME_TYPES.get(ext, "application/octet-stream")

    path = f"{APP_NAME}/uploads/{current['id']}/{uuid.uuid4()}.{ext}"

    try:
        result = put_object(path, data, content_type)
    except Exception as e:
        logger.error(f"Upload failed: {e}")
        raise HTTPException(status_code=500, detail="Falha no upload do arquivo")

    file_id = str(uuid.uuid4())

    await db.files.insert_one({
        "id": file_id,
        "storage_path": result["path"],
        "original_filename": file.filename,
        "content_type": content_type,
        "size": result.get("size", len(data)),
        "owner_id": current["id"],
        "is_deleted": False,
        "created_at": now_iso(),
    })

    return {
        "id": file_id,
        "filename": file.filename,
        "content_type": content_type,
        "size": result.get("size", len(data)),
        "url": f"/api/files/{file_id}",
    }


@files_router.get("/files/{file_id}")
async def download(file_id: str, auth: str = Query(None), authorization: str = Header(None)):
    record = await db.files.find_one({"id": file_id, "is_deleted": False})

    if not record:
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")

    try:
        data, content_type = get_object(record["storage_path"])
    except Exception as e:
        logger.error(f"Download failed: {e}")
        raise HTTPException(status_code=500, detail="Falha ao recuperar arquivo")

    return Response(
        content=data,
        media_type=record.get("content_type", content_type),
        headers={"Content-Disposition": f'inline; filename="{record["original_filename"]}"'},
    )
