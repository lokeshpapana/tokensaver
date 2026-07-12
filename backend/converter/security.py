import os
import json
import time
import hashlib
import secrets
import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Tuple
from dataclasses import dataclass, field

from fastapi import Request, HTTPException, Security
from fastapi.security import APIKeyHeader

logger = logging.getLogger(__name__)

API_KEY_HEADER = APIKeyHeader(name="X-API-Key", auto_error=False)

RATE_LIMITS = {
    "anonymous": {"requests": 20, "window_seconds": 3600},
    "free": {"requests": 100, "window_seconds": 3600},
    "pro": {"requests": 500, "window_seconds": 3600},
    "unlimited": {"requests": 999999, "window_seconds": 3600},
}

MAX_FILE_SIZE_MB = 10
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
MAX_TEXT_LENGTH = 50_000_000
ALLOWED_EXTENSIONS = {
    ".txt", ".py", ".js", ".ts", ".jsx", ".tsx", ".json", ".jsonl",
    ".xml", ".html", ".htm", ".css", ".md", ".yaml", ".yml", ".toml",
    ".ini", ".cfg", ".csv", ".tsv", ".log", ".sql", ".sh", ".bash",
    ".bat", ".ps1", ".rb", ".go", ".rs", ".java", ".c", ".cpp",
    ".h", ".hpp", ".cs", ".php", ".swift", ".kt", ".r", ".scala",
    ".dart", ".vue", ".svelte", ".env", ".gitignore", ".dockerfile",
    ".makefile", ".cmake", ".gradle", ".lock", ".rst", ".adoc",
    ".tex", ".bib", ".pdf", ".docx",
}

API_KEYS_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "api_keys.json")


@dataclass
class APIKey:
    key_hash: str
    tier: str
    created_at: str
    last_used: Optional[str] = None
    total_requests: int = 0
    is_active: bool = True
    description: str = ""


class RateLimiter:
    def __init__(self):
        self._requests: Dict[str, list] = defaultdict(list)

    def _get_client_id(self, request: Request) -> str:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            ip = forwarded.split(",")[0].strip()
        else:
            ip = request.client.host if request.client else "unknown"
        return ip

    def check_rate_limit(self, request: Request, tier: str = "anonymous") -> Tuple[bool, dict]:
        client_id = self._get_client_id(request)
        limit_config = RATE_LIMITS.get(tier, RATE_LIMITS["anonymous"])
        max_requests = limit_config["requests"]
        window = limit_config["window_seconds"]

        now = time.time()
        cutoff = now - window
        self._requests[client_id] = [
            t for t in self._requests[client_id] if t > cutoff
        ]

        current_count = len(self._requests[client_id])
        remaining = max(0, max_requests - current_count)

        headers = {
            "X-RateLimit-Limit": str(max_requests),
            "X-RateLimit-Remaining": str(remaining),
            "X-RateLimit-Reset": str(int(cutoff + window)),
        }

        if current_count >= max_requests:
            retry_after = int(self._requests[client_id][0] + window - now)
            headers["Retry-After"] = str(max(retry_after, 1))
            return False, headers

        self._requests[client_id].append(now)
        return True, headers


class APIKeyManager:
    def __init__(self):
        self._keys: Dict[str, APIKey] = {}
        self._load_keys()

    def _load_keys(self):
        try:
            if os.path.exists(API_KEYS_FILE):
                with open(API_KEYS_FILE, "r") as f:
                    data = json.load(f)
                    for k, v in data.items():
                        self._keys[k] = APIKey(**v)
        except Exception as e:
            logger.warning(f"Could not load API keys: {e}")

    def _save_keys(self):
        try:
            os.makedirs(os.path.dirname(API_KEYS_FILE), exist_ok=True)
            data = {k: v.__dict__ for k, v in self._keys.items()}
            with open(API_KEYS_FILE, "w") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.error(f"Could not save API keys: {e}")

    def generate_key(self, tier: str = "free", description: str = "") -> str:
        raw_key = secrets.token_urlsafe(32)
        key_hash = hashlib.sha256(raw_key.encode()).hexdigest()

        self._keys[key_hash] = APIKey(
            key_hash=key_hash,
            tier=tier,
            created_at=datetime.now(timezone.utc).isoformat(),
            description=description,
        )
        self._save_keys()
        return raw_key

    def validate_key(self, raw_key: str) -> Optional[APIKey]:
        key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
        key = self._keys.get(key_hash)
        if key and key.is_active:
            key.last_used = datetime.now(timezone.utc).isoformat()
            key.total_requests += 1
            if key.total_requests % 100 == 0:
                self._save_keys()
            return key
        return None

    def revoke_key(self, raw_key: str) -> bool:
        key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
        if key_hash in self._keys:
            self._keys[key_hash].is_active = False
            self._save_keys()
            return True
        return False

    def get_tier(self, raw_key: Optional[str]) -> str:
        if not raw_key:
            return "anonymous"
        key = self.validate_key(raw_key)
        return key.tier if key else "anonymous"


class SecurityMiddleware:
    def __init__(self):
        self.rate_limiter = RateLimiter()
        self.api_key_manager = APIKeyManager()

    def validate_file_upload(self, filename: str, file_size: int) -> None:
        ext = os.path.splitext(filename)[1].lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"File type '{ext}' not supported. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
            )
        if file_size > MAX_FILE_SIZE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"File too large. Maximum size: {MAX_FILE_SIZE_MB}MB"
            )
        if file_size == 0:
            raise HTTPException(status_code=400, detail="File is empty")

    def get_client_ip(self, request: Request) -> str:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"


security_middleware = SecurityMiddleware()


async def get_api_key_tier(
    request: Request,
    api_key: Optional[str] = Security(API_KEY_HEADER),
) -> str:
    return security_middleware.api_key_manager.get_tier(api_key)


async def require_rate_limit(
    request: Request,
    tier: str = Security(get_api_key_tier),
) -> dict:
    allowed, headers = security_middleware.rate_limiter.check_rate_limit(request, tier)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded. Upgrade your API tier for more requests.",
            headers=headers,
        )
    return {"tier": tier, "headers": headers}
