from __future__ import annotations

import secrets
from typing import Any

from fastapi import HTTPException

from app import db
from app.control_plane import now_iso
from app.models import (
    AgentProfile,
    NotepadFolderCreateRequest,
    NotepadFolderRecord,
    NotepadFolderUpdateRequest,
    NotepadListResponse,
    NotepadNoteCreateRequest,
    NotepadNoteRecord,
    NotepadNoteUpdateRequest,
    NotepadShareResponse,
    PublicNotepadShareResponse,
    Workspace,
    new_id,
)
from app.runtime import HermesRuntimeAdapter


def _folder_from_row(row: dict[str, Any]) -> NotepadFolderRecord:
    return NotepadFolderRecord(**row)


def _note_from_row(row: dict[str, Any]) -> NotepadNoteRecord:
    payload = dict(row)
    payload["share_token"] = payload.get("share_token")
    return NotepadNoteRecord(**payload)


def _agent_params(workspace: Workspace, profile: AgentProfile) -> tuple[str, str]:
    return workspace.id, profile.id


def _folder_row(workspace: Workspace, profile: AgentProfile, folder_id: str) -> dict[str, Any] | None:
    workspace_id, agent_id = _agent_params(workspace, profile)
    return db.fetch_one(
        """
        SELECT * FROM notepad_folders
        WHERE id = ? AND workspace_id = ? AND agent_id = ?
        """,
        (folder_id, workspace_id, agent_id),
    )


def _note_row(workspace: Workspace, profile: AgentProfile, note_id: str) -> dict[str, Any] | None:
    workspace_id, agent_id = _agent_params(workspace, profile)
    return db.fetch_one(
        """
        SELECT n.*, s.token AS share_token
        FROM notepad_notes n
        LEFT JOIN notepad_shares s ON s.note_id = n.id AND s.revoked_at IS NULL
        WHERE n.id = ? AND n.workspace_id = ? AND n.agent_id = ?
        ORDER BY s.created_at DESC
        LIMIT 1
        """,
        (note_id, workspace_id, agent_id),
    )


def _ensure_folder(workspace: Workspace, profile: AgentProfile, folder_id: str | None) -> None:
    if folder_id is None:
        return

    if not _folder_row(workspace, profile, folder_id):
        raise HTTPException(status_code=404, detail="Folder not found.")


def _ensure_note(workspace: Workspace, profile: AgentProfile, note_id: str) -> dict[str, Any]:
    row = _note_row(workspace, profile, note_id)

    if not row:
        raise HTTPException(status_code=404, detail="Note not found.")

    return row


def list_notepad(workspace: Workspace, profile: AgentProfile) -> NotepadListResponse:
    workspace_id, agent_id = _agent_params(workspace, profile)
    folders = [
        _folder_from_row(row)
        for row in db.fetch_all(
            """
            SELECT * FROM notepad_folders
            WHERE workspace_id = ? AND agent_id = ?
            ORDER BY sort_order ASC, updated_at DESC
            """,
            (workspace_id, agent_id),
        )
    ]
    notes = [
        _note_from_row(row)
        for row in db.fetch_all(
            """
            SELECT n.*, s.token AS share_token
            FROM notepad_notes n
            LEFT JOIN notepad_shares s ON s.note_id = n.id AND s.revoked_at IS NULL
            WHERE n.workspace_id = ? AND n.agent_id = ?
            ORDER BY n.updated_at DESC
            """,
            (workspace_id, agent_id),
        )
    ]
    return NotepadListResponse(folders=folders, notes=notes)


