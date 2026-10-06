#!/usr/bin/env python3
"""Incrementally upload Zoo samples and submit them for review. Python 3.11+, no dependencies."""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

from check_kcl_sample_ids import sample_ids


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Api:
    def __init__(self, base_url, token):
        parsed = urllib.parse.urlsplit(base_url)
        if (parsed.scheme != "https" and not (
            parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}
        )) or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("API URL must use HTTPS (or HTTP on localhost), without credentials/query/fragment")
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, method, path, body=None, files=None):
        headers = {"Authorization": f"Bearer {self.token}", "User-Agent": "Zoo-KCL-Sample-Sync/0.1"}
        data = None
        if body is not None:
            data, content_type = multipart(body, files)
            headers["Content-Type"] = content_type
        req = urllib.request.Request(self.base_url + path, data=data, headers=headers, method=method)
        try:
            with self.opener.open(req, timeout=120) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            # Do not print response bodies: they may contain sensitive diagnostics.
            raise RuntimeError(f"{method} {path}: HTTP {error.code}") from None
        except urllib.error.URLError:
            raise RuntimeError(f"{method} {path}: connection failed; verify remote state before retrying a create") from None

    def categories(self):
        result = []
        path = "/projects/categories"
        while path:
            page = self.request("GET", path)
            if isinstance(page, list):  # Current legacy catalog contract.
                return result + page
            result.extend(page["items"])
            token = page.get("next_page")
            path = "/projects/categories?page_token=" + urllib.parse.quote(token, safe="") if token else None
        return result

    def projects(self):
        result = {}
        seen_tokens = set()
        path = "/user/projects"
        while path:
            page = self.request("GET", path)
            # Older APIs return the complete inventory as an array.
            if isinstance(page, list):
                items = page
            elif isinstance(page, dict) and isinstance(page.get("items"), list):
                items = page["items"]
            else:
                raise ValueError("Invalid cloud project inventory")
            for project in items:
                if not isinstance(project, dict) or not isinstance(project.get("id"), str):
                    raise ValueError("Invalid cloud project inventory")
                result[str(uuid.UUID(project["id"]))] = project
            if isinstance(page, list):
                return items
            token = page.get("next_page")
            if token is None and "next_page" in page:
                return list(result.values())
            if not isinstance(token, str) or not token.strip() or token in seen_tokens:
                raise ValueError("Invalid cloud project pagination cursor")
            seen_tokens.add(token)
            path = "/user/projects?page_token=" + urllib.parse.quote(token, safe="")


def validate_cloud_project_ids(api, state):
    owners = {}
    for sample_id, previous in state["samples"].items():
        project_id = str(uuid.UUID(previous["project_id"]))
        if project_id in owners:
            raise ValueError(f"Cloud project {project_id} is mapped to multiple sample UUIDs")
        owners[project_id] = sample_id
    # Check the entire account, even when syncing just one sample. An old
    # bootstrap or a lost create response can omit a successful earlier upload.
    remote_ids = {str(uuid.UUID(project["id"])) for project in api.projects()}
    untracked = remote_ids - owners.keys()
    if untracked:
        raise ValueError("Untracked cloud projects: " + ", ".join(sorted(untracked))
                         + "; restore or reconcile the checkpoint before uploading. "
                         "--initialize-state requires an empty dedicated sample account")
    missing = owners.keys() - remote_ids
    if missing:
        raise ValueError("Checkpoint cloud projects missing from this account: " + ", ".join(sorted(missing))
                         + "; resolve the mapping before uploading")


def multipart(body, files):
    boundary = "sample-sync-" + uuid.uuid4().hex
    parts = []
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="body"\r\n'
                 'Content-Type: application/json\r\n\r\n'.encode() + json.dumps(body).encode() + b"\r\n")
    for index, (name, content) in enumerate(sorted(files.items())):
        if any(c in name for c in '\r\n"\\'):
            raise ValueError(f"Unsupported upload filename: {name!r}")
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file-{index}"; '
                     f'filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode()
                     + content + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), "multipart/form-data; boundary=" + boundary


