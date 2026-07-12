import os
import io
import json
import base64
import logging
import tempfile
import zipfile
from pathlib import Path
from typing import List
from datetime import datetime, timezone

from fastapi import FastAPI, File, UploadFile, Depends, HTTPException, Request, Query
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from converter.extractors import detect_file_type, extract_text
from converter.renderer import render_text_to_pages
from converter.tokenizer import (
    estimate_image_tokens,
    estimate_tokens_only,
    calculate_savings,
    format_token_count,
)
from converter.history import (
    load_history,
    save_to_history,
    get_stats,
)
from converter.security import (
    security_middleware,
    get_api_key_tier,
    require_rate_limit,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="TokenSaver",
    description="Convert text files to dense PNG images for 89%+ LLM token savings",
    version="2.0.0",
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
        "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; "
        "style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'"
    )
    return response


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


@app.get("/", response_class=HTMLResponse)
async def root():
    index_path = STATIC_DIR / "index.html"
    if index_path.exists():
        return HTMLResponse(content=index_path.read_text(encoding="utf-8"))
    return HTMLResponse(content="<h1>TokenSaver</h1><p>API docs: <a href='/docs'>/docs</a></p>")


@app.post("/api/convert")
async def convert_file(
    request: Request,
    file: UploadFile = File(..., description="Text file to convert to PNG"),
    mode: str = Query("standard", description="Rendering mode: readable, standard, dense"),
    line_numbers: bool = Query(False, description="Show line numbers"),
    optimize: bool = Query(True, description="Optimize code indentation/braces"),
    tier: str = Depends(get_api_key_tier),
    rate_info: dict = Depends(require_rate_limit),
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

        client_ip = security_middleware.get_client_ip(request)
        save_to_history(
            original_filename=file.filename,
            file_type=file_type,
            char_count=savings.chars_total,
            text_tokens_est=savings.text_tokens,
            image_tokens_est=savings.total_image_tokens,
            savings_percent=savings.savings_percent,
            num_pages=savings.pages,
            output_filenames=output_filenames,
            client_ip=client_ip,
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
                "tier": tier,
            },
            headers=rate_info.get("headers", {}),
        )
    finally:
        os.unlink(tmp_path)


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


@app.post("/api/convert-text")
async def convert_text(
    request: Request,
    mode: str = Query("standard", description="Rendering mode: readable, standard, dense"),
    line_numbers: bool = Query(False, description="Show line numbers"),
    optimize: bool = Query(True, description="Optimize code indentation/braces"),
    filename: str = Query("pasted_text.txt", description="Filename for the output"),
    tier: str = Depends(get_api_key_tier),
    rate_info: dict = Depends(require_rate_limit),
):
    mode = _validate_mode(mode)
    body = await request.json()
    text = body.get("text", "")

    if not text or not text.strip():
        raise HTTPException(status_code=400, detail="No text provided")
    if len(text) > 50_000_000:
        raise HTTPException(status_code=413, detail="Text too large. Maximum: 50M characters")

    pages = render_text_to_pages(text, filename, mode=mode, show_line_numbers=line_numbers, optimize=optimize)
    savings = calculate_savings(text, pages)
    page_images_b64, _ = _build_page_response(pages, filename, savings)

    client_ip = security_middleware.get_client_ip(request)
    save_to_history(
        original_filename=filename, file_type="txt",
        char_count=savings.chars_total, text_tokens_est=savings.text_tokens,
        image_tokens_est=savings.total_image_tokens, savings_percent=savings.savings_percent,
        num_pages=savings.pages,
        output_filenames=[f"{os.path.splitext(filename)[0]}_p{p.page_num}.png" for p in pages],
        client_ip=client_ip,
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
            "pages": page_images_b64, "tier": tier,
        },
        headers=rate_info.get("headers", {}),
    )


@app.post("/api/convert-batch")
async def convert_batch(
    request: Request,
    files: List[UploadFile] = File(..., description="Multiple files to convert"),
    mode: str = Query("standard", description="Rendering mode: readable, standard, dense"),
    line_numbers: bool = Query(False, description="Show line numbers"),
    tier: str = Depends(get_api_key_tier),
    rate_info: dict = Depends(require_rate_limit),
):
    mode = _validate_mode(mode)
    if len(files) > 20:
        raise HTTPException(status_code=400, detail="Maximum 20 files per batch")

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

                client_ip = security_middleware.get_client_ip(request)
                save_to_history(
                    original_filename=upload_file.filename, file_type=file_type,
                    char_count=savings.chars_total, text_tokens_est=savings.text_tokens,
                    image_tokens_est=savings.total_image_tokens, savings_percent=savings.savings_percent,
                    num_pages=savings.pages,
                    output_filenames=[f"{os.path.splitext(upload_file.filename)[0]}_p{p.page_num}.png" for p in pages],
                    client_ip=client_ip,
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
    tier: str = Depends(get_api_key_tier),
    rate_info: dict = Depends(require_rate_limit),
):
    client_ip = security_middleware.get_client_ip(request)
    records = load_history(limit=limit, client_ip=client_ip)
    return JSONResponse(
        content={
            "history": [
                {
                    "id": r.id, "filename": r.original_filename, "file_type": r.file_type,
                    "chars": r.char_count, "text_tokens": format_token_count(r.text_tokens_est),
                    "image_tokens": format_token_count(r.image_tokens_est),
                    "savings": f"{r.savings_percent}%", "pages": r.num_pages, "timestamp": r.timestamp,
                }
                for r in records
            ],
            "total": len(records),
        },
        headers=rate_info.get("headers", {}),
    )


@app.get("/api/stats")
async def api_stats(
    request: Request,
    tier: str = Depends(get_api_key_tier),
    rate_info: dict = Depends(require_rate_limit),
):
    client_ip = security_middleware.get_client_ip(request)
    stats = get_stats(client_ip=client_ip)
    return JSONResponse(content=stats, headers=rate_info.get("headers", {}))


@app.post("/api/keys/generate")
async def generate_api_key(
    request: Request,
    tier: str = Query("free", description="API tier: free, pro"),
    description: str = Query("", description="Key description"),
):
    raw_key = security_middleware.api_key_manager.generate_key(tier=tier, description=description)
    return JSONResponse(content={
        "api_key": raw_key, "tier": tier, "description": description,
        "message": "Store this key securely. It will not be shown again.",
        "usage": "Add header: X-API-Key: <your_key>",
        "rate_limits": {
            "anonymous": "20 requests/hour",
            "free": "100 requests/hour (with API key)",
            "pro": "500 requests/hour (with API key)",
        },
    })


@app.get("/api/keys/check")
async def check_api_key(
    request: Request,
    tier: str = Depends(get_api_key_tier),
    rate_info: dict = Depends(require_rate_limit),
):
    return JSONResponse(content={"tier": tier, "rate_limit": rate_info.get("headers", {})})


@app.post("/api/keys/revoke")
async def revoke_api_key(
    request: Request,
    api_key: str = Query(..., description="API key to revoke"),
):
    success = security_middleware.api_key_manager.revoke_key(api_key)
    if success:
        return JSONResponse(content={"message": "API key revoked successfully"})
    raise HTTPException(status_code=404, detail="API key not found")


@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "version": "2.0.0"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
