import sys
sys.path.insert(0, '.')
from converter.renderer import render_text_to_pages
from converter.tokenizer import calculate_savings, estimate_text_tokens

# Real Python file
python_code = """import os
import sys
import json
import logging
from typing import Optional, List, Dict, Any
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, Depends, HTTPException, Request, Query
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from converter.extractors import detect_file_type, extract_text
from converter.renderer import render_text_to_pages
from converter.tokenizer import estimate_text_tokens, estimate_image_tokens, calculate_savings
from converter.history import load_history, save_to_history, get_stats
from converter.security import security_middleware, get_api_key_tier, require_rate_limit

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="TokenSaver", description="Convert text files to dense PNG images", version="1.0.0")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

@app.get("/", response_class=HTMLResponse)
async def root():
    index_path = Path(__file__).parent / "static" / "index.html"
    if index_path.exists():
        return HTMLResponse(content=index_path.read_text(encoding="utf-8"))
    return HTMLResponse(content="<h1>TokenSaver</h1>")

@app.post("/api/convert")
async def convert_file(
    request: Request,
    file: UploadFile = File(...),
    mode: str = Query("standard"),
    line_numbers: bool = Query(False),
    tier: str = Depends(get_api_key_tier),
    rate_info: dict = Depends(require_rate_limit),
):
    content = await file.read()
    file_size = len(content)
    security_middleware.validate_file_upload(file.filename, file_size)

    import tempfile
    with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file.filename)[1]) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        file_type = detect_file_type(tmp_path)
        text = extract_text(tmp_path, file_type)
        if not text.strip():
            raise HTTPException(status_code=400, detail="No readable text content")

        pages = render_text_to_pages(text, file.filename, mode=mode, show_line_numbers=line_numbers)
        savings = calculate_savings(text, pages)

        page_images_b64 = []
        for page in pages:
            import base64
            b64 = base64.b64encode(page.image_bytes).decode("utf-8")
            page_images_b64.append({
                "page": page.page_num,
                "total_pages": page.total_pages,
                "width": page.width,
                "height": page.height,
                "tokens": estimate_image_tokens(page.width, page.height),
                "data": f"data:image/png;base64,{b64}",
            })

        client_ip = security_middleware.get_client_ip(request)
        save_to_history(
            original_filename=file.filename,
            file_type=file_type,
            char_count=savings.chars_total,
            text_tokens_est=savings.text_tokens,
            image_tokens_est=savings.total_image_tokens,
            savings_percent=savings.savings_percent,
            num_pages=savings.pages,
            output_filenames=[],
            client_ip=client_ip,
        )

        return JSONResponse(content={
            "success": True,
            "filename": file.filename,
            "stats": {
                "characters": savings.chars_total,
                "text_tokens": savings.text_tokens,
                "image_tokens": savings.total_image_tokens,
                "savings_percent": savings.savings_percent,
                "compression_ratio": savings.compression_ratio,
            },
            "pages": page_images_b64,
        })
    finally:
        os.unlink(tmp_path)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
"""

# Test WITHOUT optimization
pages_no_opt = render_text_to_pages(python_code, "app.py", optimize=False)
savings_no_opt = calculate_savings(python_code, pages_no_opt)

# Test WITH optimization
pages_opt = render_text_to_pages(python_code, "app.py", optimize=True)
savings_opt = calculate_savings(python_code, pages_opt)

print("WITHOUT optimization:")
print(f"  Pages: {savings_no_opt.pages}")
print(f"  Text tokens: {savings_no_opt.text_tokens}")
print(f"  Image tokens: {savings_no_opt.total_image_tokens}")
print(f"  Chars/token: {savings_no_opt.chars_per_token}")
print()
print("WITH optimization:")
print(f"  Pages: {savings_opt.pages}")
print(f"  Text tokens: {savings_opt.text_tokens}")
print(f"  Image tokens: {savings_opt.total_image_tokens}")
print(f"  Chars/token: {savings_opt.chars_per_token}")
print()
print(f"Improvement: {savings_no_opt.total_image_tokens - savings_opt.total_image_tokens} fewer image tokens")
