"""Dependency-free Prometheus metrics for the control plane.

A tiny registry with counters, gauges and histograms rendered in the
Prometheus text exposition format. It deliberately avoids a hard dependency
on ``prometheus_client`` so the API image and the local compose stack keep
working unchanged; the surface is the handful of series the SLO alerts in
``deploy/helm/verxio/templates/monitoring.yaml`` are built on:

    verxio_http_request_duration_seconds{route}         request latency
    verxio_http_requests_total{method,route,status}      request count
    verxio_dashboard_proxy_duration_seconds{kind}        upstream latency
    verxio_dashboard_proxy_errors_total{reason}          upstream failures
    verxio_dashboard_read_cache_total{result}            hit / miss / coalesced
    verxio_runtime_health_probes_total{result}           ok / fail
    verxio_runtime_watchdog_actions_total{action}        heal actions
    verxio_runtime_ws_connections                        live proxied sockets
"""

from __future__ import annotations

import math
import os
import threading
import time
from collections.abc import Iterable, Iterator
from contextlib import contextmanager

LabelKey = tuple[tuple[str, str], ...]

DEFAULT_BUCKETS: tuple[float, ...] = (0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0)


def metrics_enabled() -> bool:
    return os.getenv("VERXIO_METRICS_ENABLED", "1").strip().lower() not in {"0", "false", "no", "off"}


def _label_key(labels: dict[str, str] | None) -> LabelKey:
    if not labels:
        return ()
    return tuple(sorted((str(k), str(v)) for k, v in labels.items()))


def _escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def _fmt_labels(key: LabelKey, extra: Iterable[tuple[str, str]] = ()) -> str:
    parts = [f'{k}="{_escape(v)}"' for k, v in (*key, *extra)]
    return "{" + ",".join(parts) + "}" if parts else ""


def _fmt_float(value: float) -> str:
    if math.isinf(value):
        return "+Inf" if value > 0 else "-Inf"
    if float(value).is_integer():
        return str(int(value))
    return repr(float(value))


class _Metric:
    kind = "untyped"

    def __init__(self, name: str, help_text: str) -> None:
        self.name = name
        self.help = help_text
        self._lock = threading.Lock()

    def render(self) -> Iterator[str]:  # pragma: no cover - overridden
        yield from ()


class Counter(_Metric):
    kind = "counter"

    def __init__(self, name: str, help_text: str) -> None:
        super().__init__(name, help_text)
        self._values: dict[LabelKey, float] = {}

    def inc(self, amount: float = 1.0, **labels: str) -> None:
        key = _label_key(labels)
        with self._lock:
            self._values[key] = self._values.get(key, 0.0) + amount

    def value(self, **labels: str) -> float:
        return self._values.get(_label_key(labels), 0.0)

    def render(self) -> Iterator[str]:
        with self._lock:
            items = list(self._values.items())
        for key, value in items:
            yield f"{self.name}{_fmt_labels(key)} {_fmt_float(value)}"


class Gauge(_Metric):
    kind = "gauge"

    def __init__(self, name: str, help_text: str) -> None:
        super().__init__(name, help_text)
        self._values: dict[LabelKey, float] = {}

    def set(self, value: float, **labels: str) -> None:
        with self._lock:
            self._values[_label_key(labels)] = float(value)

    def inc(self, amount: float = 1.0, **labels: str) -> None:
        key = _label_key(labels)
        with self._lock:
            self._values[key] = self._values.get(key, 0.0) + amount

    def dec(self, amount: float = 1.0, **labels: str) -> None:
        self.inc(-amount, **labels)

    def value(self, **labels: str) -> float:
        return self._values.get(_label_key(labels), 0.0)

    def render(self) -> Iterator[str]:
        with self._lock:
            items = list(self._values.items())
        for key, value in items:
            yield f"{self.name}{_fmt_labels(key)} {_fmt_float(value)}"


