# Tool sandboxes

`deploy/sandbox/Dockerfile` is the per-run image (`verxio-sandbox`).

## Topology

Pool workers never run tenant commands on their own host and never mount
`docker.sock`. The Hermes sidecar talks to a Docker daemon on dedicated
sandbox hosts over TLS:

    DOCKER_HOST=tcp://sandbox.internal:2376
    DOCKER_TLS_VERIFY=1
    DOCKER_CERT_PATH=/etc/verxio/sandbox-certs   # ca.pem, cert.pem, key.pem

`hermes_cli/verxio_hosted_policy.py` fails closed: with `VERXIO_HOSTED=1` a
unix socket or a plaintext TCP daemon is rejected unless
`VERXIO_SANDBOX_ALLOW_INSECURE=1` (docker-compose `pool` profile only, where
`verxio-sandbox` is a `docker:dind` service on `tcp://verxio-sandbox:2375`).

## Per-tenant container

`tools/environments/verxio_sandbox.py` (`VerxioSandboxEnvironment`) creates one
long-lived container per tenant on the sandbox daemon:

- labels `hermes-agent=1`, `hermes-task-id=verxio-{ws}-{agent}`, `verxio-tenant=…`
  so containers are reused across sessions and reaped like any Hermes container
- `--cap-drop ALL --security-opt no-new-privileges` (Hermes defaults)
- `--memory` / `--memory-swap` `VERXIO_SANDBOX_MEMORY_MB` (default 1024)
- `--cpus` `VERXIO_SANDBOX_CPUS` (default 1)
- `--pids-limit` `VERXIO_SANDBOX_PIDS` (default 256)
- `--network none` unless `VERXIO_SANDBOX_NETWORK` is set to a network name
- tmpfs `/workspace` and `/tmp`; **no host bind mounts**

## Workspace copy-in / copy-out

The daemon cannot see the worker filesystem, so the tenant workspace
(`VERXIO_WORKSPACE_DIR` from the tenant `.env`, under
`VERXIO_WORKER_HOMES_ROOT/{ws}/{agent}/workspace`) is mirrored:

1. before each command, files whose mtime/size changed are streamed in with
   `docker cp -` (tar), deletions are mirrored with `rm -rf`;
2. after each command `/workspace` is streamed out and applied to the local
   workspace (symlinks, devices and `..` paths are dropped; `node_modules`,
   `.git`, `.venv` etc. are skipped; files > 256 MiB are not synced).

The worker's artifact indexer and S3 home sync therefore see everything the
sandbox produced without the sandbox ever touching the worker host.

## Helm

    sandbox:
      dockerHost: tcp://sandbox.internal:2376
      tlsSecret: verxio-sandbox-client-certs   # ca.pem/cert.pem/key.pem
      image: ghcr.io/axio-lab/verxio-sandbox:<sha>
      limits: { memoryMb: 1024, cpus: 1, pids: 256 }

Chromium in this image is for browser tools. The Hermes worker image does not need Playwright.