def read_file(root, relative):
    path = PurePosixPath(relative)
    if path.is_absolute() or ".." in path.parts or "\\" in relative:
        raise ValueError(f"Unsafe sample path: {relative}")
    resolved = (root / relative).resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise ValueError(f"Sample path escapes root: {relative}")
    return resolved.read_bytes()


def manifest(root):
    manifest = json.loads((root / "manifest.json").read_text())
    if isinstance(manifest, str):
        manifest = json.loads(manifest)
    return manifest


def bundles(root, selected):
    identities = sample_ids(root)
    seen = set()
    result = []
    for sample in manifest(root):
        entry = PurePosixPath(sample["pathFromProjectDirectoryToFirstFile"])
        if len(entry.parts) < 2 or entry.is_absolute() or ".." in entry.parts:
            raise ValueError(f"Invalid entrypoint: {entry}")
        slug = entry.parts[0]
        if slug in seen:
            raise ValueError(f"Duplicate sample slug: {slug}")
        seen.add(slug)
        if selected and slug not in selected:
            continue
        sample_root = root / slug
        if not sample_root.resolve().is_relative_to(root.resolve()):
            raise ValueError(f"Sample directory escapes root: {slug}")
        # Include assets/imports as well as the KCL files listed in the manifest.
        files = {p.relative_to(sample_root).as_posix(): read_file(sample_root, p.relative_to(sample_root).as_posix())
                 for p in sorted(sample_root.rglob("*")) if p.is_file()}
        entrypoint = PurePosixPath(*entry.parts[1:]).as_posix()
        if entrypoint not in files:
            raise ValueError(f"Missing entrypoint for {slug}")
        preview = root / "screenshots" / (slug + ".png")
        if preview.exists():
            files["thumbnail.png"] = read_file(root, "screenshots/" + slug + ".png")
        result.append((identities[slug], slug, sample, entrypoint, files))
    missing = selected - seen
    if missing:
        raise ValueError("Unknown samples: " + ", ".join(sorted(missing)))
    return result


def fingerprint(body, files):
    digest = hashlib.sha256(json.dumps(body, sort_keys=True).encode())
    for name, content in sorted(files.items()):
        digest.update(json.dumps([name, len(content)]).encode())
        digest.update(content)
    return digest.hexdigest()


