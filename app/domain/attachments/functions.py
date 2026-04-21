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


def _bucket() -> str:
    return os.environ.get("S3_BUCKET_NAME", "collabai-attachments")


def _client():  # type: ignore[no-untyped-def]
    import boto3

    return boto3.client(
        "s3",
        endpoint_url=os.environ.get("S3_ENDPOINT_URL"),
        region_name=os.environ.get("S3_REGION", "us-east-1"),
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
    )


def _object_key(workspace_id: str, file_id: str) -> str:
    return f"workspaces/{workspace_id}/attachments/{file_id}"


@function(name="attachment:upload-init", mcp_expose=False)
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


@function(name="attachment:upload-finalise", mcp_expose=False)
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
