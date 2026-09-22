# Tool sandboxes

`deploy/sandbox/Dockerfile` is the per-run image (`verxio-sandbox`).

Workers set `DOCKER_HOST` to a TLS Docker API on dedicated sandbox hosts.
Hermes hosted policy (`VERXIO_HOSTED=1`) forces `terminal.backend=docker`.

Per-run limits (set on the Docker host daemon or via `VERXIO_SANDBOX_*`):

- memory: 1g
- cpus: 1
- pids: 256
- network: none unless a tool explicitly needs egress
- no host mounts; workspace is copied in and artifacts copied out

Chromium in this image is for browser tools. The Hermes worker image does not need Playwright.
