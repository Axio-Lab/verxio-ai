"""Optional OpenTelemetry + structured logging. No-ops without the extra packages."""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger("verxio.observability")


def setup_observability(service_name: str = "verxio-api") -> None:
    if os.getenv("VERXIO_OTEL_ENABLED", "").strip().lower() not in {"1", "true", "yes", "on"}:
        return
    try:
        from opentelemetry import trace
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
    except ImportError:
        logger.info("OpenTelemetry packages not installed; skipping tracer setup")
        return

    resource = Resource.create({"service.name": service_name})
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
    if endpoint:
        try:
            from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

            provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint)))
        except ImportError:
            logger.warning("OTLP exporter unavailable; using console spans")
    trace.set_tracer_provider(provider)
    logger.info("OpenTelemetry tracer configured service=%s", service_name)


def instrument_fastapi(app: Any) -> None:
    if os.getenv("VERXIO_OTEL_ENABLED", "").strip().lower() not in {"1", "true", "yes", "on"}:
        return
    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

        FastAPIInstrumentor.instrument_app(app)
    except Exception:
        logger.debug("FastAPI instrumentation skipped", exc_info=True)
