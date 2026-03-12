from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from src.routers.process import router as process_router
from src.routers.compare import router as compare_router
from src.routers.autocompare import router as autocompare_router

app = FastAPI(title="BRD Processing Service", version="1.0.0")

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