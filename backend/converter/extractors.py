import os
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

MAGIC_BYTES = {
    b"%PDF": "pdf",
    b"PK\x03\x04": "docx",
    b"\x89PNG": "png",
    b"\xff\xd8\xff": "jpeg",
}

EXTENSION_MAP = {
    ".txt": "txt",
    ".py": "py",
    ".js": "js",
    ".ts": "ts",
    ".jsx": "jsx",
    ".tsx": "tsx",
    ".json": "json",
    ".jsonl": "jsonl",
    ".xml": "xml",
    ".html": "html",
    ".htm": "htm",
    ".css": "css",
    ".md": "md",
    ".markdown": "md",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".ini": "ini",
    ".cfg": "cfg",
    ".csv": "csv",
    ".tsv": "tsv",
    ".log": "log",
    ".sql": "sql",
    ".sh": "sh",
    ".bash": "sh",
    ".bat": "bat",
    ".ps1": "ps1",
    ".rb": "rb",
    ".go": "go",
    ".rs": "rs",
    ".java": "java",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "h",
    ".hpp": "hpp",
    ".cs": "cs",
    ".php": "php",
    ".swift": "swift",
    ".kt": "kt",
    ".r": "r",
    ".scala": "scala",
    ".dart": "dart",
    ".vue": "vue",
    ".svelte": "svelte",
    ".env": "env",
    ".dockerfile": "dockerfile",
    ".gitignore": "gitignore",
    ".makefile": "makefile",
    ".cmake": "cmake",
    ".gradle": "gradle",
    ".lock": "lock",
    ".rst": "rst",
    ".adoc": "adoc",
    ".tex": "tex",
    ".bib": "bib",
    ".pdf": "pdf",
    ".docx": "docx",
}


def detect_file_type(file_path: str) -> str:
    ext = Path(file_path).suffix.lower()
    if ext in EXTENSION_MAP:
        return EXTENSION_MAP[ext]

    try:
        with open(file_path, "rb") as f:
            header = f.read(16)
        for magic, ftype in MAGIC_BYTES.items():
            if header.startswith(magic):
                return ftype
    except (IOError, OSError):
        pass

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            f.read(1024)
        return "txt"
    except (UnicodeDecodeError, IOError):
        pass

    return "unknown"


def extract_text(file_path: str, file_type: Optional[str] = None) -> str:
    if file_type is None:
        file_type = detect_file_type(file_path)

    if file_type in ("txt", "py", "js", "ts", "jsx", "tsx", "json", "jsonl",
                     "xml", "css", "md", "yaml", "toml", "ini", "cfg",
                     "csv", "tsv", "log", "sql", "sh", "bat", "rb",
                     "go", "rs", "java", "c", "cpp", "h", "hpp",
                     "cs", "php", "swift", "kt", "r", "scala",
                     "dart", "vue", "svelte", "env", "gitignore",
                     "makefile", "cmake", "gradle", "lock", "rst",
                     "adoc", "tex", "bib", "ps1", "unknown"):
        return _extract_plain_text(file_path)
    elif file_type == "html":
        return _extract_html(file_path)
    elif file_type == "pdf":
        return _extract_pdf(file_path)
    elif file_type == "docx":
        return _extract_docx(file_path)
    else:
        return _extract_plain_text(file_path)


def _extract_plain_text(file_path: str) -> str:
    encodings = ["utf-8", "utf-8-sig", "latin-1", "cp1252", "ascii"]
    for encoding in encodings:
        try:
            with open(file_path, "r", encoding=encoding) as f:
                return f.read()
        except (UnicodeDecodeError, UnicodeError):
            continue
    with open(file_path, "rb") as f:
        raw = f.read()
    return raw.decode("utf-8", errors="replace")


def _extract_html(file_path: str) -> str:
    try:
        from bs4 import BeautifulSoup
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
        soup = BeautifulSoup(content, "html.parser")
        for tag in soup(["script", "style", "meta", "link"]):
            tag.decompose()
        return soup.get_text(separator="\n", strip=True)
    except ImportError:
        return _extract_plain_text(file_path)


def _extract_pdf(file_path: str) -> str:
    try:
        import fitz
        doc = fitz.open(file_path)
        text_parts = []
        for page_num in range(len(doc)):
            page = doc[page_num]
            text = page.get_text()
            if text.strip():
                text_parts.append(text)
        doc.close()
        return "\n\n".join(text_parts)
    except ImportError:
        logger.warning("PyMuPDF not installed, cannot extract PDF")
        return f"[PDF file: {os.path.basename(file_path)} - install PyMuPDF for extraction]"


def _extract_docx(file_path: str) -> str:
    try:
        from docx import Document
        doc = Document(file_path)
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        return "\n".join(paragraphs)
    except ImportError:
        logger.warning("python-docx not installed, cannot extract DOCX")
        return f"[DOCX file: {os.path.basename(file_path)} - install python-docx for extraction]"
