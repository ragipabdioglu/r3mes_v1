#!/usr/bin/env python3
"""Download a reproducible KAP pilot corpus for real-world RAG testing.

The downloaded corpus is intentionally written under data/, which is ignored by
the repository. Keep only this script in git; keep raw company documents local.
"""

from __future__ import annotations

import argparse
import json
import re
import time
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


KAP_BASE = "https://www.kap.org.tr"
DEFAULT_TICKERS = [
    "THYAO",
    "KCHOL",
    "ASELS",
    "EREGL",
    "TUPRS",
    "BIMAS",
    "AKBNK",
    "GARAN",
    "FROTO",
    "TCELL",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download a KAP pilot document set.")
    parser.add_argument("--out", default="data/kap-pilot/raw")
    parser.add_argument("--manifest", default="data/kap-pilot/manifest.json")
    parser.add_argument("--from", dest="from_date", default="2026-01-01")
    parser.add_argument("--to", dest="to_date", default="2026-05-11")
    parser.add_argument("--max-files", type=int, default=30)
    parser.add_argument("--max-per-ticker", type=int, default=4)
    parser.add_argument("--delay-ms", type=int, default=350)
    parser.add_argument("--tickers", default=",".join(DEFAULT_TICKERS))
    return parser.parse_args()


def sanitize_file_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    normalized = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    normalized = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized[:160] or "kap-file"


def request_headers(json_request: bool = True) -> dict[str, str]:
    headers = {
        "Accept": "application/json, text/plain, */*" if json_request else "*/*",
        "Accept-Language": "tr",
        "Referer": f"{KAP_BASE}/tr/",
        "User-Agent": "Mozilla/5.0 R3MES-KAP-Pilot/1.0",
    }
    if json_request:
        headers["Content-Type"] = "application/json"
    return headers


def with_retry(label: str, fn, attempts: int = 4):
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except (HTTPError, URLError, TimeoutError, ConnectionError) as exc:
            last_error = exc
            if attempt == attempts:
                break
            time.sleep(0.5 * attempt)
    raise RuntimeError(f"{label} failed after {attempts} attempts: {last_error}")


def kap_json(path: str, payload: dict[str, Any] | None = None) -> Any:
    url = f"{KAP_BASE}/tr/{path.lstrip('/')}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None

    def run():
        req = Request(url, data=data, headers=request_headers(json_request=True), method="POST" if payload is not None else "GET")
        with urlopen(req, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))

    return with_retry(f"KAP JSON {path}", run)


def kap_download(path: str) -> tuple[bytes, str]:
    url = f"{KAP_BASE}/tr/{path.lstrip('/')}"

    def run():
        req = Request(url, headers=request_headers(json_request=False))
        with urlopen(req, timeout=60) as response:
            return response.read(), response.headers.get("Content-Type", "")

    return with_retry(f"KAP download {path}", run)


def ticker_matches(stock_code: str | None, ticker: str) -> bool:
    return ticker.upper() in {part.strip().upper() for part in (stock_code or "").split(",")}


def disclosure_score(disclosure: dict[str, Any]) -> int:
    text = " ".join(
        str(disclosure.get(key) or "")
        for key in ["disclosureType", "disclosureClass", "subject", "summary"]
    ).lower()
    score = int(disclosure.get("attachmentCount") or 0)
    if "finansal rapor" in text:
        score += 120
    if "faaliyet raporu" in text:
        score += 100
    if "sürdürülebilirlik" in text or "surdurulebilirlik" in text:
        score += 90
    if "genel kurul" in text:
        score += 70
    if "kar payı" in text or "kâr payı" in text:
        score += 60
    if "trafik sonuçları" in text:
        score += 55
    if "özel durum" in text or disclosure.get("disclosureType") == "ODA":
        score += 30
    return score


def attachment_extension(attachment: dict[str, Any]) -> str:
    extension = str(attachment.get("fileExtension") or "").lower().lstrip(".")
    if extension:
        return extension
    name = str(attachment.get("fileName") or "")
    return name.rsplit(".", 1)[-1].lower() if "." in name else "bin"


def allowed_attachment(attachment: dict[str, Any]) -> bool:
    return attachment_extension(attachment) in {"pdf", "doc", "docx", "xls", "xlsx", "zip"}


def attachment_output_name(ticker: str, disclosure_index: int, attachment: dict[str, Any]) -> str:
    extension = attachment_extension(attachment)
    original = sanitize_file_name(str(attachment.get("fileName") or attachment.get("objId") or "kap-file"))
    if not original.lower().endswith(f".{extension}"):
        original = f"{original}.{extension}"
    return sanitize_file_name(f"{ticker}_{disclosure_index}_{original}")