class Histogram(_Metric):
    kind = "histogram"

    def __init__(self, name: str, help_text: str, buckets: tuple[float, ...] = DEFAULT_BUCKETS) -> None:
        super().__init__(name, help_text)
        self.buckets = tuple(sorted(buckets))
        self._counts: dict[LabelKey, list[int]] = {}
        self._sums: dict[LabelKey, float] = {}
        self._totals: dict[LabelKey, int] = {}

    def observe(self, value: float, **labels: str) -> None:
        key = _label_key(labels)
        with self._lock:
            counts = self._counts.setdefault(key, [0] * len(self.buckets))
            for idx, bound in enumerate(self.buckets):
                if value <= bound:
                    counts[idx] += 1
            self._sums[key] = self._sums.get(key, 0.0) + value
            self._totals[key] = self._totals.get(key, 0) + 1

    @contextmanager
    def time(self, **labels: str) -> Iterator[None]:
        start = time.perf_counter()
        try:
            yield
        finally:
            self.observe(time.perf_counter() - start, **labels)

    def count(self, **labels: str) -> int:
        return self._totals.get(_label_key(labels), 0)

    def render(self) -> Iterator[str]:
        with self._lock:
            snapshot = [(key, list(self._counts[key]), self._sums[key], self._totals[key]) for key in self._counts]
        for key, counts, total_sum, total in snapshot:
            for idx, bound in enumerate(self.buckets):
                yield f"{self.name}_bucket{_fmt_labels(key, (('le', _fmt_float(bound)),))} {counts[idx]}"
            yield f"{self.name}_bucket{_fmt_labels(key, (('le', '+Inf'),))} {total}"
            yield f"{self.name}_sum{_fmt_labels(key)} {_fmt_float(total_sum)}"
            yield f"{self.name}_count{_fmt_labels(key)} {total}"


class Registry:
    def __init__(self) -> None:
        self._metrics: list[_Metric] = []
        self._lock = threading.Lock()

    def register(self, metric: _Metric) -> _Metric:
        with self._lock:
            self._metrics.append(metric)
        return metric

    def render(self) -> str:
        lines: list[str] = []
        with self._lock:
            metrics = list(self._metrics)
        for metric in metrics:
            lines.append(f"# HELP {metric.name} {metric.help}")
            lines.append(f"# TYPE {metric.name} {metric.kind}")
            lines.extend(metric.render())
        return "\n".join(lines) + "\n"

    def reset_for_tests(self) -> None:
        with self._lock:
            for metric in self._metrics:
                for attr in ("_values", "_counts", "_sums", "_totals"):
                    store = getattr(metric, attr, None)
                    if isinstance(store, dict):
                        store.clear()


REGISTRY = Registry()

HTTP_REQUESTS = REGISTRY.register(Counter("verxio_http_requests_total", "HTTP requests handled by the API."))
HTTP_LATENCY = REGISTRY.register(
    Histogram("verxio_http_request_duration_seconds", "API request latency by route template.")
)
PROXY_LATENCY = REGISTRY.register(
    Histogram(
        "verxio_dashboard_proxy_duration_seconds",
        "Upstream Hermes dashboard latency by request class (lightweight/medium/write/other).",
    )
)
PROXY_ERRORS = REGISTRY.register(
    Counter("verxio_dashboard_proxy_errors_total", "Dashboard proxy upstream failures by reason.")
)
READ_CACHE = REGISTRY.register(
    Counter("verxio_dashboard_read_cache_total", "Dashboard polled-read cache outcomes (hit/miss/coalesced).")
)
HEALTH_PROBES = REGISTRY.register(
    Counter("verxio_runtime_health_probes_total", "Runtime dashboard health probes by result (ok/fail).")
)
WATCHDOG_ACTIONS = REGISTRY.register(
    Counter("verxio_runtime_watchdog_actions_total", "Runtime watchdog heal actions by kind.")
)
WS_CONNECTIONS = REGISTRY.register(
    Gauge("verxio_runtime_ws_connections", "Dashboard WebSockets currently proxied by this replica.")
)
RUNTIME_WAKES = REGISTRY.register(Counter("verxio_runtime_wakes_total", "Runtime wake attempts by result."))


def route_template(scope: dict) -> str:
    route = scope.get("route")
    path = getattr(route, "path", None)
    if isinstance(path, str) and path:
        return path
    raw = str(scope.get("path") or "/")
    # Unmatched paths (404s, static) collapse to their first segment so a
    # scanner cannot explode the label cardinality.
    head = raw.strip("/").split("/", 1)[0]
    return f"/{head}" if head else "/"


def render() -> str:
    return REGISTRY.render()
