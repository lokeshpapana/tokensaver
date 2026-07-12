import sys
import time
sys.path.insert(0, '.')
from converter.renderer import render_text_to_pages
from converter.tokenizer import calculate_savings, estimate_text_tokens

# Test with realistic Python file
text = '''import os
import sys
import json
import logging
from typing import Optional, List
from datetime import datetime

from fastapi import FastAPI, File, UploadFile
from fastapi.responses import HTMLResponse

logger = logging.getLogger(__name__)

app = FastAPI(title="TokenSaver")

@app.get("/")
async def root():
    return HTMLResponse(content="<h1>Hello</h1>")

@app.post("/convert")
async def convert(file: UploadFile = File(...)):
    content = await file.read()
    text = content.decode("utf-8")
    result = process_text(text)
    return {"result": result}

def process_text(text: str) -> dict:
    lines = text.split("\\n")
    char_count = len(text)
    line_count = len(lines)
    return {
        "chars": char_count,
        "lines": line_count,
        "density": char_count / max(line_count, 1)
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
''' * 200

start = time.time()
pages = render_text_to_pages(text, "app.py", mode="standard")
elapsed = time.time() - start

savings = calculate_savings(text, pages)
print(f"Time: {elapsed:.2f}s")
print(f"Chars: {len(text)}")
print(f"Pages: {savings.pages}")
print(f"Text tokens: {savings.text_tokens}")
print(f"Image tokens: {savings.total_image_tokens}")
print(f"Ratio: {savings.compression_ratio}x")
print(f"Chars/token: {savings.chars_per_token}")
