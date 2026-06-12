FROM docker:27-cli AS docker_cli

FROM python:3.11-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# libsql ships prebuilt wheels for linux/amd64 but not linux/arm64.
# On ARM, uv builds from source (maturin/Rust + cmake for libsql-ffi/SQLite).
# Prefer `platform: linux/amd64` in compose on Apple Silicon for a fast local build.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential cmake pkg-config \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PATH="/app/.venv/bin:${PATH}"

WORKDIR /app

# Runtime manager shells out to `docker` while using the mounted host socket.
COPY --from=docker_cli /usr/local/bin/docker /usr/local/bin/docker

COPY --from=builder /app/.venv /app/.venv

COPY app ./app
COPY migrations ./migrations
COPY static ./static

EXPOSE 8787

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8787"]
