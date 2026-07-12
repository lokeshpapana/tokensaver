import json
import os
import uuid
from datetime import datetime, timezone
from dataclasses import dataclass, asdict
from typing import List, Optional
from pathlib import Path

HISTORY_DIR = Path(__file__).parent.parent / "data"
HISTORY_FILE = HISTORY_DIR / "history.json"


@dataclass
class ConversionRecord:
    id: str
    original_filename: str
    file_type: str
    char_count: int
    text_tokens_est: int
    image_tokens_est: int
    savings_percent: float
    num_pages: int
    timestamp: str
    output_filenames: List[str]
    client_ip: str
    api_key_hint: Optional[str] = None


def _ensure_dir():
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)


def _read_history() -> List[dict]:
    _ensure_dir()
    if not HISTORY_FILE.exists():
        return []
    try:
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except (json.JSONDecodeError, IOError):
        return []


def _write_history(records: List[dict]):
    _ensure_dir()
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, ensure_ascii=False)


def load_history(limit: int = 100, client_ip: Optional[str] = None) -> List[ConversionRecord]:
    records = _read_history()
    if client_ip:
        records = [r for r in records if r.get("client_ip") == client_ip]
    records = records[-limit:]
    return [ConversionRecord(**r) for r in records]


def save_to_history(
    original_filename: str,
    file_type: str,
    char_count: int,
    text_tokens_est: int,
    image_tokens_est: int,
    savings_percent: float,
    num_pages: int,
    output_filenames: List[str],
    client_ip: str,
    api_key_hint: Optional[str] = None,
) -> ConversionRecord:
    record = ConversionRecord(
        id=str(uuid.uuid4())[:8],
        original_filename=original_filename,
        file_type=file_type,
        char_count=char_count,
        text_tokens_est=text_tokens_est,
        image_tokens_est=image_tokens_est,
        savings_percent=savings_percent,
        num_pages=num_pages,
        timestamp=datetime.now(timezone.utc).isoformat(),
        output_filenames=output_filenames,
        client_ip=client_ip,
        api_key_hint=api_key_hint,
    )

    records = _read_history()
    records.append(asdict(record))

    if len(records) > 10000:
        records = records[-5000:]

    _write_history(records)
    return record


def get_stats(client_ip: Optional[str] = None) -> dict:
    records = _read_history()
    if client_ip:
        records = [r for r in records if r.get("client_ip") == client_ip]

    if not records:
        return {
            "total_conversions": 0,
            "total_chars": 0,
            "total_text_tokens_saved": 0,
            "total_image_tokens_used": 0,
            "avg_savings_percent": 0,
        }

    total_conversions = len(records)
    total_chars = sum(r.get("char_count", 0) for r in records)
    total_text_tokens = sum(r.get("text_tokens_est", 0) for r in records)
    total_image_tokens = sum(r.get("image_tokens_est", 0) for r in records)
    avg_savings = sum(r.get("savings_percent", 0) for r in records) / total_conversions

    return {
        "total_conversions": total_conversions,
        "total_chars": total_chars,
        "total_text_tokens_saved": total_text_tokens - total_image_tokens,
        "total_image_tokens_used": total_image_tokens,
        "avg_savings_percent": round(avg_savings, 1),
    }
