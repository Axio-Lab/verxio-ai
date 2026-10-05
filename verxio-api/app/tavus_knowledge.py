"""Pinned memories and knowledge-base documents for a user's PAL."""

from __future__ import annotations

import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from app import db
from app.control_plane import now_iso
from app.device_tokens import arequire_user_or_device
from app.models import new_id
from app.tavus_client import items, public_api_base, request as tavus_request
from app.tavus_profile import profile_row

router = APIRouter()


def upload_dir() -> Path:
    root = os.getenv("VERXIO_TAVUS_UPLOAD_DIR", "").strip()
    path = Path(root) if root else Path.home() / ".verxio" / "tavus-uploads"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _store_id(user_id: str, pal_id: str) -> str:
    existing = db.fetch_one(
        "SELECT tavus_id FROM tavus_assets WHERE user_id = ? AND kind = 'memory' ORDER BY created_at ASC LIMIT 1",
        (user_id,),
    )
    if existing and existing.get("tavus_id"):
        return str(existing["tavus_id"])
    created = tavus_request(
        "POST",
        "/v2/memory-stores",
        json_body={"pal_id": pal_id, "participant_tag": user_id},
    )
    store_id = str(created.get("memory_store_id") or "")
    if not store_id:
        raise HTTPException(status_code=502, detail="Tavus did not return a memory store.")
    now = now_iso()
    db.execute(
        """
        INSERT INTO tavus_assets (id, user_id, kind, tavus_id, status, name, created_at, updated_at)
        VALUES (?, ?, 'memory', ?, 'ready', 'memory', ?, ?)
        """,
        (new_id("asset"), user_id, store_id, now, now),
    )
    return store_id


def list_memories(user_id: str) -> dict[str, Any]:
    facts = db.fetch_all(
        "SELECT id, memory_id, text, created_at FROM tavus_pinned_facts WHERE user_id = ? ORDER BY created_at ASC",
        (user_id,),
    )
    learned = ""
    asset = db.fetch_one(
        "SELECT tavus_id FROM tavus_assets WHERE user_id = ? AND kind = 'memory' LIMIT 1",
        (user_id,),
    )
    if asset and asset.get("tavus_id"):
        try:
            payload = tavus_request("GET", f"/v2/memory-stores/{asset['tavus_id']}/learned")
            learned = str(payload.get("profile") or payload.get("summary") or "")
        except HTTPException:
            learned = ""
    return {
        "facts": [
            {"id": row["id"], "memoryId": row.get("memory_id") or "", "text": row["text"]}
            for row in facts
        ],
        "learned": learned,
    }


