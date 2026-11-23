"""Offline regression tests for reviewed upstream sync."""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from upstream_skills import SyncError, sync, validate  # noqa: E402


def git(root: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


def write(root: Path, relative: str, content: str) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def commit(root: Path, message: str) -> str:
    git(root, "add", "-A")
    git(root, "commit", "-qm", message)
    return git(root, "rev-parse", "HEAD")


class UpstreamTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        home = Path(self.tmp.name)
        self.upstream = home / "upstream"
        self.fork = home / "fork"
        self.upstream.mkdir()
        git(self.upstream, "init", "-q")
        git(self.upstream, "config", "user.email", "test@example.invalid")
        git(self.upstream, "config", "user.name", "Skill Test")
        write(
            self.upstream,
            "skills/alpha/SKILL.md",
            "---\nname: alpha\ndescription: Alpha skill\n---\nOriginal\n",
        )
        write(self.upstream, "references/a.md", "Shared checklist\n")
        self.baseline = commit(self.upstream, "baseline")
        git(home, "clone", "-q", str(self.upstream), str(self.fork))
        git(self.fork, "config", "user.email", "test@example.invalid")
        git(self.fork, "config", "user.name", "Skill Test")
        write(
            self.fork,
            "catalogue.toml",
            'schema = 1\n[upstream]\nrepository = "addyosmani/agent-skills"\n'
            '[[shared]]\nid = "references"\npath = "references"\nownership = "upstream"\n'
            '[[skill]]\nid = "alpha"\nownership = "upstream"\n',
        )
        write(self.fork, "docs/upstream-revision.txt", self.baseline + "\n")
        commit(self.fork, "catalogue and baseline")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_updates_only_changed_upstream_paths_and_adds_new_skill(self) -> None:
        write(self.upstream, "skills/alpha/SKILL.md", "---\nname: alpha\n---\nUpdated\n")
        write(self.upstream, "skills/bravo/SKILL.md", "---\nname: bravo\n---\nNew\n")
        new = commit(self.upstream, "skills update")
        sync(self.fork, str(self.upstream), sha=new)
        self.assertIn("Updated", (self.fork / "skills/alpha/SKILL.md").read_text())
        self.assertTrue((self.fork / "skills/bravo/SKILL.md").is_file())
        self.assertIn('id = "bravo"', (self.fork / "catalogue.toml").read_text())
        self.assertEqual(new, (self.fork / "docs/upstream-revision.txt").read_text().strip())
        validate(self.fork, str(self.upstream), fetch=False)

    def test_dry_run_makes_no_working_tree_changes(self) -> None:
        write(self.upstream, "skills/alpha/SKILL.md", "---\nname: alpha\n---\nUpdated\n")
        new = commit(self.upstream, "update")
        sync(self.fork, str(self.upstream), sha=new, dry_run=True)
        self.assertFalse(git(self.fork, "status", "--porcelain"))
        self.assertEqual(self.baseline, (self.fork / "docs/upstream-revision.txt").read_text().strip())

    def test_refuses_overwrite_of_local_changes(self) -> None:
        write(self.upstream, "skills/alpha/SKILL.md", "---\nname: alpha\n---\nUpdated\n")
        new = commit(self.upstream, "update")
        write(self.fork, "skills/alpha/SKILL.md", "---\nname: alpha\n---\nLocally changed\n")
        commit(self.fork, "local divergence")
        with self.assertRaisesRegex(SyncError, "custom"):
            sync(self.fork, str(self.upstream), sha=new)
        self.assertIn("Locally changed", (self.fork / "skills/alpha/SKILL.md").read_text())

    def test_protects_explicit_custom_skills(self) -> None:
        write(self.upstream, "skills/alpha/SKILL.md", "---\nname: alpha\n---\nUpdated\n")
        new = commit(self.upstream, "update")
        file = self.fork / "catalogue.toml"
        file.write_text(file.read_text().replace('ownership = "upstream"\n', 'ownership = "custom"\n', 1))
        # Shared root is custom, skill remains upstream: change the latter too.
        file.write_text(file.read_text().replace(
            '[[skill]]\nid = "alpha"\nownership = "upstream"',
            '[[skill]]\nid = "alpha"\nownership = "custom"',
        ))
        commit(self.fork, "protect custom skill")
        sync(self.fork, str(self.upstream), sha=new)
        self.assertIn("Original", (self.fork / "skills/alpha/SKILL.md").read_text())

    def test_release_tag_must_point_to_head(self) -> None:
        git(self.fork, "tag", "v0.1.0")
        validate(self.fork, str(self.upstream), fetch=False, tag="v0.1.0")
        write(self.fork, "unrelated.txt", "New file")
        commit(self.fork, "later change")
        with self.assertRaisesRegex(SyncError, "not HEAD"):
            validate(self.fork, str(self.upstream), fetch=False, tag="v0.1.0")


if __name__ == "__main__":
    unittest.main()