def create_folder(
    workspace: Workspace,
    profile: AgentProfile,
    payload: NotepadFolderCreateRequest,
) -> NotepadFolderRecord:
    created_at = now_iso()
    folder_id = new_id("folder")
    sort_order = len(list_notepad(workspace, profile).folders)
    name = payload.name.strip()

    db.execute(
        """
        INSERT INTO notepad_folders (
            id, tenant_id, workspace_id, agent_id, name, sort_order, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (folder_id, workspace.tenant_id, workspace.id, profile.id, name, sort_order, created_at, created_at),
    )
    row = _folder_row(workspace, profile, folder_id)
    assert row
    return _folder_from_row(row)


def update_folder(
    workspace: Workspace,
    profile: AgentProfile,
    folder_id: str,
    payload: NotepadFolderUpdateRequest,
) -> NotepadFolderRecord:
    if not _folder_row(workspace, profile, folder_id):
        raise HTTPException(status_code=404, detail="Folder not found.")

    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        row = _folder_row(workspace, profile, folder_id)
        assert row
        return _folder_from_row(row)

    fields: list[str] = []
    params: list[Any] = []
    if "name" in updates and updates["name"] is not None:
        fields.append("name = ?")
        params.append(str(updates["name"]).strip())
    if "sort_order" in updates and updates["sort_order"] is not None:
        fields.append("sort_order = ?")
        params.append(int(updates["sort_order"]))

    if fields:
        fields.append("updated_at = ?")
        params.extend([now_iso(), folder_id, workspace.id, profile.id])
        db.execute(
            f"""
            UPDATE notepad_folders
            SET {", ".join(fields)}
            WHERE id = ? AND workspace_id = ? AND agent_id = ?
            """,
            params,
        )

    row = _folder_row(workspace, profile, folder_id)
    assert row
    return _folder_from_row(row)


def delete_folder(workspace: Workspace, profile: AgentProfile, folder_id: str) -> dict[str, bool]:
    if not _folder_row(workspace, profile, folder_id):
        raise HTTPException(status_code=404, detail="Folder not found.")

    with db.transaction() as conn:
        conn.execute(
            """
            UPDATE notepad_notes
            SET folder_id = NULL, updated_at = ?
            WHERE folder_id = ? AND workspace_id = ? AND agent_id = ?
            """,
            (now_iso(), folder_id, workspace.id, profile.id),
        )
        conn.execute(
            """
            DELETE FROM notepad_folders
            WHERE id = ? AND workspace_id = ? AND agent_id = ?
            """,
            (folder_id, workspace.id, profile.id),
        )

    return {"ok": True}


def create_note(
    workspace: Workspace,
    profile: AgentProfile,
    payload: NotepadNoteCreateRequest,
) -> NotepadNoteRecord:
    _ensure_folder(workspace, profile, payload.folder_id)

    created_at = now_iso()
    note_id = new_id("note")

    db.execute(
        """
        INSERT INTO notepad_notes (
            id, tenant_id, workspace_id, agent_id, folder_id, title, content,
            transcript, summary, meeting_type, source, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            note_id,
            workspace.tenant_id,
            workspace.id,
            profile.id,
            payload.folder_id,
            payload.title.strip(),
            payload.content,
            payload.transcript,
            payload.summary,
            payload.meeting_type,
            payload.source,
            created_at,
            created_at,
        ),
    )
    return _note_from_row(_ensure_note(workspace, profile, note_id))


def update_note(
    workspace: Workspace,
    profile: AgentProfile,
    note_id: str,
    payload: NotepadNoteUpdateRequest,
) -> NotepadNoteRecord:
    _ensure_note(workspace, profile, note_id)
    updates = payload.model_dump(exclude_unset=True)

    if "folder_id" in updates:
        _ensure_folder(workspace, profile, updates["folder_id"])

    fields: list[str] = []
    params: list[Any] = []
    for key in ("title", "folder_id", "content", "transcript", "summary", "meeting_type", "source"):
        if key not in updates:
            continue

        value = updates[key]
        if key == "title" and value is not None:
            value = str(value).strip()

        fields.append(f"{key} = ?")
        params.append(value)

    if fields:
        fields.append("updated_at = ?")
        params.extend([now_iso(), note_id, workspace.id, profile.id])
        db.execute(
            f"""
            UPDATE notepad_notes
            SET {", ".join(fields)}
            WHERE id = ? AND workspace_id = ? AND agent_id = ?
            """,
            params,
        )

    return _note_from_row(_ensure_note(workspace, profile, note_id))


