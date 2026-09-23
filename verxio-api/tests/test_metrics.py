"""Prometheus exposition for the control plane."""

from __future__ import annotations

import pytest

from app import metrics


@pytest.fixture(autouse=True)
def _reset():
    metrics.REGISTRY.reset_for_tests()
    yield
    metrics.REGISTRY.reset_for_tests()


def test_counter_gauge_histogram_render_in_exposition_format():
    metrics.HTTP_REQUESTS.inc(method="GET", route="/api/health", status="200")
    metrics.HTTP_REQUESTS.inc(method="GET", route="/api/health", status="200")
    metrics.WS_CONNECTIONS.inc()
    metrics.WS_CONNECTIONS.inc()
    metrics.WS_CONNECTIONS.dec()
    metrics.PROXY_LATENCY.observe(0.03, kind="lightweight")
    metrics.PROXY_LATENCY.observe(3.0, kind="lightweight")

    text = metrics.render()
    assert "# TYPE verxio_http_requests_total counter" in text
    assert 'verxio_http_requests_total{method="GET",route="/api/health",status="200"} 2' in text
    assert "verxio_runtime_ws_connections 1" in text
    assert 'verxio_dashboard_proxy_duration_seconds_bucket{kind="lightweight",le="0.05"} 1' in text
    assert 'verxio_dashboard_proxy_duration_seconds_bucket{kind="lightweight",le="2.5"} 1' in text
    assert 'verxio_dashboard_proxy_duration_seconds_bucket{kind="lightweight",le="+Inf"} 2' in text
    assert 'verxio_dashboard_proxy_duration_seconds_count{kind="lightweight"} 2' in text
    assert text.endswith("\n")


def test_labels_are_escaped_and_route_template_bounds_cardinality():
    metrics.PROXY_ERRORS.inc(reason='weird "quoted"\nvalue')
    assert 'reason="weird \\"quoted\\"\\nvalue"' in metrics.render()

    class Route:
        path = "/api/runtime/dashboard/{path:path}"

    assert metrics.route_template({"route": Route(), "path": "/api/runtime/dashboard/api/status"}) == Route.path
    assert metrics.route_template({"path": "/assets/app-abc123.js"}) == "/assets"
    assert metrics.route_template({"path": "/"}) == "/"


def test_metrics_endpoint_serves_text(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app

    monkeypatch.setenv("VERXIO_METRICS_ENABLED", "1")
    with TestClient(app) as client:
        client.get("/api/health")
        response = client.get("/metrics")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    assert 'verxio_http_requests_total{method="GET",route="/api/health"' in response.text
    # The scrape itself is not counted.
    assert 'route="/metrics"' not in response.text
