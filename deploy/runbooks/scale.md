# Scale runbooks

## Lease stuck

A tenant lease in Redis (`verxio:lease:tenant:{workspace}:{agent}`) blocks another worker.

1. `GET` the key. If the holder worker is gone, `DEL` the key.
2. The next turn re-acquires the lease and restores the home from object storage if the local copy is missing.

## Channel shard loss

Socket channels (WhatsApp Baileys, Discord) are sticky by `shard_for(workspace, agent)`.

1. Mark the shard unschedulable.
2. `drain_plan(lost_shard)` lists the remaining shards.
3. Restart the shard. Credentials reload from `channel_credentials` (encrypted in Turso).
4. Users re-pair only if the Baileys session file was not restored.

## Object storage restore

`python -m app.migrate_homes` uploads existing `.verxio/runtimes/.../hermes-home` trees.
Workers call `restore_home` on attach when the local directory is empty.
Snapshots exclude `cache/`, `audio_cache/`, `config.yaml.bak-*`, and cloned audit repos.

## Cutover

Keep `VERXIO_RUNTIME_MANAGER=local-docker` until a tenant flag in `runtime_plane_flags` is `pool`.
Then set `VERXIO_RUNTIME_MANAGER=pool`, `VERXIO_INLINE_SCHEDULER=0`, `VERXIO_WEBHOOK_INLINE=0`, and run `python -m app.scheduler` plus `python -m app.worker.runner`.
`scripts/deploy-ecs.sh` skips the per-user container wipe when the manager is `pool`.