def delete_note(workspace: Workspace, profile: AgentProfile, note_id: str) -> dict[str, bool]:
    _ensure_note(workspace, profile, note_id)
    db.execute(
        """
        DELETE FROM notepad_notes
        WHERE id = ? AND workspace_id = ? AND agent_id = ?
        """,
        (note_id, workspace.id, profile.id),
    )
    return {"ok": True}


async def summarize_note(workspace: Workspace, profile: AgentProfile, note_id: str) -> NotepadNoteRecord:
    note = _note_from_row(_ensure_note(workspace, profile, note_id))
    source = "\n\n".join(
        part
        for part in [
            f"Meeting type: {note.meeting_type}",
            f"Title: {note.title}",
            f"Written notes:\n{note.content}".strip(),
            f"Transcript:\n{note.transcript}".strip(),
        ]
        if part.strip()
    )

    if not source.strip():
        raise HTTPException(status_code=400, detail="Add notes or a transcript before generating a summary.")

    prompt = "\n".join(
        [
            "Turn this meeting transcript and the user's written notes into concise internal meeting notes.",
            "Return only the final notes. Use short sections for Summary, Decisions, Action items, and Quotes when available.",
            "Preserve exact quotes only when they appear in the transcript.",
            "",
            source[:24_000],
        ]
    )
    result = await HermesRuntimeAdapter().run_agent(workspace, profile, prompt)

    if result.status == "failed":
        raise HTTPException(status_code=502, detail=result.error or "Could not generate notepad summary.")

    summary = (result.output or "").strip()

    if not summary:
        raise HTTPException(status_code=502, detail="Hermes returned an empty summary.")

    return update_note(
        workspace,
        profile,
        note_id,
        NotepadNoteUpdateRequest(summary=summary, source="hermes-summary"),
    )


def create_share(
    workspace: Workspace,
    profile: AgentProfile,
    note_id: str,
    share_url_for_token: Any,
) -> NotepadShareResponse:
    note = _note_from_row(_ensure_note(workspace, profile, note_id))
    if note.share_token:
        return NotepadShareResponse(token=note.share_token, url=share_url_for_token(note.share_token), note=note)

    token = f"np_{secrets.token_urlsafe(24)}"
    created_at = now_iso()
    db.execute(
        """
        INSERT INTO notepad_shares (id, token, note_id, workspace_id, agent_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (new_id("share"), token, note_id, workspace.id, profile.id, created_at),
    )
    note = _note_from_row(_ensure_note(workspace, profile, note_id))
    return NotepadShareResponse(token=token, url=share_url_for_token(token), note=note)


def revoke_share(workspace: Workspace, profile: AgentProfile, note_id: str) -> dict[str, bool]:
    _ensure_note(workspace, profile, note_id)
    db.execute(
        """
        UPDATE notepad_shares
        SET revoked_at = ?
        WHERE note_id = ? AND workspace_id = ? AND agent_id = ? AND revoked_at IS NULL
        """,
        (now_iso(), note_id, workspace.id, profile.id),
    )
    return {"ok": True}


def public_share(token: str) -> PublicNotepadShareResponse:
    row = db.fetch_one(
        """
        SELECT n.*, s.token AS share_token, w.name AS workspace_name
        FROM notepad_shares s
        JOIN notepad_notes n ON n.id = s.note_id
        JOIN workspaces w ON w.id = n.workspace_id
        WHERE s.token = ? AND s.revoked_at IS NULL
        LIMIT 1
        """,
        (token,),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Shared note not found.")

    folder = None
    if row.get("folder_id"):
        folder_row = db.fetch_one("SELECT * FROM notepad_folders WHERE id = ?", (row["folder_id"],))
        folder = _folder_from_row(folder_row) if folder_row else None

    workspace_name = str(row.pop("workspace_name"))
    return PublicNotepadShareResponse(note=_note_from_row(row), folder=folder, workspace_name=workspace_name)
