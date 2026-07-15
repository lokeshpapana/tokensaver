import os
import io
import json
import base64
import logging
import tempfile
import traceback
import zipfile
from pathlib import Path
from typing import List, Optional
from datetime import datetime, timezone

from fastapi import FastAPI, File, UploadFile, Depends, HTTPException, Request, Query
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from converter.extractors import detect_file_type, extract_text
from converter.renderer import render_text_to_pages
from converter.tokenizer import (
    estimate_image_tokens,
    estimate_tokens_only,
    calculate_savings,
    format_token_count,
)
from converter.firebase_security import (
    security_middleware,
    verify_firebase_token,
    get_user_context,
    get_api_key_tier,
    require_rate_limit,
    save_to_history,
    load_history,
    get_stats,
    init_default_tiers,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="TokenSaver",
    description="Convert text files to dense PNG images for 89%+ LLM token savings",
    version="2.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = Path(__file__).parent / "static"
STATIC_DIR.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://www.gstatic.com; "
        "style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; "
        "connect-src 'self' https://identitytoolkit.googleapis.com https://firestore.googleapis.com;"
    )
    return response


@app.exception_handler(Exception)
async def _debug_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc), "traceback": traceback.format_exc()},
    )


def _validate_mode(mode: str) -> str:
    if mode not in ("readable", "standard", "dense"):
        return "standard"
    return mode


def _build_page_response(pages, filename, savings):
    page_images_b64 = []
    output_filenames = []
    for page in pages:
        b64 = base64.b64encode(page.image_bytes).decode("utf-8")
        page_images_b64.append({
            "page": page.page_num,
            "total_pages": page.total_pages,
            "width": page.width,
            "height": page.height,
            "tokens": estimate_image_tokens(page.width, page.height),
            "data": f"data:image/png;base64,{b64}",
        })
        output_filenames.append(f"{os.path.splitext(filename)[0]}_p{page.page_num}.png")
    return page_images_b64, output_filenames


@app.on_event("startup")
async def startup_event():
    await init_default_tiers()


@app.get("/", response_class=HTMLResponse)
async def root():
    index_path = STATIC_DIR / "index.html"
    if index_path.exists():
        return HTMLResponse(content=index_path.read_text(encoding="utf-8"))
    return HTMLResponse(content="<h1>TokenSaver</h1><p>API docs: <a href='/docs'>/docs</a></p>")


@app.post("/api/estimate")
async def estimate_cost(
    request: Request,
    mode: str = Query("standard", description="Rendering mode: readable, standard, dense"),
):
    body = await request.json()
    text = body.get("text", "")

    if not text or not text.strip():
        return JSONResponse(content={
            "text_tokens": 0, "estimated_image_tokens": 0,
            "estimated_savings_percent": 0, "recommendation": "No content",
            "would_be_worse": False, "chars": 0,
        })

    if len(text) > 50_000_000:
        raise HTTPException(status_code=413, detail="Text too large. Maximum: 50M characters")

    estimate = estimate_tokens_only(text, mode)
    return JSONResponse(content=estimate)


@app.post("/api/convert")
async def convert_file(
    request: Request,
    file: UploadFile = File(..., description="Text file to convert to PNG"),
    mode: str = Query("standard", description="Rendering mode: readable, standard, dense"),
    line_numbers: bool = Query(False, description="Show line numbers"),
    optimize: bool = Query(True, description="Optimize code indentation/braces"),
    user_ctx: dict = Depends(get_user_context),
):
    mode = _validate_mode(mode)
    content = await file.read()
    file_size = len(content)
    security_middleware.validate_file_upload(file.filename, file_size)

    with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file.filename)[1]) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        file_type = detect_file_type(tmp_path)
        text = extract_text(tmp_path, file_type)
        if not text.strip():
            raise HTTPException(status_code=400, detail="No readable text content found in file")

        pages = render_text_to_pages(text, file.filename, mode=mode, show_line_numbers=line_numbers, optimize=optimize)
        savings = calculate_savings(text, pages)
        page_images_b64, output_filenames = _build_page_response(pages, file.filename, savings)

        await save_to_history(
            uid=user_ctx.get("uid"),
            original_filename=file.filename,
            file_type=file_type,
            char_count=savings.chars_total,
            text_tokens=savings.text_tokens,
            image_tokens=savings.total_image_tokens,
            savings_percent=savings.savings_percent,
            num_pages=savings.pages,
        )

        return JSONResponse(
            content={
                "success": True,
                "filename": file.filename,
                "file_type": file_type,
                "mode": mode,
                "stats": {
                    "characters": savings.chars_total,
                    "text_tokens": savings.text_tokens,
                    "image_tokens": savings.total_image_tokens,
                    "savings_percent": savings.savings_percent,
                    "compression_ratio": savings.compression_ratio,
                    "pages": savings.pages,
                    "chars_per_page": savings.chars_per_page,
                    "chars_per_token": savings.chars_per_token,
                    "text_tokens_display": format_token_count(savings.text_tokens),
                    "image_tokens_display": format_token_count(savings.total_image_tokens),
                    "recommendation": savings.recommendation,
                },
                "pages": page_images_b64,
                "tier": user_ctx["tier"],
                "rate_limit": user_ctx["rate_limit"].headers,
            },
            headers=user_ctx["rate_limit"].headers,
        )
    finally:
        os.unlink(tmp_path)


