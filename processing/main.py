import asyncio
import logging
from contextlib import asynccontextmanager

from starlette.types import ASGIApp, Receive, Scope, Send

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
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


# GZip everything EXCEPT the streaming diff endpoint (buffering kills SSE/NDJSON)
class _GzipSkipStreaming:
    """Wraps GZipMiddleware but bypasses it for /compare/diff/stream."""
    def __init__(self, app: ASGIApp) -> None:
        self._gzip = GZipMiddleware(app, minimum_size=1000)
        self._app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope.get("path", "").endswith("/diff/stream"):
            await self._app(scope, receive, send)
        else:
            await self._gzip(scope, receive, send)

app.add_middleware(_GzipSkipStreaming)

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