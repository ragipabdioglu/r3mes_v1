#!/usr/bin/env python3
"""Optional R3MES document parser bridge.

This script is intentionally dependency-light from the repo perspective:
install parser packages in an external/local venv, then point
R3MES_DOCUMENT_PARSER_COMMAND at that venv's python executable and use this
script as the command argument.

Supported when optional packages are installed:
- PDF: pypdf
- DOCX: python-docx
"""

from __future__ import annotations

import argparse
import html
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def fail(message: str, code: int = 2) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(code)


def normalize_text(value: str) -> str:
    lines = [line.rstrip() for line in value.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return "\n".join(lines).strip()


def parse_pdf(path: Path) -> str:
    try:
        from pypdf import PdfReader  # type: ignore
    except Exception as exc:  # pragma: no cover - depends on optional env
        fail(
            "Missing optional dependency 'pypdf'. Install in an isolated venv, "
            "for example: python -m pip install pypdf",
        )

    reader = PdfReader(str(path))
    sections: list[str] = [f"# Parsed PDF: {path.name}"]
    for index, page in enumerate(reader.pages, start=1):
        text = normalize_text(page.extract_text() or "")
        if not text:
            sections.append(f"## Page {index}\n\n[No extractable text on this page.]")
            continue
        sections.append(f"## Page {index}\n\n{text}")
    return "\n\n".join(sections)


def markdown_table(rows: list[list[str]]) -> str:
    if not rows:
        return ""
    width = max(len(row) for row in rows)
    normalized = [[html.escape(cell.strip()).replace("\n", " ") for cell in row] + [""] * (width - len(row)) for row in rows]
    header = normalized[0]
    body = normalized[1:]
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join(["---"] * width) + " |",
    ]
    for row in body:
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def parse_docx(path: Path) -> str:
    try:
        from docx import Document  # type: ignore
    except Exception:  # pragma: no cover - depends on optional env
        fail(
            "Missing optional dependency 'python-docx'. Install in an isolated venv, "
            "for example: python -m pip install python-docx",
        )

    doc = Document(str(path))
    sections: list[str] = [f"# Parsed DOCX: {path.name}"]
    for paragraph in doc.paragraphs:
        text = normalize_text(paragraph.text)
        if text:
            sections.append(text)
    for table_index, table in enumerate(doc.tables, start=1):
        rows = [[cell.text for cell in row.cells] for row in table.rows]
        table_md = markdown_table(rows)
        if table_md:
            sections.append(f"## Table {table_index}\n\n{table_md}")

    parsed = "\n\n".join(sections)
    xml_fallback = parse_docx_xml_text(path)
    if len(normalize_text(xml_fallback)) > len(normalize_text(parsed)) * 2:
        sections.append("## XML Text Fallback")
        sections.append(xml_fallback)
    return "\n\n".join(sections)


def parse_docx_xml_text(path: Path) -> str:
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    parts: list[str] = []
    try:
        with zipfile.ZipFile(path) as archive:
            names = [
                name
                for name in archive.namelist()
                if name.startswith("word/") and name.endswith(".xml") and not name.endswith(".rels")
            ]
            for name in sorted(names):
                try:
                    root = ET.fromstring(archive.read(name))
                except ET.ParseError:
                    continue
                texts = [
                    node.text.strip()
                    for node in root.findall(".//w:t", namespace)
                    if node.text and node.text.strip()
                ]
                if texts:
                    parts.append(f"### {name}\n\n" + "\n".join(texts))
    except zipfile.BadZipFile:
        return ""
    return normalize_text("\n\n".join(parts))


def main() -> None:
    parser = argparse.ArgumentParser(description="Parse PDF/DOCX into Markdown for R3MES ingestion.")
    parser.add_argument("input", help="Path to PDF or DOCX file")
    args = parser.parse_args()

    path = Path(args.input).resolve()
    if not path.exists():
        fail(f"Input file not found: {path}", 1)
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        output = parse_pdf(path)
    elif suffix == ".docx":
        output = parse_docx(path)
    else:
        fail(f"Unsupported bridge file type: {suffix}. Expected .pdf or .docx", 1)

    output = normalize_text(output)
    if not output:
        fail("Parser produced empty output", 3)
    print(output)


if __name__ == "__main__":
    main()
