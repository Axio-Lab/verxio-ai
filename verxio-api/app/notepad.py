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
from app.runtime import HermesRuntimeAdapter, get_runtime_settings
from app.runtime_dashboard import run_agent_via_dashboard


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
    existing = _ensure_note(workspace, profile, note_id)
    updates = payload.model_dump(exclude_unset=True)

    if "folder_id" in updates:
        _ensure_folder(workspace, profile, updates["folder_id"])

    # Notes expose content and summary as separate panes / share surfaces.
    # Agents often PATCH only ``content`` after create (where summary was
    # mirrored from content). Keep the summary pane in sync when it was still
    # that mirror or empty — do not clobber an independently authored summary
    # (e.g. hermes-summary) unless the caller explicitly sends ``summary``.
    if "content" in updates and "summary" not in updates:
        old_content = str(existing.get("content") or "").strip()
        old_summary = str(existing.get("summary") or "").strip()
        if not old_summary or old_summary == old_content:
            updates["summary"] = updates.get("content") or ""

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


def _build_notepad_summary_prompt(*, meeting_type: str, title: str, content: str, transcript: str) -> str:
    """Build the LLM prompt for the Notepad Summarize button.

    Voice notes and screen recordings land as long transcripts in ``content`` /
    ``transcript``. The summary must be an in-depth walkthrough of that source
    material — not a short executive blurb.
    """
    source = "\n\n".join(
        part
        for part in [
            f"Meeting type: {meeting_type}",
            f"Title: {title}",
            f"Written notes:\n{content}".strip(),
            f"Transcript:\n{transcript}".strip(),
        ]
        if part.strip()
    )
    return "\n".join(
        [
            "You are writing an in-depth summary of a Verxio Notepad entry.",
            "The source is often a voice note, microphone recording, screen/device recording transcript, or meeting notes — treat it as primary source material that the reader did not listen to.",
            "Do NOT write a short teaser, one-paragraph blurb, or high-level executive overview.",
            "Write a thorough, detailed Markdown summary that someone can read instead of replaying the recording.",
            "",
            "Requirements:",
            "- Cover the full arc of the source: opening context, each major topic or segment in order, and how it closes.",
            "- Expand on explanations, arguments, demos, UI/workflow steps, numbers, names, and examples — do not collapse them into vague bullets.",
            "- Call out decisions, commitments, blockers, follow-ups, and action items with owners/timing when the source mentions them.",
            "- Preserve notable exact quotes when they appear in the transcript.",
            "- Prefer depth over brevity. A long, structured summary is correct; a short summary is wrong.",
            "",
            "Return only valid Markdown. Prefer sections like:",
            "## Overview",
            "## Detailed walkthrough",
            "## Key points",
            "## Decisions",
            "## Action items",
            "## Notable quotes",
            "Omit a section only when the source truly has nothing for it.",
            "",
            # Long voice/screen transcripts need headroom; soft-cap to keep the
            # dashboard completion within typical context budgets.
            source[:80_000],
        ]
    )


async def summarize_note(workspace: Workspace, profile: AgentProfile, note_id: str) -> NotepadNoteRecord:
    note = _note_from_row(_ensure_note(workspace, profile, note_id))
    if not any(part.strip() for part in (note.content, note.transcript, note.title)):
        raise HTTPException(status_code=400, detail="Add notes or a transcript before generating a summary.")

    prompt = _build_notepad_summary_prompt(
        meeting_type=note.meeting_type,
        title=note.title,
        content=note.content,
        transcript=note.transcript,
    )
    if get_runtime_settings().mode == "demo":
        result = await HermesRuntimeAdapter().run_agent(workspace, profile, prompt)
        if result.status == "failed":
            raise HTTPException(status_code=502, detail=result.error or "Could not generate notepad summary.")
        summary = (result.output or "").strip()
    else:
        summary = await run_agent_via_dashboard(workspace, profile, prompt)

    return update_note(
        workspace,
        profile,
        note_id,
        NotepadNoteUpdateRequest(summary=summary, source="hermes-summary"),
    )


def _ensure_shareable_summary(
    workspace: Workspace,
    profile: AgentProfile,
    note: NotepadNoteRecord,
) -> NotepadNoteRecord:
    """Public share URLs render ``summary``. Promote notes/transcript if empty."""
    if (note.summary or "").strip():
        return note
    fallback = (note.content or "").strip() or (note.transcript or "").strip()
    if not fallback:
        return note
    return update_note(
        workspace,
        profile,
        note.id,
        NotepadNoteUpdateRequest(summary=fallback),
    )


def create_share(
    workspace: Workspace,
    profile: AgentProfile,
    note_id: str,
    share_url_for_token: Any,
) -> NotepadShareResponse:
    note = _note_from_row(_ensure_note(workspace, profile, note_id))
    note = _ensure_shareable_summary(workspace, profile, note)
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
