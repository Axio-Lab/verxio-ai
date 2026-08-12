"""Artifact / hermes-home object storage (Phase 3). Local FS default; S3 optional."""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Protocol


class ArtifactStore(Protocol):
    def put_directory(self, key: str, local_dir: Path) -> str: ...

    def restore_directory(self, key: str, local_dir: Path) -> bool: ...

    def exists(self, key: str) -> bool: ...


class LocalArtifactStore:
    """Stores snapshots under VERXIO_ARTIFACT_SNAPSHOT_ROOT (default .verxio/snapshots)."""

    def __init__(self, root: Path | None = None) -> None:
        if root is None:
            raw = os.getenv("VERXIO_ARTIFACT_SNAPSHOT_ROOT", "").strip()
            root = Path(raw) if raw else Path(os.getenv("VERXIO_STATE_DIR", ".verxio")) / "snapshots"
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        safe = key.replace("..", "_").lstrip("/")
        return self.root / safe

    def put_directory(self, key: str, local_dir: Path) -> str:
        dest = self._path(key)
        if dest.exists():
            shutil.rmtree(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(local_dir, dest)
        return str(dest)

    def restore_directory(self, key: str, local_dir: Path) -> bool:
        src = self._path(key)
        if not src.exists():
            return False
        if local_dir.exists():
            shutil.rmtree(local_dir)
        local_dir.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(src, local_dir)
        return True

    def exists(self, key: str) -> bool:
        return self._path(key).exists()


class S3ArtifactStore:
    """S3-compatible snapshot store. Requires boto3 when enabled."""

    def __init__(
        self,
        *,
        bucket: str,
        prefix: str = "verxio/",
        endpoint_url: str | None = None,
        region: str | None = None,
    ) -> None:
        import boto3  # type: ignore[import-untyped]

        self.bucket = bucket
        self.prefix = prefix.rstrip("/") + "/"
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint_url or None,
            region_name=region or os.getenv("AWS_REGION") or None,
        )

    def _key(self, key: str) -> str:
        return f"{self.prefix}{key.lstrip('/')}"

    def put_directory(self, key: str, local_dir: Path) -> str:
        # Tar into a single object for simplicity.
        import io
        import tarfile

        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            tar.add(local_dir, arcname=".")
        buf.seek(0)
        object_key = self._key(key) + ".tar.gz"
        self._client.upload_fileobj(buf, self.bucket, object_key)
        return f"s3://{self.bucket}/{object_key}"

    def restore_directory(self, key: str, local_dir: Path) -> bool:
        import io
        import tarfile

        object_key = self._key(key) + ".tar.gz"
        try:
            buf = io.BytesIO()
            self._client.download_fileobj(self.bucket, object_key, buf)
        except Exception:
            return False
        buf.seek(0)
        if local_dir.exists():
            shutil.rmtree(local_dir)
        local_dir.mkdir(parents=True, exist_ok=True)
        with tarfile.open(fileobj=buf, mode="r:gz") as tar:
            tar.extractall(local_dir)
        return True

    def exists(self, key: str) -> bool:
        object_key = self._key(key) + ".tar.gz"
        try:
            self._client.head_object(Bucket=self.bucket, Key=object_key)
            return True
        except Exception:
            return False


def get_artifact_store() -> LocalArtifactStore | S3ArtifactStore:
    backend = os.getenv("VERXIO_ARTIFACT_STORE", "local").strip().lower()
    if backend in {"s3", "r2", "minio"}:
        bucket = os.getenv("VERXIO_ARTIFACT_S3_BUCKET", "").strip()
        if not bucket:
            raise RuntimeError("VERXIO_ARTIFACT_S3_BUCKET is required for s3 artifact store")
        return S3ArtifactStore(
            bucket=bucket,
            prefix=os.getenv("VERXIO_ARTIFACT_S3_PREFIX", "verxio/"),
            endpoint_url=os.getenv("VERXIO_ARTIFACT_S3_ENDPOINT", "").strip() or None,
            region=os.getenv("VERXIO_ARTIFACT_S3_REGION", "").strip() or None,
        )
    return LocalArtifactStore()
