#!/usr/bin/env python3
"""Upload and optionally publish a Chrome extension via Chrome Web Store API v2."""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Dict, Optional


API_BASE = "https://chromewebstore.googleapis.com"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REQUIRED_ENV = (
    "EXTENSION_ID",
    "CWS_PUBLISHER_ID",
    "CWS_CLIENT_ID",
    "CWS_CLIENT_SECRET",
    "CWS_REFRESH_TOKEN",
)
UPLOAD_SUCCEEDED = {"SUCCEEDED", "SUCCESS", "UPLOAD_SUCCEEDED"}
UPLOAD_IN_PROGRESS = {"IN_PROGRESS", "UPLOAD_IN_PROGRESS"}
UPLOAD_FAILED = {"FAILED", "UPLOAD_FAILED"}


class ApiError(RuntimeError):
    def __init__(self, method: str, url: str, status: int, body: object) -> None:
        super().__init__(f"{method} {url} failed with HTTP {status}")
        self.method = method
        self.url = url
        self.status = status
        self.body = body


def env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name, "").strip().lower()
    if not value:
        return default
    return value in {"1", "true", "yes", "y", "on"}


def load_json_or_text(raw: bytes) -> object:
    text = raw.decode("utf-8", errors="replace")
    if not text:
        return {}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"raw": text}


def print_json(title: str, body: object) -> None:
    print(f"\n{title}:")
    print(json.dumps(body, indent=2, ensure_ascii=False, sort_keys=True))


def request_json(
    method: str,
    url: str,
    *,
    headers: Optional[Dict[str, str]] = None,
    data: Optional[bytes] = None,
    timeout: int = 120,
) -> object:
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return load_json_or_text(response.read())
    except urllib.error.HTTPError as error:
        body = load_json_or_text(error.read())
        raise ApiError(method, url, error.code, body) from error


def require_mapping(body: object, title: str) -> dict[str, object]:
    if not isinstance(body, dict):
        raise RuntimeError(f"{title} response was not a JSON object")
    return body


def get_access_token() -> str:
    payload = urllib.parse.urlencode(
        {
            "client_id": os.environ["CWS_CLIENT_ID"],
            "client_secret": os.environ["CWS_CLIENT_SECRET"],
            "refresh_token": os.environ["CWS_REFRESH_TOKEN"],
            "grant_type": "refresh_token",
        }
    ).encode("utf-8")
    body = require_mapping(
        request_json(
            "POST",
            TOKEN_URL,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data=payload,
        ),
        "OAuth token",
    )
    token = body.get("access_token")
    if not isinstance(token, str) or not token:
        print_json("OAuth token response", body)
        raise RuntimeError("OAuth token response did not include access_token")
    print("OAuth access token refreshed.")
    return token


def fetch_status(item_name: str, token: str) -> dict[str, object]:
    return require_mapping(
        request_json(
            "GET",
            f"{API_BASE}/v2/{item_name}:fetchStatus",
            headers={"Authorization": f"Bearer {token}"},
        ),
        "Chrome Web Store fetchStatus",
    )


def wait_for_upload(
    item_name: str, token: str, initial_state: str
) -> Optional[Dict[str, object]]:
    if initial_state in UPLOAD_SUCCEEDED:
        return None
    if initial_state in UPLOAD_FAILED:
        raise RuntimeError(f"Chrome Web Store upload failed: {initial_state}")
    if initial_state not in UPLOAD_IN_PROGRESS:
        raise RuntimeError(f"Unexpected Chrome Web Store upload state: {initial_state}")

    attempts = int(os.environ.get("CWS_POLL_ATTEMPTS", "20"))
    interval = int(os.environ.get("CWS_POLL_SECONDS", "15"))

    for attempt in range(1, attempts + 1):
        print(f"Upload is still processing; polling fetchStatus ({attempt}/{attempts})...")
        time.sleep(interval)
        status_body = fetch_status(item_name, token)
        state = str(status_body.get("lastAsyncUploadState", ""))
        print(f"lastAsyncUploadState={state or 'UNKNOWN'}")
        if state in UPLOAD_SUCCEEDED:
            return status_body
        if state in UPLOAD_FAILED:
            print_json("Chrome Web Store fetchStatus response", status_body)
            raise RuntimeError(f"Chrome Web Store upload failed: {state}")

    raise RuntimeError("Chrome Web Store upload did not finish before polling timed out")


