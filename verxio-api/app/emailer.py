from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage
from typing import Literal


AuthCodePurpose = Literal["email_verify", "login", "password_reset"]

SENT_AUTH_EMAILS: list[dict[str, str]] = []


def _smtp_port() -> int:
    return int(os.getenv("VERXIO_SMTP_PORT", "587"))


def _smtp_tls() -> bool:
    return os.getenv("VERXIO_SMTP_TLS", "true").strip().lower() in {"1", "true", "yes", "on"}


def _smtp_configured() -> bool:
    return bool(os.getenv("VERXIO_SMTP_HOST", "").strip() and os.getenv("VERXIO_SMTP_FROM", "").strip())


def _subject_for_purpose(purpose: AuthCodePurpose) -> str:
    if purpose == "email_verify":
        return "Your Verxio verification code"
    if purpose == "password_reset":
        return "Reset your Verxio password"
    return "Your Verxio login code"


def _body_for_purpose(*, code: str, purpose: AuthCodePurpose, expires_minutes: int) -> str:
    action = {
        "email_verify": "verify your email and open your workspace",
        "login": "sign in to your Verxio workspace",
        "password_reset": "reset your Verxio password",
    }[purpose]
    return "\n".join(
        [
            f"Use this code to {action}:",
            "",
            code,
            "",
            f"This code expires in {expires_minutes} minutes.",
            "If you did not request this, you can ignore this email.",
        ]
    )


def send_auth_code_email(*, to_email: str, purpose: AuthCodePurpose, code: str, expires_minutes: int) -> None:
    subject = _subject_for_purpose(purpose)
    body = _body_for_purpose(code=code, purpose=purpose, expires_minutes=expires_minutes)

    if not _smtp_configured():
        SENT_AUTH_EMAILS.append(
            {
                "to": to_email,
                "purpose": purpose,
                "code": code,
                "subject": subject,
                "body": body,
            }
        )
        print(f"[verxio-auth] {purpose} code for {to_email}: {code} (expires in {expires_minutes} minutes)")
        return

    message = EmailMessage()
    message["From"] = os.getenv("VERXIO_SMTP_FROM", "").strip()
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(body)

    host = os.getenv("VERXIO_SMTP_HOST", "").strip()
    username = os.getenv("VERXIO_SMTP_USERNAME", "").strip()
    password = os.getenv("VERXIO_SMTP_PASSWORD", "")

    with smtplib.SMTP(host, _smtp_port(), timeout=15) as smtp:
        if _smtp_tls():
            smtp.starttls()
        if username:
            smtp.login(username, password)
        smtp.send_message(message)
