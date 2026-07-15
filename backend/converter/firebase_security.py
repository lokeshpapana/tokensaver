import os
import json
import time
import hashlib
import logging
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Tuple, List, Any, Callable
from dataclasses import dataclass, field, asdict
from functools import lru_cache

from fastapi import Request, HTTPException, Security, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

import firebase_admin
from firebase_admin import credentials, auth, firestore

logger = logging.getLogger(__name__)

logger = logging.getLogger(__name__)

# Timeout configuration
FIRESTORE_TIMEOUT = 5.0  # seconds


async def with_timeout(coro: Any, timeout: float = FIRESTORE_TIMEOUT) -> Any:
    """Execute a coroutine with a timeout, with fallback."""
    try:
        return await asyncio.wait_for(coro, timeout=timeout)
    except asyncio.TimeoutError:
        logger.warning(f"Firestore operation timed out after {timeout}s")
        raise asyncio.TimeoutError(f"Operation timed out after {timeout}s")
    except Exception as e:
        logger.warning(f"Firestore operation failed: {e}")
        raise


async def run_in_thread(coro: Any, timeout: float = FIRESTORE_TIMEOUT) -> Any:
    """Run a sync function in a thread pool with timeout."""
    try:
        return await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(None, coro),
            timeout=timeout
        )
    except asyncio.TimeoutError:
        logger.warning(f"Firestore operation timed out after {timeout}s")
        raise asyncio.TimeoutError(f"Operation timed out after {timeout}s")
    except Exception as e:
        logger.warning(f"Firestore operation failed: {e}")
        raise


# ============================================================
# Firebase Initialization
# ============================================================

# Development mode flag - set to True for local development without Firebase
DEV_MODE = os.getenv("FIREBASE_DEV_MODE", "true").lower() == "true"

def _initialize_firebase() -> None:
    if DEV_MODE:
        logger.info("Running in DEV_MODE - Firebase initialization skipped")
        return
        
    if not firebase_admin._apps:
        cred_path = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH")
        cred_json = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
        
        if cred_json:
            cred_dict = json.loads(cred_json)
            cred = credentials.Certificate(cred_dict)
        elif cred_path and os.path.exists(cred_path):
            cred = credentials.Certificate(cred_path)
        else:
            # Try default credentials (works on Cloud Run, Render with service account)
            cred = credentials.ApplicationDefault()
        
        firebase_admin.initialize_app(cred)

_initialize_firebase()

if not DEV_MODE:
    db = firestore.client()
    auth_client = auth
else:
    # Mock clients for development
    db = None
    auth_client = None

# ============================================================
# Security Constants
# ============================================================

BEARER_SCHEME = HTTPBearer(auto_error=False)

RATE_LIMITS = {
    "anonymous": {"requests": 20, "window_seconds": 3600},
    "free": {"requests": 100, "window_seconds": 3600},
    "pro": {"requests": 500, "window_seconds": 3600},
    "unlimited": {"requests": 999999, "window_seconds": 3600},
}