def save_state(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")
    temporary.replace(path)


def submit_review(api, state_path, state, sample_id):
    previous = state["samples"][sample_id]
    if previous.get("submitted_revision") == previous["revision"]:
        return
    path = "/user/projects/" + str(uuid.UUID(previous["project_id"]))
    current = api.request("GET", path)
    if current["revision"] != previous["revision"]:
        raise ValueError(f"{previous['slug']}: remote revision changed; resolve before submitting")
    # This endpoint is idempotent for an already-submitted current version.
    # Save uploads before calling it, so retries never recreate the project.
    response = api.request("POST", path + "/publish")
    if response["revision"] != previous["revision"]:
        raise ValueError(f"{previous['slug']}: remote revision changed during review submission")
    previous["submitted_revision"] = response["revision"]
    save_state(state_path, state)
    print(f"REVIEW {previous['slug']}: {previous['project_id']}")


def sync(root, state_path, api=None, selected=None, initialize=False, category_map=None):
    selected = set(selected or [])
    samples = bundles(root, selected)  # Validate selected files before any writes.
    if api is None:
        for sample_id, slug, sample, entrypoint, files in samples:
            print(f"PLAN {slug} ({sample_id}): {len(files)} files, entrypoint={entrypoint}, categories={sample['categories']}")
        print(f"Validated {len(samples)} samples; no API requests or state changes.")
        return
    owner_id = api.request("GET", "/user")["id"]
    identity = {"api_url": api.base_url, "owner_id": owner_id}
    if state_path.exists():
        state = json.loads(state_path.read_text())
        if state.get("version") not in {1, 2} or any(state.get(k) != v for k, v in identity.items()):
            raise ValueError("State belongs to another API/account or has an unsupported version")
    elif initialize:
        state = {"version": 2, **identity, "samples": {}}
    else:
        raise ValueError("Missing state: restore it, or use --initialize-state for the first import only")
    if state["version"] == 1:
        # Preserve project IDs from the first prototype; never silently recreate
        # a legacy sample whose slug can no longer be resolved.
        identities = sample_ids(root)
        migrated = {}
        for slug, previous in state["samples"].items():
            if slug not in identities:
                raise ValueError(f"Legacy state sample {slug}: restore its directory or migrate its UUID manually")
            migrated[identities[slug]] = {**previous, "slug": slug}
        state["samples"] = migrated
        state["version"] = 2
    validate_cloud_project_ids(api, state)
    categories = {c["display_name"].strip().casefold(): c["id"] for c in api.categories()}
    categories.update({k.strip().casefold(): v for k, v in (category_map or {}).items()})
    desired = []
    for sample_id, slug, sample, entrypoint, files in samples:
        names = sample.get("categories", [])
        unknown = [n for n in names if n.strip().casefold() not in categories]
        if unknown:
            raise ValueError(f"{slug}: unmapped categories {unknown}; supply --category-map")
        body = {"title": sample["title"], "description": sample.get("description", ""),
                "entrypoint_path": entrypoint,
                "category_ids": sorted({categories[n.strip().casefold()] for n in names})}
        desired.append((sample_id, slug, body, files, fingerprint(body, files)))
    save_state(state_path, state)
    for sample_id, slug, body, files, digest in desired:
        previous = state["samples"].get(sample_id)
        if previous and previous.get("sha256") == digest:
            previous["slug"] = slug
            save_state(state_path, state)
            submit_review(api, state_path, state, sample_id)
            print(f"SKIP {slug}: unchanged ({previous['project_id']})")
            continue
        if previous:
            path = "/user/projects/" + str(uuid.UUID(previous["project_id"]))
            summary = api.request("GET", path)  # ProjectResponse flattens its summary.
            if summary["revision"] != previous["revision"]:
                raise ValueError(f"{slug}: remote revision changed; resolve before overwriting")
            if summary["publication_status"] not in {"private", "draft", "pending_review", "published", "rejected", "changes_requested"}:
                raise ValueError(f"{slug}: project status does not allow review submission")
            body["expected_revision"] = summary["revision"]
            body["deleted_paths"] = sorted(set(previous["files"]) - set(files) - {"thumbnail.png"})
            response = api.request("PUT", path, body, files)
            action = "UPDATE"
        else:
            body["publication_status"] = "draft"
            response = api.request("POST", "/user/projects", body, files)
            action = "CREATE"
        summary = response
        state["samples"][sample_id] = {"slug": slug, "project_id": summary["id"], "revision": summary["revision"],
                                  "sha256": digest, "files": sorted(files)}
        save_state(state_path, state)  # Checkpoint each success, including partial runs.
        print(f"{action} {slug}: {summary['id']}")
        submit_review(api, state_path, state, sample_id)
    identities = sample_ids(root)
    source_ids = {identities[PurePosixPath(s["pathFromProjectDirectoryToFirstFile"]).parts[0]] for s in manifest(root)}
    for sample_id in sorted(set(state["samples"]) - source_ids):
        print(f"RETAIN {state['samples'][sample_id]['slug']}: removed from source; no deletion performed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples-root", type=Path, required=True)
    parser.add_argument("--state", type=Path, default=Path("sample-sync-state.json"))
    parser.add_argument("--api-url")
    parser.add_argument("--sample", action="append", default=[])
    parser.add_argument("--all", action="store_true", help="Explicitly allow applying the entire catalog")
    parser.add_argument("--apply", action="store_true", help="Upload and submit for review; default is an offline dry run")
    parser.add_argument("--initialize-state", action="store_true")
    parser.add_argument("--category-map", type=Path, help="JSON object mapping manifest category names to API UUIDs")
    args = parser.parse_args()
    api = None
    if args.apply:
        token = os.environ.get("ZOO_API_TOKEN")
        if not token or not args.api_url or not (args.sample or args.all):
            parser.error("--apply requires ZOO_API_TOKEN, --api-url, and --sample or --all")
        api = Api(args.api_url, token)
    mapping = json.loads(args.category_map.read_text()) if args.category_map else None
    sync(args.samples_root, args.state, api, args.sample, args.initialize_state, mapping)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, RuntimeError) as error:
        print(f"Sync failed: {error}", file=sys.stderr)
        sys.exit(1)
