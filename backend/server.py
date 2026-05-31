"""Main FastAPI application for Sistema de Licitações."""
import logging

from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

from db import db
from auth import auth_router, seed_admin
from storage import files_router, init_storage
from routes import api as core_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="Sistema de Licitações")

app.include_router(auth_router)
app.include_router(files_router)
app.include_router(core_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    try:
        await db.users.create_index("email", unique=True)
    except Exception as e:
        logger.warning(f"Index creation: {e}")
    await seed_admin()
    try:
        init_storage()
        logger.info("Storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")


@app.on_event("shutdown")
async def shutdown():
    from db import client
    client.close()