DEFAULT_TIER_CONFIG = {
    "anonymous": {"requests_per_hour": 20, "max_file_mb": 5, "max_text_chars": 1_000_000, "max_batch_files": 5},
    "free": {"requests_per_hour": 100, "max_file_mb": 10, "max_text_chars": 50_000_000, "max_batch_files": 20},
    "pro": {"requests_per_hour": 500, "max_file_mb": 50, "max_text_chars": 200_000_000, "max_batch_files": 50},
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

# Firestore Collections
USERS_COLLECTION = "users"
API_KEYS_COLLECTION = "api_keys"
RATE_LIMITS_COLLECTION = "rate_limits"
TIERS_COLLECTION = "tiers"
HISTORY_COLLECTION = "history"


# ============================================================
# Data Models
# ============================================================

@dataclass
class User:
    uid: str
    email: Optional[str] = None
    display_name: Optional[str] = None
    email_verified: bool = False
    tier: str = "free"
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    last_login: Optional[str] = None
    is_active: bool = True
    metadata: Dict = field(default_factory=dict)
    
    def to_dict(self) -> Dict:
        return asdict(self)
    
    @classmethod
    def from_doc(cls, doc: firestore.DocumentSnapshot) -> "User":
        data = doc.to_dict() or {}
        data["uid"] = doc.id
        return cls(**data)


@dataclass
class APIKey:
    key_hash: str
    uid: str
    tier: str
    created_at: str
    last_used: Optional[str] = None
    total_requests: int = 0
    is_active: bool = True
    description: str = ""
    prefix: str = ""  # First 8 chars for display
    
    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class RateLimitInfo:
    allowed: bool
    headers: Dict[str, str]
    tier: str
    current_count: int
    max_requests: int
    reset_time: int


# ============================================================
# Firebase Auth Verification
# ============================================================

class FirebaseAuthError(Exception):
    def __init__(self, message: str, code: str = "AUTH_ERROR"):
        self.message = message
        self.code = code
        super().__init__(message)


async def verify_firebase_token(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Security(BEARER_SCHEME),
) -> Dict:
    """
    Verify Firebase ID token from Authorization header.
    Returns decoded token claims (uid, email, etc.) or raises HTTPException.
    """
    # Allow anonymous access - return empty claims
    if not credentials:
        return {"uid": None, "email": None, "tier": "anonymous", "anonymous": True}
    
    token = credentials.credentials
    
    try:
        decoded_token = auth_client.verify_id_token(token, check_revoked=True)
        uid = decoded_token.get("uid")
        email = decoded_token.get("email")
        email_verified = decoded_token.get("email_verified", False)
        
        # Get user tier from Firestore
        tier = await _get_user_tier(uid)
        
        return {
            "uid": uid,
            "email": email,
            "email_verified": email_verified,
            "tier": tier,
            "anonymous": False,
            "decoded_token": decoded_token,
        }
    except auth.ExpiredIdTokenError:
        raise HTTPException(status_code=401, detail="Token expired. Please re-authenticate.")
    except auth.RevokedIdTokenError:
        raise HTTPException(status_code=401, detail="Token revoked. Please re-authenticate.")
    except auth.InvalidIdTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")
    except Exception as e:
        logger.error(f"Token verification failed: {e}")
        raise HTTPException(status_code=401, detail="Authentication failed")


async def _get_user_tier(uid: str) -> str:
    """Fetch user's tier from Firestore with timeout."""
    async def _get():
        doc = db.collection(USERS_COLLECTION).document(uid).get()
        if doc.exists:
            data = doc.to_dict()
            return data.get("tier", "free")
        return "free"
    
    try:
        return await run_in_thread(_get, timeout=FIRESTORE_TIMEOUT)
    except Exception as e:
        logger.warning(f"Failed to fetch tier for {uid}: {e}")
        return "free"


# ============================================================
# User Management
# ============================================================

async def get_or_create_user(uid: str, email: Optional[str] = None, display_name: Optional[str] = None) -> User:
    """Get existing user or create new one with default tier."""
    async def _get_or_create():
        user_ref = db.collection(USERS_COLLECTION).document(uid)
        doc = user_ref.get()
        
        if doc.exists:
            user = User.from_doc(doc)
            # Update last_login
            user_ref.update({"last_login": datetime.now(timezone.utc).isoformat()})
            return user
        
        # Create new user
        user = User(
            uid=uid,
            email=email,
            display_name=display_name,
            email_verified=False,
            tier="free",
        )
        user_ref.set(user.to_dict())
        return user
    
    try:
        return await run_in_thread(_get_or_create, timeout=FIRESTORE_TIMEOUT)
    except Exception as e:
        logger.error(f"Failed to get/create user {uid}: {e}")
        # Return a default user as fallback
        return User(uid=uid, email=email, display_name=display_name, tier="free")


async def update_user_tier(uid: str, new_tier: str) -> bool:
    """Update user's tier (admin only)."""
    async def _update():
        db.collection(USERS_COLLECTION).document(uid).update({"tier": new_tier})
        return True
    
    try:
        return await run_in_thread(_update, timeout=FIRESTORE_TIMEOUT)
    except Exception as e:
        logger.error(f"Failed to update tier for {uid}: {e}")
        return False


# ============================================================
# API Key Management (Firestore)
# ============================================================

class FirestoreAPIKeyManager:
    """API Key management backed by Firestore."""
    
    @staticmethod
    def _hash_key(raw_key: str) -> str:
        return hashlib.sha256(raw_key.encode()).hexdigest()
    
    @staticmethod
    def _key_prefix(raw_key: str) -> str:
        return raw_key[:8]
    
    def generate_key(self, uid: str, tier: str = "free", description: str = "") -> str:
        """Generate new API key for user."""
        async def _generate():
            raw_key = f"tsk_{hashlib.sha256(os.urandom(32)).hexdigest()[:32]}"
            key_hash = self._hash_key(raw_key)
            prefix = self._key_prefix(raw_key)
            
            api_key = APIKey(
                key_hash=key_hash,
                uid=uid,
                tier=tier,
                created_at=datetime.now(timezone.utc).isoformat(),
                description=description,
                prefix=prefix,
            )
            
            db.collection(API_KEYS_COLLECTION).document(key_hash).set(api_key.to_dict())
            return raw_key
        
        try:
            return await run_in_thread(_generate, timeout=FIRESTORE_TIMEOUT)
        except Exception as e:
            logger.error(f"Failed to generate API key for {uid}: {e}")
            raise HTTPException(status_code=500, detail="Failed to generate API key")
    
    def validate_key(self, raw_key: str) -> Optional[APIKey]:
        """Validate API key and update usage stats."""
        async def _validate():
            key_hash = self._hash_key(raw_key)
            doc = db.collection(API_KEYS_COLLECTION).document(key_hash).get()
            
            if not doc.exists:
                return None
            
            data = doc.to_dict()
            if not data.get("is_active", False):
                return None
            
            # Update last_used and increment request count
            doc.reference.update({
                "last_used": datetime.now(timezone.utc).isoformat(),
                "total_requests": firestore.Increment(1),
            })
            
            data["key_hash"] = key_hash
            return APIKey(**data)
        
        try:
            return await run_in_thread(_validate, timeout=FIRESTORE_TIMEOUT)
        except Exception as e:
            logger.warning(f"API key validation failed: {e}")
            return None
    
    def revoke_key(self, raw_key: str) -> bool:
        """Revoke an API key."""
        key_hash = self._hash_key(raw_key)
        try:
            db.collection(API_KEYS_COLLECTION).document(key_hash).update({"is_active": False})
            return True
        except Exception:
            return False
    
    def list_keys(self, uid: str) -> List[Dict]:
        """List all API keys for a user (without raw keys)."""
        query = db.collection(API_KEYS_COLLECTION).where("uid", "==", uid).stream()
        keys = []
        for doc in query:
            data = doc.to_dict()
            keys.append({
                "prefix": data.get("prefix", ""),
                "tier": data.get("tier", "free"),
                "created_at": data.get("created_at", ""),
                "last_used": data.get("last_used"),
                "total_requests": data.get("total_requests", 0),
                "is_active": data.get("is_active", False),
                "description": data.get("description", ""),
                "key_hash": doc.id[:16] + "...",  # Partial for identification
            })
        return keys


# ============================================================
# Distributed Rate Limiter (Firestore)
# ============================================================

class FirestoreRateLimiter:
    """Sliding window rate limiter using Firestore atomic increments."""
    
    def __init__(self):
        self._local_cache: Dict[str, Tuple[float, int]] = {}  # Fallback cache
        self._cache_ttl = 60  # seconds
    
    def _get_window_key(self, identifier: str, window_seconds: int) -> str:
        """Generate document ID for current time window."""
        window_start = int(time.time() // window_seconds) * window_seconds
        return f"{identifier}_{window_start}"
    
    async def check_rate_limit(
        self,
        identifier: str,
        tier: str = "anonymous",
        custom_limit: Optional[Dict] = None,
    ) -> RateLimitInfo:
        """
        Check and increment rate limit for identifier.
        Uses Firestore transaction for atomicity.
        """
        limit_config = custom_limit or RATE_LIMITS.get(tier, RATE_LIMITS["anonymous"])
        max_requests = limit_config["requests"]
        window = limit_config["window_seconds"]
        
        window_key = self._get_window_key(identifier, window)
        now = time.time()
        cutoff = now - window
        reset_time = int((now // window + 1) * window)
        
try:
            # Use transaction for atomic read-increment-write
            @firestore.transactional
            def increment_in_transaction(transaction):
                doc_ref = db.collection(RATE_LIMITS_COLLECTION).document(window_key)
                snapshot = doc_ref.get(transaction=transaction)
                
                current_count = 0
                if snapshot.exists:
                    data = snapshot.to_dict()
                    current_count = data.get("count", 0)
                
                new_count = current_count + 1
                transaction.set(doc_ref, {
                    "count": new_count,
                    "window_start": int(now // window) * window,
                    "identifier": identifier,
                    "tier": tier,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
                return new_count
            
            transaction = db.transaction()
            current_count = await run_in_thread(
                lambda: increment_in_transaction(transaction),
                timeout=FIRESTORE_TIMEOUT
            )
            
            # Update local cache
            self._local_cache[window_key] = (now, current_count)
            
        except Exception as e:
            logger.warning(f"Firestore rate limit failed, using local cache: {e}")
            # Fallback to local cache
            current_count = await self._local_fallback(identifier, window_key, window, now)
        
        remaining = max(0, max_requests - current_count)
        allowed = current_count <= max_requests
        
        headers = {
            "X-RateLimit-Limit": str(max_requests),
            "X-RateLimit-Remaining": str(remaining),
            "X-RateLimit-Reset": str(reset_time),
        }
        
        if not allowed:
            retry_after = max(1, reset_time - int(now))
            headers["Retry-After"] = str(retry_after)
        
        return RateLimitInfo(
            allowed=allowed,
            headers=headers,
            tier=tier,
            current_count=current_count,
            max_requests=max_requests,
            reset_time=reset_time,
        )
    
    async def _local_fallback(
        self,
        identifier: str,
        window_key: str,
        window: int,
        now: float,
    ) -> int:
        """Local in-memory fallback when Firestore is unavailable."""
        # Clean old entries
        cutoff = now - window
        self._local_cache = {
            k: v for k, v in self._local_cache.items()
            if v[0] > cutoff
        }
        
        if window_key in self._local_cache:
            _, count = self._local_cache[window_key]
            count += 1
        else:
            count = 1
        
        self._local_cache[window_key] = (now, count)
        return count
    
    async def cleanup_old_windows(self) -> int:
        """Clean up old rate limit documents (run periodically)."""
        try:
            cutoff = int((time.time() - 86400) // 3600) * 3600  # 24 hours ago
            query = db.collection(RATE_LIMITS_COLLECTION).where(
                "window_start", "<", cutoff
            ).limit(500).stream()
            
            batch = db.batch()
            count = 0
            for doc in query:
                batch.delete(doc.reference)
                count += 1
            
            if count > 0:
                batch.commit()
            return count
        except Exception as e:
            logger.error(f"Rate limit cleanup failed: {e}")
            return 0


# ============================================================
# File Validation
# ============================================================

class SecurityMiddleware:
    def __init__(self):
        self.rate_limiter = FirestoreRateLimiter()
        self.api_key_manager = FirestoreAPIKeyManager()
    
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
    
    def get_tier_limits(self, tier: str) -> Dict:
        return DEFAULT_TIER_CONFIG.get(tier, DEFAULT_TIER_CONFIG["free"])


# ============================================================
# FastAPI Dependencies
# ============================================================

security_middleware = SecurityMiddleware()


async def get_user_context(
    request: Request,
    auth_data: Dict = Depends(verify_firebase_token),
) -> Dict:
    """Get user context including tier and rate limit info."""
    uid = auth_data.get("uid")
    tier = auth_data.get("tier", "anonymous")
    
    # Rate limiting
    if uid:
        identifier = f"user:{uid}"
    else:
        identifier = f"ip:{security_middleware.get_client_ip(request)}"
    
    rate_info = await security_middleware.rate_limiter.check_rate_limit(identifier, tier)
    
    if not rate_info.allowed:
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded. Upgrade your tier for more requests.",
            headers=rate_info.headers,
        )
    
    return {
        "uid": uid,
        "email": auth_data.get("email"),
        "tier": tier,
        "anonymous": auth_data.get("anonymous", True),
        "rate_limit": rate_info,
        "tier_limits": security_middleware.get_tier_limits(tier),
    }


# Backward compatibility
async def get_api_key_tier(
    request: Request,
    auth_data: Dict = Depends(verify_firebase_token),
) -> str:
    """Legacy dependency - returns tier string."""
    return auth_data.get("tier", "anonymous")


async def require_rate_limit(
    user_ctx: Dict = Depends(get_user_context),
) -> Dict:
    """Legacy dependency - returns rate limit info."""
    return {
        "tier": user_ctx["tier"],
        "headers": user_ctx["rate_limit"].headers,
    }


# ============================================================
# History Management (Firestore)
# ============================================================

@dataclass
class HistoryRecord:
    id: str
    uid: str
    filename: str
    file_type: str
    char_count: int
    text_tokens: int
    image_tokens: int
    savings_percent: float
    pages: int
    timestamp: str
    
    def to_dict(self) -> Dict:
        return asdict(self)
    
    @classmethod
    def from_doc(cls, doc: firestore.DocumentSnapshot) -> "HistoryRecord":
        data = doc.to_dict() or {}
        data["id"] = doc.id
        return cls(**data)


async def save_to_history(
    uid: Optional[str],
    filename: str,
    file_type: str,
    char_count: int,
    text_tokens: int,
    image_tokens: int,
    savings_percent: float,
    pages: int,
) -> str:
    """Save conversion history to Firestore (user-scoped or anonymous)."""
    async def _save():
        if uid:
            # User-scoped history
            user_ref = db.collection(USERS_COLLECTION).document(uid)
            history_ref = user_ref.collection(HISTORY_COLLECTION).document()
        else:
            # Anonymous - use shared collection with IP hash
            ip_hash = hashlib.sha256(f"anon_{time.time()}".encode()).hexdigest()[:16]
            history_ref = db.collection("anonymous_history").document(ip_hash)
        
        record = HistoryRecord(
            id=history_ref.id,
            uid=uid or "anonymous",
            filename=filename,
            file_type=file_type,
            char_count=char_count,
            text_tokens=text_tokens,
            image_tokens=image_tokens,
            savings_percent=savings_percent,
            pages=pages,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
        
        history_ref.set(record.to_dict())
        return history_ref.id
    
    try:
        return await run_in_thread(_save, timeout=FIRESTORE_TIMEOUT)
    except Exception as e:
        logger.warning(f"Firestore save_to_history failed: {e}")
        # Return a local ID as fallback
        return f"local_{int(time.time() * 1000)}"


async def load_history(uid: Optional[str], limit: int = 50) -> List[HistoryRecord]:
    """Load conversion history for user or anonymous."""
    async def _load():
        if uid:
            query = db.collection(USERS_COLLECTION).document(uid).collection(HISTORY_COLLECTION)
        else:
            # For anonymous, we don't have a good way to query by user
            # This would need a different approach (e.g., session-based)
            query = db.collection("anonymous_history")
        
        docs = query.order_by("timestamp", direction=firestore.Query.DESCENDING).limit(limit).stream()
        return [HistoryRecord.from_doc(doc) for doc in docs]
    
    try:
        return await run_in_thread(_load, timeout=FIRESTORE_TIMEOUT)
    except Exception as e:
        logger.warning(f"Firestore load_history failed: {e}")
        return []


async def get_stats(uid: Optional[str]) -> Dict:
    """Get user statistics."""
    if not uid:
        return {"total_conversions": 0, "total_text_tokens_saved": 0, "avg_savings_percent": 0}
    
    async def _get_stats():
        docs = db.collection(USERS_COLLECTION).document(uid).collection(HISTORY_COLLECTION).stream()
        
        total = 0
        total_saved = 0
        total_savings = 0.0
        
        for doc in docs:
            data = doc.to_dict()
            total += 1
            total_saved += data.get("text_tokens", 0) - data.get("image_tokens", 0)
            total_savings += data.get("savings_percent", 0)
        
        return {
            "total_conversions": total,
            "total_text_tokens_saved": max(0, total_saved),
            "avg_savings_percent": round(total_savings / total, 1) if total > 0 else 0,
        }
    
    try:
        return await run_in_thread(_get_stats, timeout=FIRESTORE_TIMEOUT)
    except Exception as e:
        logger.warning(f"Firestore get_stats failed: {e}")
        return {"total_conversions": 0, "total_text_tokens_saved": 0, "avg_savings_percent": 0}


# Add timeout constant near the top
FIRESTORE_TIMEOUT = 5.0  # seconds

# Helper function to run blocking Firestore calls with timeout
async def run_in_thread(func, timeout: float = FIRESTORE_TIMEOUT):
    """Run a blocking function in a thread pool with timeout."""
    loop = asyncio.get_event_loop()
    try:
        return await asyncio.wait_for(
            loop.run_in_executor(None, func),
            timeout=timeout
        )
    except asyncio.TimeoutError:
        raise asyncio.TimeoutError(f"Firestore operation timed out after {FIRESTORE_TIMEOUT}s")
    except Exception as e:
        logger.warning(f"Firestore operation failed: {e}")
        raise
async def init_default_tiers():
    """Initialize default tier configurations in Firestore."""
    try:
        from firebase_admin import firestore
        db = firestore.client()
        for tier_name, config in DEFAULT_TIER_CONFIG.items():
            doc_ref = db.collection(TIERS_COLLECTION).document(tier_name)
            doc = doc_ref.get()
            if not doc.exists:
                doc_ref.set({
                    **config,
                    "name": tier_name,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
    except Exception as e:
        logger.warning(f"Failed to initialize default tiers: {e}")


# ============================================================
# Dev Mode Mock Implementations
# ============================================================

if DEV_MODE:
    # In-memory storage for development
    _dev_users: Dict[str, Dict] = {}
    _dev_api_keys: Dict[str, Dict] = {}
    _dev_rate_limits: Dict[str, Tuple[float, int]] = {}
    _dev_history: Dict[str, List[Dict]] = {}
    _dev_api_key_counter = 0
    
    async def _get_user_tier(uid: str) -> str:
        user = _dev_users.get(uid, {})
        return user.get("tier", "free")
    
    async def get_or_create_user(uid: str, email: Optional[str] = None, display_name: Optional[str] = None) -> User:
        if uid not in _dev_users:
            _dev_users[uid] = {
                "uid": uid,
                "email": email,
                "display_name": display_name,
                "email_verified": False,
                "tier": "free",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "last_login": datetime.now(timezone.utc).isoformat(),
                "is_active": True,
                "metadata": {},
            }
        _dev_users[uid]["last_login"] = datetime.now(timezone.utc).isoformat()
        return User(**_dev_users[uid])
    
    async def update_user_tier(uid: str, new_tier: str) -> bool:
        if uid in _dev_users:
            _dev_users[uid]["tier"] = new_tier
            return True
        return False
    
    class _MockAPIKeyManager:
        @staticmethod
        def _hash_key(raw_key: str) -> str:
            return hashlib.sha256(raw_key.encode()).hexdigest()
        
        @staticmethod
        def _key_prefix(raw_key: str) -> str:
            return raw_key[:8]
        
        def generate_key(self, uid: str, tier: str = "free", description: str = "") -> str:
            global _dev_api_key_counter
            _dev_api_key_counter += 1
            raw_key = f"tsk_dev_{hashlib.sha256(os.urandom(16)).hexdigest()[:24]}"
            key_hash = self._hash_key(raw_key)
            prefix = self._key_prefix(raw_key)
            
            _dev_api_keys[key_hash] = {
                "key_hash": key_hash,
                "uid": uid,
                "tier": tier,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "last_used": None,
                "total_requests": 0,
                "is_active": True,
                "description": description,
                "prefix": prefix,
            }
            return raw_key
        
        def validate_key(self, raw_key: str) -> Optional[APIKey]:
            key_hash = self._hash_key(raw_key)
            data = _dev_api_keys.get(key_hash)
            if not data or not data.get("is_active"):
                return None
            data["last_used"] = datetime.now(timezone.utc).isoformat()
            data["total_requests"] = data.get("total_requests", 0) + 1
            data["key_hash"] = key_hash
            return APIKey(**data)
        
        def revoke_key(self, raw_key: str) -> bool:
            key_hash = self._hash_key(raw_key)
            if key_hash in _dev_api_keys:
                _dev_api_keys[key_hash]["is_active"] = False
                return True
            return False
        
        def list_keys(self, uid: str) -> List[Dict]:
            return [
                {
                    "prefix": data.get("prefix", ""),
                    "tier": data.get("tier", "free"),
                    "created_at": data.get("created_at", ""),
                    "last_used": data.get("last_used"),
                    "total_requests": data.get("total_requests", 0),
                    "is_active": data.get("is_active", False),
                    "description": data.get("description", ""),
                    "key_hash": key_id[:16] + "...",
                }
                for key_id, data in _dev_api_keys.items()
                if data.get("uid") == uid
            ]
    
    class _MockRateLimiter:
        def __init__(self):
            self._cache: Dict[str, Tuple[float, int]] = {}
            self._cache_ttl = 60
        
        def _get_window_key(self, identifier: str, window_seconds: int) -> str:
            window_start = int(time.time() // window_seconds) * window_seconds
            return f"{identifier}_{window_start}"
        
        async def check_rate_limit(
            self,
            identifier: str,
            tier: str = "anonymous",
            custom_limit: Optional[Dict] = None,
        ) -> RateLimitInfo:
            limit_config = custom_limit or RATE_LIMITS.get(tier, RATE_LIMITS["anonymous"])
            max_requests = limit_config["requests"]
            window = limit_config["window_seconds"]
            
            window_key = self._get_window_key(identifier, window)
            now = time.time()
            cutoff = now - window
            reset_time = int((now // window + 1) * window)
            
            # Clean old entries
            self._cache = {k: v for k, v in self._cache.items() if v[0] > cutoff}
            
            if window_key in self._cache:
                _, count = self._cache[window_key]
                count += 1
            else:
                count = 1
            
            self._cache[window_key] = (now, count)
            
            remaining = max(0, max_requests - count)
            allowed = count <= max_requests
            
            headers = {
                "X-RateLimit-Limit": str(max_requests),
                "X-RateLimit-Remaining": str(remaining),
                "X-RateLimit-Reset": str(int((now // window + 1) * window)),
            }
            
            if not allowed:
                retry_after = max(1, reset_time - int(time.time()))
                headers["Retry-After"] = str(retry_after)
            
            return RateLimitInfo(
                allowed=allowed,
                headers=headers,
                tier=tier,
                current_count=count,
                max_requests=max_requests,
                reset_time=int((time.time() // window + 1) * window),
            )
        
        async def cleanup_old_windows(self) -> int:
            return 0
    
    # Override the real implementations
    FirestoreAPIKeyManager = _MockAPIKeyManager
    FirestoreRateLimiter = _MockRateLimiter
    
    async def _mock_get_user_tier(uid: str) -> str:
        return _dev_users.get(uid, {}).get("tier", "free")
    
    async def _mock_get_or_create_user(uid: str, email: Optional[str] = None, display_name: Optional[str] = None) -> User:
        if uid not in _dev_users:
            _dev_users[uid] = {
                "uid": uid,
                "email": email,
                "display_name": display_name,
                "email_verified": False,
                "tier": "free",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "last_login": datetime.now(timezone.utc).isoformat(),
                "is_active": True,
                "metadata": {},
            }
        _dev_users[uid]["last_login"] = datetime.now(timezone.utc).isoformat()
        return User(**_dev_users[uid])
    
    async def _mock_update_user_tier(uid: str, new_tier: str) -> bool:
        if uid in _dev_users:
            _dev_users[uid]["tier"] = new_tier
            return True
        return False
    
    async def _mock_save_to_history(
        uid: Optional[str],
        filename: str,
        file_type: str,
        char_count: int,
        text_tokens: int,
        image_tokens: int,
        savings_percent: float,
        pages: int,
    ) -> str:
        record = {
            "id": f"hist_{int(time.time() * 1000)}",
            "uid": uid or "anonymous",
            "filename": filename,
            "file_type": file_type,
            "char_count": char_count,
            "text_tokens": text_tokens,
            "image_tokens": image_tokens,
            "savings_percent": savings_percent,
            "pages": pages,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        key = uid or "anonymous"
        if key not in _dev_history:
            _dev_history[key] = []
        _dev_history[key].insert(0, record)
        if len(_dev_history[key]) > 100:
            _dev_history[key] = _dev_history[key][:100]
        return record["id"]
    
    async def _mock_load_history(uid: Optional[str], limit: int = 50) -> List:
        key = uid or "anonymous"
        return [HistoryRecord(**r) for r in _dev_history.get(key, [])[:limit]]
    
    async def _mock_get_stats(uid: Optional[str]) -> Dict:
        if not uid:
            return {"total_conversions": 0, "total_text_tokens_saved": 0, "avg_savings_percent": 0}
        key = uid
        records = _dev_history.get(key, [])
        total = len(records)
        total_saved = sum(r.get("text_tokens", 0) - r.get("image_tokens", 0) for r in records)
        total_savings = sum(r.get("savings_percent", 0) for r in records)
        return {
            "total_conversions": total,
            "total_text_tokens_saved": max(0, total_saved),
            "avg_savings_percent": round(total_savings / total, 1) if total > 0 else 0,
        }
    
    # Mock verify_firebase_token for dev mode
    async def _mock_verify_firebase_token(request: Request, credentials: Optional[HTTPAuthorizationCredentials] = None) -> Dict:
        # Check for mock auth header (format: "Bearer dev-user-id" or "Bearer dev-anon")
        if credentials:
            token = credentials.credentials
            if token.startswith("dev-"):
                uid = token[4:]  # Remove "dev-" prefix
                if uid == "anon":
                    return {"uid": None, "email": None, "tier": "anonymous", "anonymous": True}
                # Mock user
                _dev_users.setdefault(uid, {"tier": "free", "email": f"{uid}@test.com"})
                return {"uid": uid, "email": f"{uid}@test.com", "tier": "free", "email_verified": True, "anonymous": False}
        # No credentials = anonymous
        return {"uid": None, "email": None, "tier": "anonymous", "anonymous": True}
    
    # Override functions
    _get_user_tier = _mock_get_user_tier
    get_or_create_user = _mock_get_or_create_user
    update_user_tier = _mock_update_user_tier
    save_to_history = _mock_save_to_history
    load_history = _mock_load_history
    get_stats = _mock_get_stats
    init_default_tiers = _mock_init_default_tiers
    verify_firebase_token = _mock_verify_firebase_token