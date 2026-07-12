import sys
sys.path.insert(0, '.')
from converter.renderer import render_text_to_pages
from converter.tokenizer import calculate_savings, estimate_text_tokens

# Read a real Python file if available, otherwise use realistic mock
try:
    with open("app.py", "r") as f:
        text = f.read()
    filename = "app.py"
except:
    # Realistic Python file
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
    # Process text
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
''' * 100
    filename = "mock_app.py"

text_tokens = estimate_text_tokens(text)
pages = render_text_to_pages(text, filename)
savings = calculate_savings(text, pages)

print(f"File: {filename}")
print(f"Text length: {len(text)} chars")
print(f"Text tokens: {text_tokens}")
print(f"Pages: {savings.pages}")
print(f"Image tokens: {savings.total_image_tokens}")
print(f"Compression ratio: {savings.compression_ratio}x")
print(f"Savings: {savings.savings_percent}%")