@app.post("/api/convert-text")
async def convert_text(
    request: Request,
    mode: str = Query("standard", description="Rendering mode: readable, standard, dense"),
    line_numbers: bool = Query(False, description="Show line numbers"),
    optimize: bool = Query(True, description="Optimize code indentation/braces"),
    filename: str = Query("pasted_text.txt", description="Filename for the output"),
    user_ctx: dict = Depends(get_user_context),
):
    mode = _validate_mode(mode)
    body = await request.json()
    text = body.get("text", "")

    if not text or not text.strip():
        raise HTTPException(status_code=400, detail="No text provided")
    if len(text) > 50_000_000:
        raise HTTPException(status_code=413, detail="Text too large. Maximum: 50M characters")

    try:
        pages = render_text_to_pages(text, filename, mode=mode, show_line_numbers=line_numbers, optimize=optimize)
        savings = calculate_savings(text, pages)
        page_images_b64, _ = _build_page_response(pages, filename, savings)

        await save_to_history(
            uid=user_ctx.get("uid"),
            original_filename=filename,
            file_type="txt",
            char_count=savings.chars_total,
            text_tokens=savings.text_tokens,
            image_tokens=savings.total_image_tokens,
            savings_percent=savings.savings_percent,
            num_pages=savings.pages,
        )

        return JSONResponse(
            content={
                "success": True, "filename": filename, "file_type": "txt", "mode": mode,
                "stats": {
                    "characters": savings.chars_total, "text_tokens": savings.text_tokens,
                    "image_tokens": savings.total_image_tokens, "savings_percent": savings.savings_percent,
                    "compression_ratio": savings.compression_ratio, "pages": savings.pages,
                    "chars_per_page": savings.chars_per_page, "chars_per_token": savings.chars_per_token,
                    "text_tokens_display": format_token_count(savings.text_tokens),
                    "image_tokens_display": format_token_count(savings.total_image_tokens),
                    "recommendation": savings.recommendation,
                },
                "pages": page_images_b64, "tier": user_ctx["tier"],
            },
            headers=user_ctx["rate_limit"].headers,
        )
    except Exception as e:
        logger.error(f"Conversion error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Conversion failed: {str(e)}")


