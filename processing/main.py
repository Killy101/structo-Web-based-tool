import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from src.routers.process import router as process_router
from src.routers.compare import router as compare_router
from src.routers.autocompare import router as autocompare_router
from src.services.autocompare_service import cleanup_old_sessions

logger = logging.getLogger(__name__)

CLEANUP_INTERVAL = 900  # run cleanup every 15 minutes


async def _periodic_cleanup() -> None:
    """Background task: remove expired autocompare sessions on a regular schedule."""
    while True:
        await asyncio.sleep(CLEANUP_INTERVAL)
        try:
            removed = cleanup_old_sessions()
            if removed:
                logger.info("Periodic cleanup removed %d expired autocompare session(s)", removed)
        except Exception as exc:
            logger.warning("Periodic cleanup error: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_periodic_cleanup())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="BRD Processing Service", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:4000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(process_router)
app.include_router(compare_router)
app.include_router(autocompare_router)

@app.get("/health")
def health():
    return {"status": "ok"}