# Reviewed upstream skill sync and fork releases

This fork uses [`catalogue.toml`](../catalogue.toml) for skill ownership and
[`docs/upstream-revision.txt`](upstream-revision.txt) for the last **reviewed**
`addyosmani/agent-skills` source commit. Consumer repositories continue to
pin a full **fork** commit in `skills.lock.toml`; they never install from
a moving upstream branch.

## Proposing upstream updates

The [review-only workflow](../.github/workflows/reviewed-upstream-sync.yml)
runs weekly or by `workflow_dispatch`. It resolves upstream `main` (or an
explicit full 40-character SHA), fetches only Git objects, and updates files
that changed between the recorded upstream revision and the proposed revision.
It creates a branch and PR **without merging or updating consumers**.

For local inspection from a clean checkout:

```bash
python scripts/upstream_skills.py sync --sha <full-upstream-sha> --dry-run
python -m unittest discover -s scripts -p 'upstream_skills_test.py'
python scripts/upstream_skills.py validate --fetch
```

If `--sha` is omitted, the sync resolves upstream `refs/heads/main`.
The GitHub Actions workflow uses `GH_TOKEN` only to push its proposal and
create a PR; no fetched code is executed. It never force-pushes, auto-merges,
or modifies `main`. A new proposal for an existing upstream SHA is skipped.

## Ownership and collisions

- `ownership = "upstream"` means the entire declared skill directory must
  match the recorded upstream commit. A changed local file causes a **hard
  failure**, never an overwrite.
- `ownership = "custom"` protects the directory from automated syncing.
  For forks of upstream skills, record `upstream_path` and `diverged_from`
  in the catalogue.
- Shared roots (`references/`, `agents/`) have their own ownership. Upstream
  changes are applied only to files changed upstream; local additions are
  never blindly removed. A locally modified upstream file blocks the sync.
- Newly discovered upstream skills are appended to the catalogue for review.
  Deleting an upstream skill requires a deliberate human change.
- Resolve local conflicts by marking intentional divergences `custom` with
  provenance, or by manually reviewing and reconciling the upstream diff.
  Never relabel an unreviewed change as upstream-owned to make validation pass.

**Review every generated PR:** inspect the source SHA, changed content,
prompt-injection risk, licence changes, shared references, and the catalogue.
The scheduled workflow is a proposal, not an approval. PRs created with
`GITHUB_TOKEN` may not automatically trigger other Actions workflows; run
the required checks explicitly if needed.

## Release and rollback

For an immutable fork release, first ensure the upstream PR and catalogue
provenance have been reviewed and merged, and tests are green:

```bash
python scripts/upstream_skills.py validate --fetch
node scripts/validate-skills.js
node scripts/validate-reference-links.js
node scripts/validate-skill-distribution-fixtures.js
python -m unittest discover -s scripts -p 'upstream_skills_test.py'
```

Tag the reviewed **fork** commit using the project's version convention:

```bash
git tag -a v0.6.18 -m "Reviewed skill distribution release"
git push origin v0.6.18
python scripts/upstream_skills.py validate --fetch --tag v0.6.18
```

The release validator checks that the tag resolves to the current checkout
commit, `docs/upstream-revision.txt` is a 40-hex SHA, the catalogue IDs
and directories are consistent, and upstream-owned content matches the
recorded upstream commit. GitHub CI also validates this on release-tag pushes.
Do not move or delete published release tags or pinned commits.

Consumers use a tracked `skills.toml` and `skills.lock.toml`, where the
lock identifies the exact **fork commit** and hashes. To roll back, change
the consumer's source reference and regenerate its lock with the factory's
`skills-update` task (when available), review that metadata-only PR, then
run `skills-install` and read-only `skills-check`. Do not copy skill trees
or agent adapters into the consuming repository's Git index.

If the upstream update itself needs rollback, revert the reviewed sync PR
and release a **new** fork tag. Never rewrite an existing release/tag.