def upload_package(item_name: str, token: str, package_path: str) -> None:
    if not os.path.isfile(package_path):
        raise RuntimeError(f"Package file does not exist: {package_path}")

    with open(package_path, "rb") as package_file:
        package_bytes = package_file.read()

    body = require_mapping(
        request_json(
            "POST",
            f"{API_BASE}/upload/v2/{item_name}:upload",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/zip",
            },
            data=package_bytes,
            timeout=300,
        ),
        "Chrome Web Store upload",
    )
    print_json("Chrome Web Store upload response", body)

    state = body.get("uploadState")
    if not isinstance(state, str) or not state:
        raise RuntimeError("Chrome Web Store upload response did not include uploadState")

    status_body = wait_for_upload(item_name, token, state)
    if status_body is not None:
        print_json("Chrome Web Store fetchStatus response", status_body)


def parse_deploy_percentage() -> int | None:
    value = os.environ.get("CWS_DEPLOY_PERCENTAGE", "").strip()
    if not value:
        return None
    percentage = int(value)
    if percentage < 0 or percentage > 100:
        raise RuntimeError("CWS_DEPLOY_PERCENTAGE must be between 0 and 100")
    return percentage


def publish_item(item_name: str, token: str) -> None:
    publish_type = os.environ.get("CWS_PUBLISH_TYPE", "").strip() or "DEFAULT_PUBLISH"
    payload: Dict[str, object] = {
        "publishType": publish_type,
        "skipReview": env_bool("CWS_SKIP_REVIEW", False),
        "blockOnWarnings": env_bool("CWS_BLOCK_ON_WARNINGS", True),
    }

    deploy_percentage = parse_deploy_percentage()
    if deploy_percentage is not None:
        payload["deployInfos"] = [{"deployPercentage": deploy_percentage}]

    body = require_mapping(
        request_json(
            "POST",
            f"{API_BASE}/v2/{item_name}:publish",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            data=json.dumps(payload).encode("utf-8"),
        ),
        "Chrome Web Store publish",
    )
    print_json("Chrome Web Store publish response", body)

    state = str(body.get("state", ""))
    if state in {"REJECTED", "CANCELLED", "ITEM_STATE_UNSPECIFIED"}:
        raise RuntimeError(f"Chrome Web Store publish returned unsuccessful state: {state}")
    if not state:
        raise RuntimeError("Chrome Web Store publish response did not include state")


def main() -> int:
    missing = [name for name in REQUIRED_ENV if not os.environ.get(name)]
    if missing:
        print(
            "::warning::Skipping Chrome Web Store release. Missing secrets: "
            + ", ".join(missing)
        )
        return 0

    package_path = os.environ.get("CWS_PACKAGE_PATH", "fudosan-tanka-viewer.zip")
    item_name = f"publishers/{os.environ['CWS_PUBLISHER_ID']}/items/{os.environ['EXTENSION_ID']}"

    try:
        token = get_access_token()
        upload_package(item_name, token, package_path)
        if env_bool("CWS_AUTO_PUBLISH", True):
            publish_item(item_name, token)
            final_status = fetch_status(item_name, token)
            print_json("Chrome Web Store final status", final_status)
        else:
            print("CWS_AUTO_PUBLISH is false; package uploaded without submitting for review.")
    except ApiError as error:
        print(f"::error::{error}", file=sys.stderr)
        print_json("Chrome Web Store API error response", error.body)
        return 1
    except Exception as error:  # noqa: BLE001 - GitHub Actions needs a clear top-level error.
        print(f"::error::{error}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
