# Phase notes

Shipped together on `verxio/architecture` — see [README.md](./README.md).

| Phase | Delivered |
|-------|-----------|
| 1 | State machine, wake/drain/idle reap APIs, restart policy `no`, optional publish ports |
| 2 | `RuntimeManager` + `LocalDockerRuntimeManager` + factory |
| 3 | In-memory/Redis leases, local/S3 artifact snapshots on drain |
| 4 | `FlyRuntimeManager` (Machines API) |
| 5 | Plan idle policies, wake queue |
| 6 | `K8sRuntimeManager` manifest stub, cell routing |

Next ops work: enable Fly staging token in CI nightly; wire cron to `POST /api/runtime/idle/reap`.