@app.post("/api/convert-batch")
async def convert_batch(
    request: Request,
    files: List[UploadFile] = File(..., description="Multiple files to convert"),
    mode: str = Query("standard", description="Rendering mode: readable, standard, dense"),
    line_numbers: bool = Query(False, description="Show line numbers"),
    user_ctx: dict = Depends(get_user_context),
):
    mode = _validate_mode(mode)
    tier_limits = user_ctx["tier_limits"]
    
    if len(files) > tier_limits.get("max_batch_files", 20):
        raise HTTPException(status_code=400, detail=f"Maximum {tier_limits.get('max_batch_files', 20)} files per batch for your tier")

    zip_buffer = io.BytesIO()
    total_stats = {"files": 0, "total_chars": 0, "total_text_tokens": 0, "total_image_tokens": 0}

    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for upload_file in files:
            content = await upload_file.read()
            file_size = len(content)
            security_middleware.validate_file_upload(upload_file.filename, file_size)

            with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(upload_file.filename)[1]) as tmp:
                tmp.write(content)
                tmp_path = tmp.name

            try:
                file_type = detect_file_type(tmp_path)
                text = extract_text(tmp_path, file_type)
                if not text.strip():
                    continue

                pages = render_text_to_pages(text, upload_file.filename, mode=mode, show_line_numbers=line_numbers)
                savings = calculate_savings(text, pages)

                for page in pages:
                    png_name = f"{os.path.splitext(upload_file.filename)[0]}_p{page.page_num}.png"
                    zip_file.writestr(png_name, page.image_bytes)

                total_stats["files"] += 1
                total_stats["total_chars"] += savings.chars_total
                total_stats["total_text_tokens"] += savings.text_tokens
                total_stats["total_image_tokens"] += savings.total_image_tokens

                await save_to_history(
                    uid=user_ctx.get("uid"),
                    original_filename=upload_file.filename,
                    file_type=file_type,
                    char_count=savings.chars_total,
                    text_tokens=savings.text_tokens,
                    image_tokens=savings.total_image_tokens,
                    savings_percent=savings.savings_percent,
                    num_pages=savings.pages,
                )
            finally:
                os.unlink(tmp_path)

    zip_buffer.seek(0)
    overall_savings = 0
    if total_stats["total_text_tokens"] > 0:
        overall_savings = round(
            (1 - total_stats["total_image_tokens"] / total_stats["total_text_tokens"]) * 100, 1
        )

    return StreamingResponse(
        zip_buffer, media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="tokensaver_batch_{datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")}.zip"',
            "X-Stats": json.dumps({
                "files": total_stats["files"],
                "text_tokens": format_token_count(total_stats["total_text_tokens"]),
                "image_tokens": format_token_count(total_stats["total_image_tokens"]),
                "savings": f"{overall_savings}%",
            }),
        },
    )


@app.get("/api/history")
async def api_history(
    request: Request,
    limit: int = Query(50, ge=1, le=500),
    user_ctx: dict = Depends(get_user_context),
):
    records = await load_history(user_ctx.get("uid"), limit=limit)
    return JSONResponse(
        content={
            "history": [
                {
                    "id": r.id, "filename": r.filename, "file_type": r.file_type,
                    "chars": r.char_count, "text_tokens": format_token_count(r.text_tokens),
                    "image_tokens": format_token_count(r.image_tokens),
                    "savings": f"{r.savings_percent}%", "pages": r.pages, "timestamp": r.timestamp,
                }
                for r in records
            ],
            "total": len(records),
        },
        headers=user_ctx["rate_limit"].headers,
    )


@app.get("/api/stats")
async def api_stats(
    request: Request,
    user_ctx: dict = Depends(get_user_context),
):
    stats = await get_stats(user_ctx.get("uid"))
    return JSONResponse(content=stats, headers=user_ctx["rate_limit"].headers)


@app.post("/api/keys/generate")
async def generate_api_key(
    request: Request,
    tier: str = Query("free", description="API tier: free, pro"),
    description: str = Query("", description="Key description"),
    user_ctx: dict = Depends(get_user_context),
):
    if user_ctx.get("anonymous"):
        raise HTTPException(status_code=401, detail="Authentication required to generate API keys")
    
    raw_key = security_middleware.api_key_manager.generate_key(
        uid=user_ctx["uid"],
        tier=tier,
        description=description,
    )
    return JSONResponse(content={
        "api_key": raw_key, "tier": tier, "description": description,
        "message": "Store this key securely. It will not be shown again.",
        "usage": "Add header: Authorization: Bearer <your_key>",
        "rate_limits": {
            "free": "100 requests/hour",
            "pro": "500 requests/hour",
        },
    })


@app.get("/api/keys/list")
async def list_api_keys(
    request: Request,
    user_ctx: dict = Depends(get_user_context),
):
    if user_ctx.get("anonymous"):
        raise HTTPException(status_code=401, detail="Authentication required")
    
    keys = security_middleware.api_key_manager.list_keys(user_ctx["uid"])
    return JSONResponse(content={"keys": keys})


@app.post("/api/keys/revoke")
async def revoke_api_key(
    request: Request,
    api_key: str = Query(..., description="API key to revoke"),
    user_ctx: dict = Depends(get_user_context),
):
    if user_ctx.get("anonymous"):
        raise HTTPException(status_code=401, detail="Authentication required")
    
    success = security_middleware.api_key_manager.revoke_key(api_key)
    if success:
        return JSONResponse(content={"message": "API key revoked successfully"})
    raise HTTPException(status_code=404, detail="API key not found")


@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "version": "2.1.1-debug"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)