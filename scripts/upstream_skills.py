#!/usr/bin/env python3
"""Review-first upstream skill synchronisation and release provenance checks.

Only paths declared upstream-owned in catalogue.toml are eligible for changes.
Uses git objects as data; never runs scripts fetched from upstream.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = "https://github.com/addyosmani/agent-skills.git"
BASELINE = Path("docs/upstream-revision.txt")
SHA = re.compile(r"^[0-9a-f]{40}$")
SKILL = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")


class SyncError(RuntimeError):
    """An unsafe or ambiguous upstream change requiring human intervention."""


def git(root: Path, *args: str) -> bytes:
    proc = subprocess.run(
        ["git", "-C", str(root), *args], capture_output=True, check=False
    )
    if proc.returncode:
        raise SyncError(
            f"git {' '.join(args[:3])}: {proc.stderr.decode(errors='replace').strip()}"
        )
    return proc.stdout


def ensure_revision(root: Path, remote: str, revision: str, *, fetch: bool) -> None:
    if not SHA.fullmatch(revision):
        raise SyncError(f"expected full 40-character upstream SHA, got {revision!r}")
    exists = subprocess.run(
        ["git", "-C", str(root), "cat-file", "-e", f"{revision}^{{commit}}"],
        capture_output=True,
        check=False,
    )
    if exists.returncode:
        if not fetch:
            raise SyncError(f"missing upstream commit {revision}; fetch it first")
        git(root, "fetch", "--no-tags", "--depth=1", remote, revision)
        git(root, "cat-file", "-e", f"{revision}^{{commit}}")


def latest_sha(root: Path, remote: str) -> str:
    reply = git(root, "ls-remote", remote, "refs/heads/main").decode().strip()
    if not reply or len(reply.splitlines()) != 1:
        raise SyncError(f"could not resolve a single upstream main revision: {reply!r}")
    revision = reply.split()[0]
    if not SHA.fullmatch(revision):
        raise SyncError(f"invalid upstream revision {revision!r}")
    return revision


def file_tree(root: Path, revision: str, prefix: str) -> dict[str, str]:
    """Return path -> git file mode from a pinned commit."""
    out = git(root, "ls-tree", "-r", "-z", revision, "--", prefix)
    result = {}
    for row in out.split(b"\0"):
        if not row:
            continue
        meta, path = row.split(b"\t", 1)
        mode, kind, _ = meta.split()
        name = path.decode("utf-8")
        if kind != b"blob" or mode not in (b"100644", b"100755"):
            raise SyncError(f"non-regular upstream content at {name}")
        result[name] = mode.decode()
    return result


def blob(root: Path, revision: str, path: str) -> bytes:
    return git(root, "show", f"{revision}:{path}")


def catalogue(root: Path) -> dict:
    with (root / "catalogue.toml").open("rb") as handle:
        data = tomllib.load(handle)
    if data.get("schema") != 1:
        raise SyncError("catalogue.toml must use schema 1")
    if data.get("upstream", {}).get("repository") != "addyosmani/agent-skills":
        raise SyncError("unsupported upstream repository in catalogue")
    ids: set[str] = set()
    for item in data.get("skill", []):
        name = item.get("id", "")
        if not isinstance(name, str) or not SKILL.fullmatch(name) or name.lower() in ids:
            raise SyncError(f"invalid or duplicate skill identifier: {name!r}")
        ids.add(name.lower())
        if item.get("ownership") not in ("custom", "upstream"):
            raise SyncError(f"invalid ownership for skill {name}")
        if item.get("path", f"skills/{name}") != f"skills/{name}":
            raise SyncError(f"skill path must resolve to skills/{name}")
    actual = {
        child.name.lower()
        for child in (root / "skills").iterdir()
        if child.is_dir()
    }
    if ids != actual:
        raise SyncError(
            f"catalogue missing/extra skill directories: "
            f"unlisted={sorted(actual - ids)}, absent={sorted(ids - actual)}"
        )
    paths: list[str] = []
    shared_ids: set[str] = set()
    for item in data.get("shared", []):
        path = item.get("path", "")
        ident = item.get("id", "")
        if not isinstance(ident, str) or not SKILL.fullmatch(ident) or ident.lower() in shared_ids:
            raise SyncError(f"invalid/duplicate shared id: {ident!r}")
        shared_ids.add(ident.lower())
        parts = path.split("/") if isinstance(path, str) else []
        if not parts or any(part in ("", ".", "..") for part in parts) or "\\" in path or path.startswith("skills/") or path == "skills":
            raise SyncError(f"unsafe shared path: {path!r}")
        if any(path == other or path.startswith(other + "/") or other.startswith(path + "/") for other in paths):
            raise SyncError(f"overlapping shared paths: {path!r}")
        paths.append(path)
        if item.get("ownership") not in ("custom", "upstream"):
            raise SyncError(f"invalid ownership for shared root {path}")
    return data


def category(path: str, data: dict) -> str | None:
    if path.startswith("skills/"):
        parts = path.split("/")
        if len(parts) >= 3:
            return next(
                (s["ownership"] for s in data["skill"] if s["id"] == parts[1]), None
            )
    for item in data.get("shared", []):
        if path.startswith(item["path"] + "/"):
            return item["ownership"]
    return None


def revision_file(root: Path) -> str:
    path = root / BASELINE
    value = path.read_text(encoding="ascii").strip()
    if not SHA.fullmatch(value):
        raise SyncError(f"{BASELINE}: expected full upstream SHA")
    return value


def validate(root: Path, remote: str, *, fetch: bool, tag: str | None = None) -> None:
    data = catalogue(root)
    old = revision_file(root)
    ensure_revision(root, remote, old, fetch=fetch)
    entries = [*data["skill"], *data.get("shared", [])]
    for item in entries:
        path = item.get("path", f"skills/{item['id']}")
        local = root / path
        if not local.is_dir():
            raise SyncError(f"catalogue entry missing directory {path}")
        if path.startswith("skills/"):
            skill_text = (local / "SKILL.md").read_text(encoding="utf-8")
            if not re.search(r"(?m)^name:\s*['\"]?" + re.escape(item["id"]) + r"['\"]?\s*$", skill_text):
                raise SyncError(f"{path}/SKILL.md: frontmatter name mismatch")
        if item["ownership"] == "custom":
            if file_tree(root, old, path) and (not item.get("upstream_path") or not item.get("diverged_from")):
                raise SyncError(f"{path}: diverged fork content requires upstream_path and diverged_from")
            continue
        upstream = file_tree(root, old, path)
        local_files = {
            str(p.relative_to(root)).replace("\\", "/"): p
            for p in local.rglob("*") if p.is_file()
        }
        if set(upstream) != set(local_files):
            missing = sorted(set(upstream) - set(local_files))
            extra = sorted(set(local_files) - set(upstream))
            raise SyncError(f"{path} differs from recorded upstream {old[:12]}: missing={missing[:5]}, extra={extra[:5]}; mark diverged content custom")
        for name in upstream:
            if local_files[name].is_symlink() or local_files[name].read_bytes() != blob(root, old, name):
                raise SyncError(f"{name} differs from recorded upstream; protect it as custom")
    if tag:
        if not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?", tag):
            raise SyncError(f"not a release tag: {tag}")
        tagged = git(root, "rev-parse", "--verify", f"refs/tags/{tag}^{{commit}}").decode().strip()
        head = git(root, "rev-parse", "HEAD").decode().strip()
        if tagged != head:
            raise SyncError(f"tag {tag} resolves to {tagged}, not HEAD {head}")
    print(f"Validated {len(data['skill'])} skills and {len(data.get('shared', []))} shared roots against upstream {old}")


def sync(root: Path, remote: str, *, sha: str | None = None, dry_run: bool = False) -> None:
    if git(root, "status", "--porcelain").strip():
        raise SyncError("working tree is not clean; commit or stash changes first")
    data = catalogue(root)
    old = revision_file(root)
    new = sha or latest_sha(root, remote)
    ensure_revision(root, remote, old, fetch=True)
    ensure_revision(root, remote, new, fetch=True)
    # Preflight every upstream-owned path before changing anything, including
    # paths untouched by the new revision.
    validate(root, remote, fetch=False)
    # Do not overwrite a fork-owned skill. New upstream skills are explicitly
    # added to the catalogue for review; removed skills require manual action.
    before = file_tree(root, old, "skills")
    after = file_tree(root, new, "skills")
    old_ids = {p.split("/")[1] for p in before if p.endswith("/SKILL.md")}
    new_ids = {p.split("/")[1] for p in after if p.endswith("/SKILL.md")}
    declared = {s["id"]: s for s in data["skill"]}
    removed = sorted(name for name in old_ids - new_ids if declared.get(name, {}).get("ownership") == "upstream")
    if removed:
        raise SyncError(f"upstream removed skills {removed}; review and retire them manually")
    additions = sorted(new_ids - declared.keys())
    for name in additions:
        if not SKILL.fullmatch(name) or len(name) > 64 or (root / "skills" / name).exists():
            raise SyncError(f"new upstream skill conflicts with local path/identifier: {name}")
        text = blob(root, new, f"skills/{name}/SKILL.md").decode("utf-8")
        if not re.search(r"(?m)^name:\s*['\"]?" + re.escape(name) + r"['\"]?\s*$", text):
            raise SyncError(f"upstream skill {name}: SKILL.md name mismatch")
        data["skill"].append({"id": name, "ownership": "upstream"})
    prefixes = ["skills", *[s["path"] for s in data.get("shared", [])]]
    old_files: dict[str, str] = {}
    new_files: dict[str, str] = {}
    for prefix in prefixes:
        old_files.update(file_tree(root, old, prefix))
        new_files.update(file_tree(root, new, prefix))
    updates: list[tuple[str, bytes | None]] = []
    protected = []
    for path in sorted(old_files.keys() | new_files.keys()):
        if old_files.get(path) == new_files.get(path):
            if path not in old_files:
                continue
            # Same mode may conceal changed blob content.
            changed = path in new_files and blob(root, old, path) != blob(root, new, path)
        else:
            changed = True
        if not changed:
            continue
        owner = category(path, data)
        if owner != "upstream":
            protected.append(path)
            continue
        if any(part in ("", ".", "..") for part in path.split("/")) or "\\" in path:
            raise SyncError(f"unsafe upstream path: {path!r}")
        target = root / path
        if any(parent.is_symlink() for parent in list(target.parents) if parent != root and root in parent.parents):
            raise SyncError(f"symlinked parent directory for {path}")
        expected = blob(root, old, path) if path in old_files else None
        if target.is_symlink() or (target.exists() and (expected is None or not target.is_file() or target.read_bytes() != expected)):
            raise SyncError(f"local changes at {path}; mark custom, do not overwrite")
        if expected is not None and not target.exists():
            raise SyncError(f"upstream-owned local file missing: {path}")
        updates.append((path, blob(root, new, path) if path in new_files else None))
    print(f"Upstream {old[:12]} -> {new[:12]}: {len(updates)} file changes, {len(additions)} new skills, {len(protected)} protected paths")
    for path in protected:
        print(f"  protected (custom): {path}")
    if dry_run:
        for name, _ in updates:
            print(f"  would update: {name}")
        return
    for name, content in updates:
        target = root / name
        if content is None:
            target.unlink()
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
    if additions:
        with (root / "catalogue.toml").open("a", encoding="utf-8") as handle:
            for name in additions:
                handle.write(f'\n[[skill]]\nid = "{name}"\nownership = "upstream"\n')
    (root / BASELINE).write_text(new + "\n", encoding="ascii")
    validate(root, remote, fetch=False)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("sync", "validate"))
    parser.add_argument("--sha", help="Explicit full upstream commit (sync only)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--fetch", action="store_true", help="Fetch missing recorded upstream commit")
    parser.add_argument("--tag", help="Verify release tag resolves to checkout HEAD")
    args = parser.parse_args()
    try:
        if args.command == "sync":
            sync(ROOT, UPSTREAM, sha=args.sha or None, dry_run=args.dry_run)
        else:
            validate(ROOT, UPSTREAM, fetch=args.fetch, tag=args.tag)
    except (SyncError, OSError, UnicodeError, KeyError, ValueError) as exc:
        print(f"upstream skills: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
