import math
import logging
import os
from io import BytesIO
from dataclasses import dataclass
from typing import List, Dict
from concurrent.futures import ThreadPoolExecutor

from PIL import Image, ImageDraw, ImageFont
from .code_optimizer import optimize_code, detect_code_style

logger = logging.getLogger(__name__)

MAX_PAGE_WIDTH = 1568
MAX_PAGE_HEIGHT = 1568
PADDING = 0
BG_COLOR = "#1e1e1e"
TEXT_COLOR = "#d4d4d4"
BANNER_COLOR = "#569cd6"
LINE_NUM_COLOR = "#858585"
BANNER_BG = "#252526"
THIN_LINE_COLOR = "#333333"

FONT_CANDIDATES = [
    "CascadiaMono.ttf", "CascadiaMono-Regular.ttf", "Consolas.ttf",
    "DejaVuSansMono.ttf", "LiberationMono-Regular.ttf", "Courier New", "cour.ttf",
]
FONT_PATHS = [
    "C:/Windows/Fonts/consola.ttf", "C:/Windows/Fonts/cascadia.ttf",
    "C:/Windows/Fonts/cour.ttf", "C:/Windows/Fonts/lucon.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
    "/System/Library/Fonts/Menlo.ttc",
]

MODE_PROFILES = {
    "readable": {"font_size": 11, "line_height": 12},
    "standard": {"font_size": 10, "line_height": 11},
    "dense": {"font_size": 8, "line_height": 9},
}

_font_cache: Dict[int, ImageFont.FreeTypeFont] = {}
_char_width_cache: Dict[int, float] = {}


@dataclass
class PageResult:
    image_bytes: bytes
    width: int
    height: int
    char_count: int
    page_num: int
    total_pages: int
    line_count: int
    mode: str


def _load_font(size: int) -> ImageFont.FreeTypeFont:
    if size in _font_cache:
        return _font_cache[size]
    font = None
    for name in FONT_CANDIDATES:
        try:
            font = ImageFont.truetype(name, size)
            break
        except (OSError, IOError):
            continue
    if not font:
        for path in FONT_PATHS:
            try:
                font = ImageFont.truetype(path, size)
                break
            except (OSError, IOError):
                continue
    if not font:
        font = ImageFont.load_default()
    _font_cache[size] = font
    return font


def _get_char_width(font: ImageFont.FreeTypeFont) -> float:
    size = font.size if hasattr(font, 'size') else 10
    if size in _char_width_cache:
        return _char_width_cache[size]
    try:
        bbox = font.getbbox("M")
        w = bbox[2] - bbox[0]
    except AttributeError:
        w = size * 0.6
    _char_width_cache[size] = w
    return w


def _wrap_text_fast(text: str, font: ImageFont.FreeTypeFont, max_width: int) -> List[str]:
    char_w = _get_char_width(font)
    max_chars = max(int(max_width / char_w), 1)
    lines = []
    for paragraph in text.split("\n"):
        if not paragraph:
            lines.append("")
            continue
        while len(paragraph) > max_chars:
            lines.append(paragraph[:max_chars])
            paragraph = paragraph[max_chars:]
        lines.append(paragraph)
    return lines


def _calculate_optimal_width(lines: List[str], char_w: float, max_width: int = MAX_PAGE_WIDTH) -> int:
    max_line_len = 0
    for line in lines:
        if len(line) > max_line_len:
            max_line_len = len(line)
    needed_width = int(max_line_len * char_w) + 4
    return min(max(needed_width, 200), max_width)


def _render_page(lines, filename, page_num, total_pages, font, line_height, show_line_numbers, page_width):
    line_count = len(lines)
    char_w = _get_char_width(font)
    banner_height = line_height + 2
    img_height = banner_height + (line_count * line_height)

    img = Image.new("RGB", (page_width, img_height), BG_COLOR)
    draw = ImageDraw.Draw(img)
    draw.rectangle([(0, 0), (page_width, banner_height)], fill=BANNER_BG)
    banner_text = f"FILE: {filename} | PAGE {page_num}/{total_pages} | LINES: {line_count}"
    draw.text((0, 1), banner_text, fill=BANNER_COLOR, font=font)

    y = banner_height
    text_x = 30 if show_line_numbers else 0
    for i, line in enumerate(lines):
        if show_line_numbers:
            draw.text((0, y), str(i + 1).rjust(4), fill=LINE_NUM_COLOR, font=font)
        if line.strip():
            draw.text((text_x, y), line, fill=TEXT_COLOR, font=font)
        else:
            x1 = text_x
            x2 = min(text_x + int(20 * char_w), page_width)
            mid_y = y + line_height // 2
            draw.line([(x1, mid_y), (x2, mid_y)], fill=THIN_LINE_COLOR, width=1)
        y += line_height

    buf = BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return PageResult(
        image_bytes=buf.getvalue(), width=page_width, height=img_height,
        char_count=sum(len(l) for l in lines), page_num=page_num,
        total_pages=total_pages, line_count=line_count, mode="",
    )


def render_text_to_pages(text, filename, mode="standard", show_line_numbers=False, optimize=True):
    if not text or not text.strip():
        return []

    ext = os.path.splitext(filename)[1].lower() if filename else ".txt"
    if optimize:
        style = detect_code_style(text, ext)
        if style in ("indent", "brace"):
            text = optimize_code(text, ext, aggressive=(mode == "dense"))

    profile = MODE_PROFILES.get(mode, MODE_PROFILES["standard"])
    font_size = profile["font_size"]
    line_height = profile["line_height"]
    font = _load_font(font_size)
    char_w = _get_char_width(font)

    usable_width = MAX_PAGE_WIDTH
    if show_line_numbers:
        usable_width -= 30

    all_lines = _wrap_text_fast(text, font, usable_width)
    optimal_width = _calculate_optimal_width(all_lines, char_w, MAX_PAGE_WIDTH)

    usable_width = optimal_width
    if show_line_numbers:
        usable_width -= 30
    all_lines = _wrap_text_fast(text, font, usable_width)

    usable_height = MAX_PAGE_HEIGHT - line_height - 2
    lines_per_page = max(usable_height // line_height, 1)
    total_pages = math.ceil(len(all_lines) / lines_per_page)

    if total_pages <= 4:
        pages = []
        for i in range(total_pages):
            start = i * lines_per_page
            page_lines = all_lines[start:start + lines_per_page]
            page = _render_page(
                page_lines, filename, i + 1, total_pages, font, line_height,
                show_line_numbers, optimal_width,
            )
            page.mode = mode
            pages.append(page)
        return pages
    else:
        page_args = []
        for i in range(total_pages):
            start = i * lines_per_page
            page_lines = all_lines[start:start + lines_per_page]
            page_args.append((page_lines, filename, i + 1, total_pages, font, line_height, show_line_numbers, optimal_width))

        pages = []
        with ThreadPoolExecutor(max_workers=min(total_pages, 4)) as executor:
            futures = [executor.submit(_render_page, *args) for args in page_args]
            for future in futures:
                page = future.result()
                page.mode = mode
                pages.append(page)
        return pages
