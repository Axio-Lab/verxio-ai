FROM docker:27-cli AS docker_cli

FROM python:3.11-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN pip install --no-cache-dir uv

# Core dependencies are pure-Python or ship arm64 wheels, so the default build
# is native-fast on Apple Silicon (no Rosetta emulation, no source compiles).
# Turso support (the libsql client) has no linux/arm64 wheel; opt in with
# `--build-arg INSTALL_TURSO=1` (best built under linux/amd64 where wheels exist).
ARG INSTALL_TURSO=
ARG INSTALL_SCALE=
COPY verxio-api/pyproject.toml verxio-api/uv.lock ./
# Turso (libsql) may need a compiler on some platforms. Scale extras (redis/boto3/
# kubernetes) ship wheels — install them without build-essential.
RUN EXTRAS="" \
    && if [ -n "$INSTALL_TURSO" ]; then EXTRAS="$EXTRAS --extra turso"; fi \
    && if [ -n "$INSTALL_SCALE" ]; then EXTRAS="$EXTRAS --extra scale"; fi \
    && if [ -n "$INSTALL_TURSO" ]; then \
        apt-get update \
        && apt-get install -y --no-install-recommends build-essential cmake pkg-config \
        && rm -rf /var/lib/apt/lists/* \
        && uv sync --frozen --no-dev $EXTRAS; \
    elif [ -n "$EXTRAS" ]; then \
        uv sync --frozen --no-dev $EXTRAS; \
    else \
        uv sync --frozen --no-dev; \
    fi

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PATH="/app/.venv/bin:${PATH}"
ENV VERXIO_HERMES_REPO=/opt/hermes-agent

WORKDIR /app

# Runtime manager shells out to `docker` while using the mounted host socket.
COPY --from=docker_cli /usr/local/bin/docker /usr/local/bin/docker

COPY --from=builder /app/.venv /app/.venv

COPY verxio-api/app ./app
COPY verxio-api/migrations ./migrations
COPY verxio-api/static ./static
COPY hermes-agent /opt/hermes-agent

EXPOSE 8787

# Two workers: a busy gateway/docker thread pool on one worker must not make
# /api/health time out for the whole control plane (single-worker freeze on ECS).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8787", "--workers", "2"]
