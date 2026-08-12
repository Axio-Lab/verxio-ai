from __future__ import annotations

import re
from typing import Any

from fastapi import HTTPException

from app import db
from app.control_plane import now_iso
from app.models import (
    KnowledgeBaseCreateRequest,
    KnowledgeBaseRecord,
    KnowledgeBasesResponse,
    KnowledgeDocumentCreateRequest,
    KnowledgeDocumentRecord,
    KnowledgeDocumentsResponse,
    Workspace,
    new_id,
)


CHUNK_SIZE = 1200
CHUNK_OVERLAP = 160


def _base_from_row(row: dict[str, Any]) -> KnowledgeBaseRecord:
    return KnowledgeBaseRecord(**dict(row))


def _document_from_row(row: dict[str, Any]) -> KnowledgeDocumentRecord:
    return KnowledgeDocumentRecord(**dict(row))


def _tokens(value: str) -> set[str]:
    return {token for token in re.findall(r"[a-z0-9]{3,}", value.lower()) if token}


def _chunk_text(content: str) -> list[str]:
    text = re.sub(r"\s+", " ", content).strip()
    if not text:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(len(text), start + CHUNK_SIZE)
        chunks.append(text[start:end].strip())
        if end >= len(text):
            break
        start = max(0, end - CHUNK_OVERLAP)
    return [chunk for chunk in chunks if chunk]


def list_knowledge_bases(workspace: Workspace) -> KnowledgeBasesResponse:
    rows = db.fetch_all(
        """
        SELECT kb.*, COUNT(kd.id) AS document_count
        FROM knowledge_bases kb
        LEFT JOIN knowledge_documents kd ON kd.knowledge_base_id = kb.id
        WHERE kb.workspace_id = ?
        GROUP BY kb.id
        ORDER BY kb.updated_at DESC
        """,
        (workspace.id,),
    )
    return KnowledgeBasesResponse(knowledge_bases=[_base_from_row(row) for row in rows])


def create_knowledge_base(workspace: Workspace, payload: KnowledgeBaseCreateRequest) -> KnowledgeBaseRecord:
    created_at = now_iso()
    knowledge_base_id = new_id("kb")
    try:
        db.execute(
            """
            INSERT INTO knowledge_bases (id, tenant_id, workspace_id, name, description, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                knowledge_base_id,
                workspace.tenant_id,
                workspace.id,
                payload.name.strip(),
                payload.description.strip(),
                created_at,
                created_at,
            ),
        )
    except Exception as exc:
        raise HTTPException(status_code=409, detail="A knowledge base with that name already exists.") from exc
    return get_knowledge_base(workspace, knowledge_base_id)


def get_knowledge_base(workspace: Workspace, knowledge_base_id: str) -> KnowledgeBaseRecord:
    row = db.fetch_one(
        """
        SELECT kb.*, COUNT(kd.id) AS document_count
        FROM knowledge_bases kb
        LEFT JOIN knowledge_documents kd ON kd.knowledge_base_id = kb.id
        WHERE kb.id = ? AND kb.workspace_id = ?
        GROUP BY kb.id
        """,
        (knowledge_base_id, workspace.id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Knowledge base not found.")
    return _base_from_row(row)


def delete_knowledge_base(workspace: Workspace, knowledge_base_id: str) -> dict[str, bool]:
    get_knowledge_base(workspace, knowledge_base_id)
    db.execute("DELETE FROM knowledge_bases WHERE id = ? AND workspace_id = ?", (knowledge_base_id, workspace.id))
    return {"ok": True}


def list_documents(workspace: Workspace, knowledge_base_id: str) -> KnowledgeDocumentsResponse:
    get_knowledge_base(workspace, knowledge_base_id)
    rows = db.fetch_all(
        """
        SELECT * FROM knowledge_documents
        WHERE workspace_id = ? AND knowledge_base_id = ?
        ORDER BY updated_at DESC
        """,
        (workspace.id, knowledge_base_id),
    )
    return KnowledgeDocumentsResponse(documents=[_document_from_row(row) for row in rows])


def create_document(
    workspace: Workspace,
    knowledge_base_id: str,
    payload: KnowledgeDocumentCreateRequest,
) -> KnowledgeDocumentRecord:
    get_knowledge_base(workspace, knowledge_base_id)
    created_at = now_iso()
    document_id = new_id("kb_doc")
    db.execute(
        """
        INSERT INTO knowledge_documents (
            id, tenant_id, workspace_id, knowledge_base_id, title, source, content, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            document_id,
            workspace.tenant_id,
            workspace.id,
            knowledge_base_id,
            payload.title.strip(),
            payload.source.strip() or "manual",
            payload.content.strip(),
            created_at,
            created_at,
        ),
    )
    chunks = _chunk_text(payload.content)
    for index, chunk in enumerate(chunks):
        db.execute(
            """
            INSERT INTO knowledge_chunks (
                id, tenant_id, workspace_id, knowledge_base_id, knowledge_document_id,
                chunk_index, content, search_text, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id("kb_chunk"),
                workspace.tenant_id,
                workspace.id,
                knowledge_base_id,
                document_id,
                index,
                chunk,
                chunk.lower(),
                created_at,
            ),
        )
    db.execute("UPDATE knowledge_bases SET updated_at = ? WHERE id = ?", (created_at, knowledge_base_id))
    return _document_from_row(db.fetch_one("SELECT * FROM knowledge_documents WHERE id = ?", (document_id,)) or {})


def retrieve_context(workspace: Workspace, knowledge_names_or_ids: list[str], query_payload: dict[str, Any]) -> list[dict[str, Any]]:
    selectors = [item.strip() for item in knowledge_names_or_ids if item.strip()]
    if not selectors:
        return []
    placeholders = ",".join("?" for _ in selectors)
    bases = db.fetch_all(
        f"""
        SELECT id, name FROM knowledge_bases
        WHERE workspace_id = ? AND (id IN ({placeholders}) OR name IN ({placeholders}))
        """,
        (workspace.id, *selectors, *selectors),
    )
    base_ids = [str(row["id"]) for row in bases]
    if not base_ids:
        return []

    chunk_placeholders = ",".join("?" for _ in base_ids)
    chunks = db.fetch_all(
        f"""
        SELECT kc.*, kb.name AS knowledge_base_name, kd.title AS document_title
        FROM knowledge_chunks kc
        JOIN knowledge_bases kb ON kb.id = kc.knowledge_base_id
        JOIN knowledge_documents kd ON kd.id = kc.knowledge_document_id
        WHERE kc.workspace_id = ? AND kc.knowledge_base_id IN ({chunk_placeholders})
        """,
        (workspace.id, *base_ids),
    )
    if not chunks:
        return []

    query = repr(query_payload)
    query_tokens = _tokens(query)
    ranked: list[tuple[int, dict[str, Any]]] = []
    for chunk in chunks:
        row = dict(chunk)
        score = len(query_tokens.intersection(_tokens(str(row.get("search_text") or ""))))
        ranked.append((score, row))
    ranked.sort(key=lambda item: (-item[0], str(item[1].get("knowledge_base_name") or ""), int(item[1].get("chunk_index") or 0)))

    selected = ranked[:6] if any(score for score, _row in ranked) else ranked[:3]
    return [
        {
            "knowledge_base_id": row["knowledge_base_id"],
            "knowledge_base_name": row["knowledge_base_name"],
            "document_id": row["knowledge_document_id"],
            "document_title": row["document_title"],
            "chunk_index": row["chunk_index"],
            "score": score,
            "content": row["content"],
        }
        for score, row in selected
    ]
