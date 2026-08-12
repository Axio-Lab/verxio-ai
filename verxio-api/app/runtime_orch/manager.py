"""RuntimeManager protocol — backends: local-docker, k8s."""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from app.models import RuntimeInstance


@runtime_checkable
class RuntimeManager(Protocol):
    """Physical compute backend for a logical RuntimeInstance."""

    name: str

    async def start(
        self,
        runtime: RuntimeInstance,
        *,
        extra_env: dict[str, str] | None = None,
        wait_ready: bool = True,
    ) -> RuntimeInstance: ...

    async def stop(self, runtime: RuntimeInstance) -> RuntimeInstance: ...

    async def restart(
        self,
        runtime: RuntimeInstance,
        *,
        extra_env: dict[str, str] | None = None,
    ) -> RuntimeInstance: ...

    async def drain(self, runtime: RuntimeInstance) -> RuntimeInstance:
        """Begin idle drain (checkpoint + stop). Default = stop."""
        ...

    async def address(self, runtime: RuntimeInstance) -> str | None:
        """Internal base URL for API→runtime HTTP/WS (no host-port required)."""
        ...

    async def webhook_address(self, runtime: RuntimeInstance) -> str | None:
        """Internal base URL for inbound messaging webhook POSTs."""
        ...

    async def health(self, runtime: RuntimeInstance) -> tuple[bool, str]: ...

    def supports_publish_ports(self) -> bool:
        """Whether this backend needs host-port publishing."""
        ...


class RuntimeManagerError(RuntimeError):
    """Backend orchestration failure."""

    def __init__(self, message: str, *, detail: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.detail = detail or {}
