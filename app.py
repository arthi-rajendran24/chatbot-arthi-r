"""Local Python server for the profile companion."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import dotenv_values
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.middleware.trustedhost import TrustedHostMiddleware

from profile_chat import GeminiUnavailable, ProfileError, ask_gemini, load_profile

BASE_DIR = Path(__file__).resolve().parent
PROFILE_PATH = BASE_DIR / "data" / "profile.md"
ENV_PATH = BASE_DIR / ".env"
DEFAULT_MODEL = "gemini-3.5-flash-lite"

app = FastAPI(title="Profile companion", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "[::1]", "testserver"])
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


def settings() -> tuple[str, str]:
    # Read on every request: pasting a key into .env doesn't need a restart.
    values = dotenv_values(ENV_PATH, interpolate=False)
    key = (values.get("GEMINI_API_KEY") or os.environ.get("GEMINI_API_KEY") or "").strip()
    model = (values.get("GEMINI_MODEL") or os.environ.get("GEMINI_MODEL") or DEFAULT_MODEL).strip()
    if key.lower() in {"your_api_key_here", "paste_your_key_here", "your_gemini_api_key_here"}:
        key = ""
    return key, model


@app.middleware("http")
async def local_headers(request: Request, call_next):
    # Same-origin JSON API, with local-only serving as the default.
    if request.method == "POST":
        origin = request.headers.get("origin")
        if origin and origin != str(request.base_url).rstrip("/"):
            from fastapi.responses import JSONResponse
            return JSONResponse({"detail": "This request must come from the local chatbot page."}, status_code=403)
        if not request.headers.get("content-type", "").lower().startswith("application/json"):
            from fastapi.responses import JSONResponse
            return JSONResponse({"detail": "Send questions as JSON."}, status_code=415)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self'; "
        "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    )
    return response


@app.get("/")
def index():
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/api/status")
def status():
    key, model = settings()
    try:
        profile = load_profile(PROFILE_PATH)
    except ProfileError as exc:
        return {"configured": bool(key), "model": model, "profile": None, "error": str(exc)}
    return {
        "configured": bool(key),
        "model": model,
        "profile": {"title": profile.title, "filename": profile.filename, "section_count": profile.section_count},
        "error": None,
    }


@app.get("/api/profile")
def source_profile():
    try:
        profile = load_profile(PROFILE_PATH)
    except ProfileError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {
        "title": profile.title,
        "filename": profile.filename,
        "markdown": profile.markdown,
        "version": profile.version,
        "lines": [{"number": n, "text": line} for n, line in enumerate(profile.markdown.splitlines(), start=1)],
    }


class Question(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=1, max_length=2000, strict=True)

    @field_validator("question")
    @classmethod
    def nonblank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Please enter a question.")
        return value


@app.post("/api/chat")
def chat(body: Question):
    key, model = settings()
    if not key:
        raise HTTPException(status_code=503, detail="Add GEMINI_API_KEY to the local .env file, then refresh status.")
    try:
        profile = load_profile(PROFILE_PATH)
        return ask_gemini(body.question, profile, key, model)
    except ProfileError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except GeminiUnavailable as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from None


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
