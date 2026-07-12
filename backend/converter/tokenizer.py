import math
from dataclasses import dataclass
from typing import List

from .renderer import PageResult, MODE_PROFILES


@dataclass
class SavingsResult:
    text_tokens: int
    image_tokens_per_page: int
    total_image_tokens: int
    savings_percent: float
    chars_total: int
    pages: int
    compression_ratio: float
    chars_per_page: int
    chars_per_token: float
    mode: str
    recommendation: str


def estimate_text_tokens(text: str) -> int:
    if not text:
        return 0
    return math.ceil(len(text) / 4)


def estimate_image_tokens(width: int, height: int) -> int:
    cols = math.ceil(width / 28)
    rows = math.ceil(height / 28)
    return cols * rows


def estimate_tokens_only(text: str, mode: str = "standard") -> dict:
    if not text or not text.strip():
        return {
            "text_tokens": 0,
            "estimated_image_tokens": 0,
            "estimated_savings_percent": 0,
            "recommendation": "No content",
            "would_be_worse": False,
            "chars": 0,
        }

    text_tokens = estimate_text_tokens(text)
    chars = len(text)
    profile = MODE_PROFILES.get(mode, MODE_PROFILES["standard"])
    line_height = profile["line_height"]

    max_line_chars = max((len(line) for line in text.split("\n")), default=0)
    char_w = 5.5
    width = min(max(int(max_line_chars * char_w) + 4, 200), 1568)
    lines = math.ceil(chars / (width / char_w))
    height = lines * line_height + line_height + 2

    if height > 1568:
        pages = math.ceil(height / 1568)
        height = 1568
    else:
        pages = 1

    image_tokens = estimate_image_tokens(width, min(height, 1568)) * pages

    if text_tokens > 0:
        savings = round((1 - image_tokens / text_tokens) * 100, 1)
    else:
        savings = 0

    if savings > 30:
        rec = f"Excellent compression ({savings}% savings)"
    elif savings > 0:
        rec = f"Good compression ({savings}% savings)"
    elif savings == 0:
        rec = "Neutral - no savings"
    else:
        rec = f"Image costs {abs(savings)}% MORE tokens - send as text"

    return {
        "text_tokens": text_tokens,
        "estimated_image_tokens": image_tokens,
        "estimated_savings_percent": savings,
        "recommendation": rec,
        "would_be_worse": savings < 0,
        "chars": chars,
        "pages": pages,
    }


def calculate_savings(text: str, pages: List[PageResult]) -> SavingsResult:
    text_tokens = estimate_text_tokens(text)
    chars_total = len(text)

    if not pages:
        return SavingsResult(
            text_tokens=text_tokens,
            image_tokens_per_page=0,
            total_image_tokens=0,
            savings_percent=0,
            chars_total=chars_total,
            pages=0,
            compression_ratio=1.0,
            chars_per_page=0,
            chars_per_token=0,
            mode="none",
            recommendation="No content to convert",
        )

    mode = pages[0].mode
    image_tokens_per_page = [estimate_image_tokens(p.width, p.height) for p in pages]
    total_image_tokens = sum(image_tokens_per_page)
    chars_per_page = chars_total // len(pages)

    if text_tokens > 0:
        savings_percent = round((1 - total_image_tokens / text_tokens) * 100, 1)
        compression_ratio = round(text_tokens / max(total_image_tokens, 1), 1)
    else:
        savings_percent = 0.0
        compression_ratio = 1.0

    chars_per_token = chars_total / max(total_image_tokens, 1)

    if savings_percent > 30:
        recommendation = f"Excellent compression ({savings_percent}% savings). Dense text works great."
    elif savings_percent > 0:
        recommendation = f"Good compression ({savings_percent}% savings). Try 'dense' mode for more."
    elif chars_per_token < 4:
        recommendation = "Sparse text (blank lines, short lines). Consider removing blank lines or using 'dense' mode."
    else:
        recommendation = "Minimal savings. This text density doesn't benefit much from image compression."

    return SavingsResult(
        text_tokens=text_tokens,
        image_tokens_per_page=image_tokens_per_page[0] if image_tokens_per_page else 0,
        total_image_tokens=total_image_tokens,
        savings_percent=max(savings_percent, 0.0),
        chars_total=chars_total,
        pages=len(pages),
        compression_ratio=max(compression_ratio, 1.0),
        chars_per_page=chars_per_page,
        chars_per_token=round(chars_per_token, 1),
        mode=mode,
        recommendation=recommendation,
    )


def format_token_count(tokens: int) -> str:
    if tokens >= 1_000_000:
        return f"{tokens / 1_000_000:.1f}M"
    elif tokens >= 1_000:
        return f"{tokens / 1_000:.1f}K"
    return str(tokens)
