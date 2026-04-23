"""Attachment endpoints — presigned PUT + finalisation + presigned GET.

Bytes never go through this process: the client uploads directly to S3
with the presigned URL we mint here. Once the upload completes the
client calls ``attachment:upload-finalise`` so we record the metadata
(size, sha256) and kick off thumbnail generation.
"""

from __future__ import annotations

import os
from typing import Any

from ..shared.decorators import function
from ..shared.runtime import open_session

from ..events.ids import make_uuid7, now_ms


# Sensible dev defaults that match `infra/docker-compose.yml` so the
# upload flow "just works" after `make install` without forcing the
# operator to copy `.env.example` to `.env`. In real deployments the
# env vars below are set by the orchestrator and these defaults are
# never touched.
_DEFAULT_DEV_S3_ENDPOINT = "http://localhost:9100"
_DEFAULT_DEV_S3_BUCKET = "collabai-attachments"
_DEFAULT_DEV_S3_REGION = "us-east-1"
_DEFAULT_DEV_S3_KEY = "collabai"
_DEFAULT_DEV_S3_SECRET = "collabai-dev-password"


def _bucket() -> str:
    return os.environ.get("S3_BUCKET_NAME", _DEFAULT_DEV_S3_BUCKET)


def _client():  # type: ignore[no-untyped-def]
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=os.environ.get("S3_ENDPOINT_URL", _DEFAULT_DEV_S3_ENDPOINT),
        region_name=os.environ.get("S3_REGION", _DEFAULT_DEV_S3_REGION),
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID", _DEFAULT_DEV_S3_KEY),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY", _DEFAULT_DEV_S3_SECRET),
        # MinIO requires path-style addressing (the SDK's default
        # virtual-host style would resolve `bucket.localhost:9100`,
        # which doesn't exist) and the SigV4 signer that LiveKit-style
        # presigned PUTs depend on.
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def _object_key(workspace_id: str, file_id: str) -> str:
    """Build a per-attachment S3 object key.

    When ``S3_KEY_PREFIX`` is set (collaboration-ai running as a hof-os
    sidecar — the data-app threads e.g. ``tenants/<t>/chat`` into the
    container env), every key is rooted there so the data-app can
    re-validate them via ``ensure_key_under_tenant_prefix``. Standalone
    ``make dev`` leaves the env unset and keys keep the legacy
    ``workspaces/…`` shape.
    """
    base = f"workspaces/{workspace_id}/attachments/{file_id}"
    prefix = (os.environ.get("S3_KEY_PREFIX") or "").strip().strip("/")
    if not prefix:
        return base
    return f"{prefix}/{base}"


@function(name="attachment:upload-init", mcp_expose=True, mcp_scope="write:attachments")
def upload_init(workspace_id: str, mime: str, *, actor_id: str) -> dict[str, Any]:
    """Mint a presigned PUT URL for one upload. 5-minute TTL."""
    file_id = f"att_{make_uuid7()}"
    key = _object_key(workspace_id, file_id)
    client = _client()
    put_url = client.generate_presigned_url(
        "put_object",
        Params={"Bucket": _bucket(), "Key": key, "ContentType": mime},
        ExpiresIn=300,
    )
    return {
        "file_id": file_id,
        "object_key": key,
        "put_url": put_url,
        "headers": {"Content-Type": mime},
    }


@function(name="attachment:upload-finalise", mcp_expose=True, mcp_scope="write:attachments")
def upload_finalise(
    workspace_id: str,
    file_id: str,
    object_key: str,
    mime: str,
    size_bytes: int,
    *,
    width: int | None = None,
    height: int | None = None,
    actor_id: str,
) -> dict[str, Any]:
    """Persist the attachment row and (TODO) enqueue thumbnail + virus scan."""
    from sqlalchemy import text

    with open_session() as session:
        session.execute(
            text(
                """
                INSERT INTO attachments (id, file_id, workspace_id, uploaded_by, object_key,
                                         mime, size_bytes, width, height,
                                         virus_scan_status, created_at)
                VALUES (gen_random_uuid(), :file_id, :ws, :u, :k, :mime, :sz, :w, :h,
                        'pending', :ts)
                """
            ),
            {
                "file_id": file_id,
                "ws": workspace_id,
                "u": actor_id,
                "k": object_key,
                "mime": mime,
                "sz": size_bytes,
                "w": width,
                "h": height,
                "ts": now_ms(),
            },
        )
        session.commit()
    return {
        "file_id": file_id,
        "object_key": object_key,
        "mime": mime,
        "size_bytes": size_bytes,
    }


@function(name="attachment:download-url", mcp_expose=True, mcp_scope="read:attachments")
def download_url(workspace_id: str, file_id: str, *, actor_id: str) -> dict[str, Any]:
    """Mint a presigned GET URL. 5-minute TTL.

    The auth layer is responsible for verifying the caller can access the
    parent message; this endpoint just exposes the URL for an authorised
    file_id.
    """
    key = _object_key(workspace_id, file_id)
    client = _client()
    url = client.generate_presigned_url(
        "get_object",
        Params={"Bucket": _bucket(), "Key": key},
        ExpiresIn=300,
    )
    return {"file_id": file_id, "get_url": url}