def add_fact(user: dict[str, Any], text: str) -> dict[str, Any]:
    user_id = str(user["id"])
    profile = profile_row(user_id)
    if not profile or not profile.get("pal_id"):
        raise HTTPException(status_code=400, detail="Save a personality before adding memories.")
    clean = text.strip()
    if not clean or len(clean) > 500:
        raise HTTPException(status_code=400, detail="A memory must be 1 to 500 characters.")
    count = db.fetch_one("SELECT COUNT(*) AS n FROM tavus_pinned_facts WHERE user_id = ?", (user_id,))
    if int((count or {}).get("n") or 0) >= 30:
        raise HTTPException(status_code=400, detail="You can pin up to 30 memories.")
    store_id = _store_id(user_id, str(profile["pal_id"]))
    created = tavus_request(
        "POST",
        f"/v2/memory-stores/{store_id}/pinned",
        json_body={"text": clean},
    )
    fact_id = new_id("fact")
    db.execute(
        """
        INSERT INTO tavus_pinned_facts (id, user_id, memory_id, text, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (fact_id, user_id, str(created.get("pinned_memory_id") or created.get("id") or ""), clean, now_iso()),
    )
    return list_memories(user_id)


def delete_fact(user_id: str, fact_id: str) -> dict[str, Any]:
    row = db.fetch_one(
        "SELECT * FROM tavus_pinned_facts WHERE id = ? AND user_id = ?",
        (fact_id, user_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Memory not found.")
    asset = db.fetch_one(
        "SELECT tavus_id FROM tavus_assets WHERE user_id = ? AND kind = 'memory' LIMIT 1",
        (user_id,),
    )
    memory_id = str(row.get("memory_id") or "")
    if asset and memory_id:
        tavus_request("DELETE", f"/v2/memory-stores/{asset['tavus_id']}/pinned/{memory_id}")
    db.execute("DELETE FROM tavus_pinned_facts WHERE id = ?", (fact_id,))
    return list_memories(user_id)


def seed_identity(user: dict[str, Any]) -> None:
    user_id = str(user["id"])
    existing = db.fetch_one("SELECT id FROM tavus_pinned_facts WHERE user_id = ? LIMIT 1", (user_id,))
    if existing:
        return
    name = str(user.get("name") or "").strip()
    if name:
        add_fact(user, f"The user's name is {name}.")


def save_upload(user_id: str, filename: str, content: bytes, mime: str) -> str:
    if not content:
        raise HTTPException(status_code=400, detail="The file is empty.")
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Files must be 25 MB or smaller.")
    token = secrets.token_urlsafe(24)
    safe = Path(filename).name or "upload"
    path = upload_dir() / f"{token}-{safe}"
    path.write_bytes(content)
    expires = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    db.execute(
        "INSERT INTO tavus_files (token, user_id, path, mime, expires_at) VALUES (?, ?, ?, ?, ?)",
        (token, user_id, str(path), mime or "application/octet-stream", expires),
    )
    return token


def public_file_url(token: str) -> str:
    base = public_api_base()
    if not base.startswith("https://"):
        raise HTTPException(status_code=400, detail="Set VERXIO_PUBLIC_API_URL to a public https URL before uploading.")
    return f"{base}/api/tavus/files/{token}"


def create_document(user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    profile = profile_row(user_id)
    if not profile or not profile.get("pal_id"):
        raise HTTPException(status_code=400, detail="Save a personality before adding documents.")
    name = str(payload.get("name") or "Document")[:180]
    url = str(payload.get("url") or "").strip()
    if not url.startswith("https://"):
        raise HTTPException(status_code=400, detail="Document URLs must be public https links.")
    body: dict[str, Any] = {
        "document_name": name,
        "document_url": url,
        "tags": [f"verxio-{user_id}"],
    }
    depth = payload.get("crawlDepth")
    pages = payload.get("maxPages")
    if depth or pages:
        body["crawl"] = {"depth": int(depth or 1), "max_pages": int(pages or 10)}
    base = public_api_base()
    if base.startswith("https://"):
        body["callback_url"] = f"{base}/api/tavus/webhooks/documents"
    created = tavus_request("POST", "/v2/documents", json_body=body)
    document_id = str(created.get("document_id") or "")
    if not document_id:
        raise HTTPException(status_code=502, detail="Tavus did not return a document id.")
    now = now_iso()
    db.execute(
        """
        INSERT INTO tavus_assets (id, user_id, kind, tavus_id, status, name, created_at, updated_at)
        VALUES (?, ?, 'document', ?, 'processing', ?, ?, ?)
        """,
        (new_id("asset"), user_id, document_id, name, now, now),
    )
    return list_documents(user_id)


def list_documents(user_id: str) -> dict[str, Any]:
    rows = db.fetch_all(
        """
        SELECT id, tavus_id, status, name FROM tavus_assets
        WHERE user_id = ? AND kind = 'document' ORDER BY created_at DESC
        """,
        (user_id,),
    )
    return {
        "documents": [
            {"id": row["id"], "documentId": row["tavus_id"], "status": row["status"], "name": row["name"]}
            for row in rows
        ]
    }


def refresh_document(user_id: str, asset_id: str) -> dict[str, Any]:
    row = db.fetch_one(
        "SELECT * FROM tavus_assets WHERE id = ? AND user_id = ? AND kind = 'document'",
        (asset_id, user_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Document not found.")
    payload = tavus_request("GET", f"/v2/documents/{row['tavus_id']}")
    status = str(payload.get("status") or row["status"])
    db.execute(
        "UPDATE tavus_assets SET status = ?, updated_at = ? WHERE id = ?",
        (status, now_iso(), asset_id),
    )
    return list_documents(user_id)


def recrawl_document(user_id: str, asset_id: str) -> dict[str, Any]:
    row = db.fetch_one(
        "SELECT * FROM tavus_assets WHERE id = ? AND user_id = ? AND kind = 'document'",
        (asset_id, user_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Document not found.")
    tavus_request("POST", f"/v2/documents/{row['tavus_id']}/recrawl")
    db.execute(
        "UPDATE tavus_assets SET status = 'processing', updated_at = ? WHERE id = ?",
        (now_iso(), asset_id),
    )
    return list_documents(user_id)


def delete_document(user_id: str, asset_id: str) -> dict[str, Any]:
    row = db.fetch_one(
        "SELECT * FROM tavus_assets WHERE id = ? AND user_id = ? AND kind = 'document'",
        (asset_id, user_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Document not found.")
    tavus_request("DELETE", f"/v2/documents/{row['tavus_id']}")
    db.execute("DELETE FROM tavus_assets WHERE id = ?", (asset_id,))
    return list_documents(user_id)


def file_response(token: str) -> FileResponse:
    row = db.fetch_one("SELECT * FROM tavus_files WHERE token = ?", (token,))
    if not row:
        raise HTTPException(status_code=404, detail="File not found.")
    expires = str(row.get("expires_at") or "")
    if expires and expires < datetime.now(timezone.utc).isoformat():
        raise HTTPException(status_code=404, detail="File link expired.")
    path = Path(str(row["path"]))
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File not found.")
    return FileResponse(path, media_type=str(row.get("mime") or "application/octet-stream"))


@router.get("/api/tavus/memories")
async def memories_route(request: Request) -> dict[str, Any]:
    user = await arequire_user_or_device(request)
    return list_memories(str(user["id"]))


@router.post("/api/tavus/memories")
async def add_memory_route(request: Request) -> dict[str, Any]:
    user = await arequire_user_or_device(request)
    payload = await request.json()
    return add_fact(user, str((payload or {}).get("text") or ""))


@router.delete("/api/tavus/memories/{fact_id}")
async def delete_memory_route(fact_id: str, request: Request) -> dict[str, Any]:
    user = await arequire_user_or_device(request)
    return delete_fact(str(user["id"]), fact_id)


@router.get("/api/tavus/documents")
async def documents_route(request: Request) -> dict[str, Any]:
    user = await arequire_user_or_device(request)
    return list_documents(str(user["id"]))


@router.post("/api/tavus/documents")
async def create_document_route(request: Request) -> dict[str, Any]:
    user = await arequire_user_or_device(request)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Document payload must be an object.")
    return create_document(str(user["id"]), payload)


@router.post("/api/tavus/documents/{asset_id}/refresh")
async def refresh_document_route(asset_id: str, request: Request) -> dict[str, Any]:
    user = await arequire_user_or_device(request)
    return refresh_document(str(user["id"]), asset_id)


@router.post("/api/tavus/documents/{asset_id}/recrawl")
async def recrawl_document_route(asset_id: str, request: Request) -> dict[str, Any]:
    user = await arequire_user_or_device(request)
    return recrawl_document(str(user["id"]), asset_id)


@router.delete("/api/tavus/documents/{asset_id}")
async def delete_document_route(asset_id: str, request: Request) -> dict[str, Any]:
    user = await arequire_user_or_device(request)
    return delete_document(str(user["id"]), asset_id)


@router.post("/api/tavus/uploads")
async def upload_route(request: Request) -> dict[str, str]:
    user = await arequire_user_or_device(request)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Upload payload must be an object.")
    import base64

    raw = str(payload.get("data") or "")
    if "," in raw and raw.startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        content = base64.b64decode(raw)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Upload data must be base64.") from exc
    token = save_upload(
        str(user["id"]),
        str(payload.get("fileName") or "upload"),
        content,
        str(payload.get("mime") or "application/octet-stream"),
    )
    return {"url": public_file_url(token), "token": token}


@router.get("/api/tavus/files/{token}")
async def file_route(token: str) -> FileResponse:
    return file_response(token)


def mark_document_status(document_id: str, status: str) -> None:
    db.execute(
        "UPDATE tavus_assets SET status = ?, updated_at = ? WHERE tavus_id = ? AND kind = 'document'",
        (status, now_iso(), document_id),
    )
