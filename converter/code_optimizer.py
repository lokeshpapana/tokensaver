import re
from typing import Optional

INDENTED_LANGS = {".py", ".pyw", ".rb", ".yaml", ".yml"}
BRACE_LANGS = {
    ".js", ".ts", ".jsx", ".tsx", ".java", ".c", ".cpp", ".h", ".hpp",
    ".cs", ".go", ".rs", ".swift", ".kt", ".php", ".scala", ".dart",
    ".css", ".scss", ".less", ".vue", ".svelte",
}

INDENT_REDUCE_MAP = {".py": 2, ".rb": 2}


def detect_code_style(text: str, ext: str) -> str:
    if ext in INDENTED_LANGS:
        return "indent"
    if ext in BRACE_LANGS:
        return "brace"
    has_braces = text.count("{") > text.count("\n") * 0.05
    has_indent = bool(re.match(r"^( {2,}|\t)", text, re.MULTILINE))
    if has_braces and not has_indent:
        return "brace"
    if has_indent:
        return "indent"
    return "plain"


def _reduce_indentation(text: str, target_spaces: int = 2) -> str:
    lines = text.split("\n")
    result = []
    for line in lines:
        stripped = line.lstrip()
        if not stripped:
            result.append("")
            continue
        current_indent = len(line) - len(stripped)
        if line.startswith("\t"):
            current_indent = len(line) - len(line.lstrip("\t"))
            new_indent = current_indent * target_spaces
            result.append(" " * new_indent + stripped)
        else:
            new_indent = int(current_indent * target_spaces / 4) if current_indent >= 4 else min(current_indent, target_spaces)
            result.append(" " * new_indent + stripped)
    return "\n".join(result)


def _compact_braces(text: str) -> str:
    text = re.sub(r"\{\s*\n\s*\}", "{}", text)
    text = re.sub(r"\n\s*\}", " }", text)
    text = re.sub(r"\{\s*\n", " {\n", text)
    lines = text.split("\n")
    result = []
    i = 0
    while i < len(lines):
        line = lines[i].rstrip()
        if (
            line.endswith("{")
            and i + 1 < len(lines)
            and lines[i + 1].strip() == "}"
        ):
            result.append(line + " " + lines[i + 1].strip())
            i += 2
            continue
        result.append(line)
        i += 1
    return "\n".join(result)


def _remove_empty_lines(text: str, max_consecutive: int = 1) -> str:
    lines = text.split("\n")
    result = []
    empty_count = 0
    for line in lines:
        if not line.strip():
            empty_count += 1
            if empty_count <= max_consecutive:
                result.append("")
        else:
            empty_count = 0
            result.append(line)
    while result and not result[-1].strip():
        result.pop()
    return "\n".join(result)


def optimize_code(text: str, ext: str = ".py", aggressive: bool = False) -> str:
    if not text or not text.strip():
        return text

    style = detect_code_style(text, ext)
    result = text

    if style == "indent":
        target = INDENT_REDUCE_MAP.get(ext, 2)
        result = _reduce_indentation(result, target)
    elif style == "brace":
        result = _compact_braces(result)

    result = _remove_empty_lines(result, max_consecutive=0 if aggressive else 1)

    return result