def parse_attachments(detail: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in detail if isinstance(detail, list) else []:
        for attachment in item.get("attachments") or []:
            if attachment.get("objId") and allowed_attachment(attachment):
                rows.append(attachment)
    return rows


def main() -> None:
    args = parse_args()
    out_dir = Path(args.out).resolve()
    manifest_path = Path(args.manifest).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)

    tickers = [item.strip().upper() for item in args.tickers.split(",") if item.strip()]
    companies = kap_json("api/company/items/IGS/A")
    selected = []
    for ticker in tickers:
        row = next((company for company in companies if ticker_matches(company.get("stockCode"), ticker)), None)
        if row and row.get("mkkMemberOid"):
            selected.append((ticker, row))

    candidates: list[dict[str, Any]] = []
    for ticker, company in selected:
        time.sleep(args.delay_ms / 1000)
        disclosures = kap_json(
            "api/disclosure/members/byCriteria",
            {
                "fromDate": args.from_date,
                "toDate": args.to_date,
                "mkkMemberOidList": [company["mkkMemberOid"]],
                "subjectList": [],
            },
        )
        for disclosure in disclosures:
            if int(disclosure.get("attachmentCount") or 0) > 0:
                candidates.append(
                    {
                        "ticker": ticker,
                        "companyTitle": company.get("kapMemberTitle"),
                        "disclosure": disclosure,
                        "score": disclosure_score(disclosure),
                    }
                )

    candidates.sort(key=lambda item: (item["score"], str(item["disclosure"].get("publishDate") or "")), reverse=True)

    manifest: dict[str, Any] = {
        "source": "KAP Kamuyu Aydınlatma Platformu",
        "sourceBaseUrl": KAP_BASE,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "dateRange": {"from": args.from_date, "to": args.to_date},
        "requestedTickers": tickers,
        "downloaded": [],
        "skipped": [],
    }
    per_ticker: defaultdict[str, int] = defaultdict(int)
    seen_obj_ids: set[str] = set()

    for candidate in candidates:
        if len(manifest["downloaded"]) >= args.max_files:
            break
        if per_ticker[candidate["ticker"]] >= args.max_per_ticker:
            continue
        time.sleep(args.delay_ms / 1000)
        disclosure = candidate["disclosure"]
        detail = kap_json(f"api/notification/attachment-detail/{disclosure['disclosureIndex']}")
        for attachment in parse_attachments(detail):
            if len(manifest["downloaded"]) >= args.max_files:
                break
            if per_ticker[candidate["ticker"]] >= args.max_per_ticker:
                break
            obj_id = attachment["objId"]
            if obj_id in seen_obj_ids:
                continue
            seen_obj_ids.add(obj_id)
            file_name = attachment_output_name(candidate["ticker"], disclosure["disclosureIndex"], attachment)
            file_path = out_dir / file_name
            try:
                time.sleep(args.delay_ms / 1000)
                content, content_type = kap_download(f"api/file/download/{obj_id}")
                file_path.write_bytes(content)
                per_ticker[candidate["ticker"]] += 1
                manifest["downloaded"].append(
                    {
                        "ticker": candidate["ticker"],
                        "companyTitle": candidate["companyTitle"],
                        "publishDate": disclosure.get("publishDate"),
                        "disclosureIndex": disclosure.get("disclosureIndex"),
                        "disclosureType": disclosure.get("disclosureType"),
                        "disclosureClass": disclosure.get("disclosureClass"),
                        "subject": disclosure.get("subject"),
                        "summary": disclosure.get("summary"),
                        "attachmentFileName": attachment.get("fileName"),
                        "objId": obj_id,
                        "fileExtension": attachment_extension(attachment),
                        "contentType": content_type,
                        "sizeBytes": len(content),
                        "localPath": str(file_path),
                        "sourceUrl": f"{KAP_BASE}/tr/api/file/download/{obj_id}",
                        "disclosureUrl": f"{KAP_BASE}/tr/Bildirim/{disclosure.get('disclosureIndex')}",
                    }
                )
            except Exception as exc:  # noqa: BLE001 - manifest should capture fetch failures.
                manifest["skipped"].append(
                    {
                        "ticker": candidate["ticker"],
                        "disclosureIndex": disclosure.get("disclosureIndex"),
                        "attachmentFileName": attachment.get("fileName"),
                        "objId": obj_id,
                        "reason": str(exc),
                    }
                )

    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "outDir": str(out_dir),
                "manifestPath": str(manifest_path),
                "downloaded": len(manifest["downloaded"]),
                "skipped": len(manifest["skipped"]),
                "tickers": sorted({item["ticker"] for item in manifest["downloaded"]}),
                "totalBytes": sum(item["sizeBytes"] for item in manifest["downloaded"]),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
