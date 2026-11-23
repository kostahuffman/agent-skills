# Skill Distribution Contract

Status: Proposed for architecture review (parent task A1, [issue #2](https://github.com/kostahuffman/agent-skills/issues/2)).
Schema version: `1`.

This document defines the cross-repository contract for selecting skills from
[`kostahuffman/agent-skills`](https://github.com/kostahuffman/agent-skills) and
pinning their exact Git content. It is the dependency for the installer
(`python-gh-workflows`) and the Copier templates. It defines the contract only:
no installer, template, or skill content is changed by this document.

Normative words (`MUST`, `MUST NOT`, `SHOULD`) describe requirements on the
source catalogue, the consumer manifest, the lock file, and any implementation
that reads them.

## 1. Goals and non-goals

The contract must make all of the following true:

- A consumer selects a subset of skills without tracking installed skill
  content in Git.
- An ordinary install is reproducible from tracked metadata and never follows
  a moving branch.
- Skill identity is stable across repositories, platforms, and source classes.
- Ambiguous ownership fails loudly instead of silently overwriting content.
- The same identity rules cover fork-owned skills, upstream skills, external
  Git sources, and skills advertised by installed Python packages.
- Windows and Linux produce the same selection, content hashes, and lock file.

Non-goals for schema `1`:

- Installing every skill by default.
- Renaming a skill while keeping the old identifier working (aliases).
- A general-purpose package manager or agent orchestration system.
- Fetching or executing arbitrary code during installation. Skill scripts are
  content, not installer hooks.

## 2. Artifacts

| Artifact | Tracked? | Owner | Purpose |
|---|---|---|---|
| `catalogue.toml` (source repository root) | Yes | `kostahuffman/agent-skills` | Stable identifiers and ownership for every skill in a release commit. |
| `skills.toml` (consumer root) | Yes | Consuming repository | Canonical source, profile, and include/exclude selection. |
| `skills.lock.toml` (consumer root) | Yes | Consuming repository | Immutable resolved commit, selected sources, paths, and content hashes. |
| `skills.sources.toml` (consumer root) | Yes | Consuming repository | External Git skill declarations. The legacy `skills/sources.toml` path is inside an ignored root and must migrate. |
| `references/` and `agents/` (source root) | Yes | `kostahuffman/agent-skills` | Shared resources referenced by selected skills. The catalogue declares which roots are installable. |
| `skills/<id>/` | No, generated | Installer | Canonical selected skill content. |
| `references/` and `agents/` (consumer root) | No, generated | Installer | Required shared resources, installed at the same repository-relative paths. |
| `.agents/skills/<id>/` | No, generated | Installer | Codex discovery adapter. |
| `.claude/skills/<id>/` | No, generated | Installer | Claude Code discovery adapter. |
| `.skills-managed` (inside each generated skill or shared resource root) | No, generated | Installer | Ownership marker; never copied from a source. |

The canonical skill source is the `skills/` directory of a release commit of
`kostahuffman/agent-skills`. `catalogue.toml` is the machine-readable index of
that directory. The consumer's `skills.toml` selects from the catalogue;
`skills.lock.toml` records exactly what was resolved and installed.

## 3. Canonical catalogue

### 3.1 Stable identifiers

A skill identifier is the skill directory name under `skills/`. It MUST:

- Match `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$` and be at most 64 characters.
- Equal the `name` field in the skill's `SKILL.md` frontmatter.
- Be unique in the catalogue, compared case-insensitively. This rejects
  collisions that would otherwise behave differently on case-insensitive
  filesystems.
- Be treated as a compatibility identifier. The identifier is not reused for
  different content. Removing or renaming an identifier is a breaking
  catalogue change; consumers continue to work by staying pinned to an older
  release commit.

Schema `1` has no alias mechanism. A future rename MUST either keep a
compatibility skill directory for the old identifier or ship a schema change
with an explicit migration mapping. It MUST NOT silently redirect an old
identifier to new content under the same release.

### 3.2 Ownership

Every catalogue entry declares `ownership` as one of:

- `upstream` — the directory is byte-identical to the corresponding path in
  the upstream repository at the most recently reviewed sync commit. Allowed
  differences (for example a repository-wide metadata normalization) MUST be
  called out and justified in the sync PR.
- `custom` — the directory is authored in this fork, or is an upstream skill
  that this fork intentionally diverges from. A diverged skill retains
  provenance with `upstream_path` and `diverged_from`; it does not stay
  `upstream`.

Ownership changes are catalogue changes. They MUST land in the same reviewed
PR as the content change, so a release never advertises provenance it no
longer has. Custom skills MUST NOT duplicate an existing upstream skill
without the justification required by [CONTRIBUTING.md](../CONTRIBUTING.md).

### 3.3 Catalogue file

The catalogue is strict TOML with schema `1`:

```toml
schema = 1

[upstream]
repository = "addyosmani/agent-skills"

[[shared]]
id = "agents"
path = "agents"
ownership = "upstream"

[[shared]]
id = "references"
path = "references"
ownership = "upstream"

[[skill]]
id = "code-review-and-quality"
ownership = "upstream"

[[skill]]
id = "issue-and-pr-governance"
ownership = "custom"
```

Field reference:

| Field | Required | Meaning |
|---|---|---|
| `schema` | Yes | Integer `1`. |
| `upstream.repository` | Yes | `owner/name` of the upstream repository. |
| `[[skill]].id` | Yes | Stable identifier. |
| `[[skill]].ownership` | Yes | `upstream` or `custom`. |
| `[[skill]].path` | No | Repository-relative skill path. Defaults to `skills/<id>`. MUST be inside `skills/` and end with `/<id>`. |
| `[[skill]].upstream_path` | No | Upstream-relative path for provenance. Defaults to `skills/<id>` for upstream skills. |
| `[[skill]].diverged_from` | No | Upstream commit, tag, or SHA the custom divergence is based on. |
| `[[skill]].note` | No | Short human-readable provenance note. Never used for selection. |
| `[[shared]].id` | Yes | Stable identifier for a shared resource root. Uses the skill identifier grammar. |
| `[[shared]].path` | Yes | Repository-relative shared root. MUST NOT be `skills/`, overlap another shared path, or contain a selected skill. |
| `[[shared]].ownership` | Yes | `upstream` or `custom`; the same provenance rules as skills. |
| `[[shared]].upstream_path` | No | Upstream-relative path for provenance. Defaults to `path`. |
| `[[shared]].diverged_from` | No | Upstream commit, tag, or SHA the custom divergence is based on. |
| `[[shared]].note` | No | Short human-readable provenance note. Never used for selection. |

Catalogue validation MUST enforce:

- Every directory under `skills/` appears exactly once, and every catalogue
  entry resolves to an existing directory.
- Each `SKILL.md` exists and its frontmatter `name` matches `id`.
- No duplicate `id` values, case-insensitively.
- No `path` traversal, absolute path, backslash, drive letter, or reserved
  Windows filename.
- `upstream` entries do not carry `diverged_from`.
- `diverged_from` is absent or a valid commit/tag reference.
- Every `[[shared]]` path exists and is a directory at the release commit.
- `[[shared]]` identifiers and paths are unique, case-insensitively.
- `[[shared]]` paths do not overlap each other and do not sit under `skills/`.
- Unknown keys are rejected.

### 3.4 Shared resources

Some selected skills link outside their own directory to shared checklists or
personas (`../../references/...`, `../../agents/...`). Those links are part of
the skill content and MUST continue to resolve after installation. The
catalogue declares the source roots that may contain shared resources; the
installer discovers the required files from the selected skills rather than
installing every shared file.

Rules:

- Only roots declared by `[[shared]]` are installable shared resources.
- A relative link from a selected canonical skill MUST resolve to a regular
  file under a declared shared root at the pinned commit. A link that escapes
  the repository, points at another skill, or points outside every declared
  shared root fails with `shared.outside_root`.
- A link to a missing file fails with `shared.missing`.
- The lock records the exact required file set and its hash. A shared root with
  no required files is not installed.
- Shared resources are derived, not selected directly by consumers. They are
  not listed in `selection.skills`.
- External and package skills are installed as declared and MUST be
  self-contained. Their links are not resolved against canonical shared roots.

## 4. Consumer selection manifest (`skills.toml`)

### 4.1 Complete example

```toml
schema = 1

[source]
repository = "kostahuffman/agent-skills"
ref = "v0.6.17"                 # release tag or full 40-hex commit SHA
path = "skills"                # optional; default "skills"
catalogue_path = "catalogue.toml" # optional; default "catalogue.toml"

[selection]
profile = "python-service"     # optional; omit for explicit include/exclude only
include = ["deprecation-and-migration"]
exclude = ["browser-testing-with-devtools", "frontend-ui-engineering"]

[profiles.python-service]
include = [
  "using-agent-skills",
  "spec-driven-development",
  "test-driven-development",
  "browser-testing-with-devtools",
  "frontend-ui-engineering",
]
exclude = []
```

### 4.2 Field reference

| Field | Required | Meaning |
|---|---|---|
| `schema` | Yes | Integer `1`. |
| `source.repository` | Yes | `owner/name` on GitHub. No URL, scheme, credentials, or `.git` suffix. |
| `source.ref` | Yes | Release tag (`vMAJOR.MINOR.PATCH`, optional semver suffix) or full 40-hex lowercase commit SHA. Branch names, `main`, `latest`, and short SHAs are invalid. |
| `source.path` | No | Repository-relative path containing skill directories. Default `skills`. |
| `source.catalogue_path` | No | Repository-relative catalogue path. Default `catalogue.toml`. |
| `selection.profile` | No | Name of a profile defined in `[profiles.<name>]`. |
| `selection.include` | No | Additional identifiers to install. Default empty. |
| `selection.exclude` | No | Identifiers that must not be installed. Default empty. |
| `profiles.<name>.include` | No | Identifiers selected by this profile. Default empty. |
| `profiles.<name>.exclude` | No | Identifiers removed by this profile. Default empty. |

All identifier arrays MUST contain unique values. Profile names use the same
identifier grammar as skill identifiers. Unknown keys are rejected.

### 4.3 Deterministic selection

Selection is evaluated in this order:

1. Start with the canonical set.
   - If `selection.profile` is present, add every identifier in that profile's
     `include` that exists in the canonical catalogue. An unknown profile
     include fails with `selection.unknown_skill`.
   - Add every identifier in `selection.include` that exists in the canonical
     catalogue. An include that names only an external or package skill is
     validated in step 5 and is already covered by automatic source inclusion.
   - Remove every identifier in the profile's `exclude` and
     `selection.exclude` from the canonical set.
2. Resolve required shared resources for the canonical set.
   - Scan every Markdown file in each selected canonical skill tree for
     relative links to files outside the skill directory. Ignore absolute URLs
     and fenced code blocks.
   - Resolve each link against the pinned commit. It MUST land on a regular
     file under a catalogue-declared `[[shared]]` root. A link outside every
     declared root fails with `shared.outside_root`; a missing file fails with
     `shared.missing`.
   - Collect the required files per shared root, deduplicated and sorted. A
     shared root with no required files is not installed.
   - Shared resources are derived from the selected skills. They are recorded
     under `[[shared]]` in the lock, not in `selection.skills`.
3. Add external Git skills declared in `skills.sources.toml` (Section 5.2)
   unless their identifier is excluded.
4. Add skills advertised by installed-package providers (Section 5.3) unless
   their identifier is excluded.
5. Validate the shared namespace:
   - Every explicitly included or excluded identifier MUST exist in the union
     of all sources before exclusions, or validation fails.
   - Every installed identifier MUST have exactly one owner, or validation
     fails.
6. The final set MUST be non-empty. An empty canonical selection is allowed
   only when at least one external or package skill is installed.
7. Sort identifiers byte-wise, write them to the lock, and write the required
   shared resources under their catalogue-declared paths.

Exclusion always wins over inclusion. There is no implicit default set and no
"install everything" mode. A profile is a named shortcut, not a permission
model: the resolved set is always written to the lock and is reviewable.

External and package skills are installed automatically when their source
declares them, which preserves the existing external-source and package-provider
behaviour. `include` is therefore mainly for canonical skills; including an
external or package identifier is valid but redundant.

### 4.4 Source rules

- Exactly one canonical source is allowed per consumer manifest.
- `source.ref` MUST be immutable: a release tag or a full commit SHA.
  Ordinary installs MUST NOT resolve branches or `latest`.
- A tag MAY be moved by the source repository. A lock pins the commit, so a
  moved tag never changes an existing install. `skills-update` resolves the
  tag again and produces a reviewable lock change.
- If a locked commit is unavailable, install fails with a clear error. It MUST
  NOT fall back to a newer commit or another ref.
- The source repository MUST NOT delete or rewrite release commits referenced
  by a published lock. A tag is a convenience; the commit is the contract.

### 4.5 Reference profiles

Profiles are consumer-defined; the source catalogue does not publish them.
The sets below are review examples, not defaults. They show that a backend
project can select the lifecycle, API, security, observability, and delivery
skills it needs without installing frontend, browser, or accessibility skills.

| Need | Suggested include set |
|---|---|
| Python core (all Python services) | `using-agent-skills`, `spec-driven-development`, `planning-and-task-breakdown`, `incremental-implementation`, `test-driven-development`, `debugging-and-error-recovery`, `code-review-and-quality`, `git-workflow-and-versioning` |
| Python service additions | `api-and-interface-design`, `security-and-hardening`, `observability-and-instrumentation`, `ci-cd-and-automation`, `documentation-and-adrs`, `deprecation-and-migration`, `shipping-and-launch`, `performance-optimization` |
| Dagster pipeline additions | `ci-cd-and-automation`, `observability-and-instrumentation`, `documentation-and-adrs`, `performance-optimization`, `shipping-and-launch` |
| FastAPI service additions | `api-and-interface-design`, `security-and-hardening`, `observability-and-instrumentation`, `ci-cd-and-automation`, `performance-optimization`, `shipping-and-launch` |
| Backend exclusions | `browser-testing-with-devtools`, `frontend-ui-engineering`, `accessibility-engineering` |

A Dagster or FastAPI profile can be expressed as an explicit include list,
either by repeating the relevant rows or by listing the complete resolved set.
Schema `1` has no profile inheritance; inheritance is deferred until a real
consumer needs it.

## 5. Lock file (`skills.lock.toml`)

### 5.1 Complete example

The example below is illustrative; its digests are placeholders. See
[`fixtures/skill-distribution/valid/skills.lock.toml`](fixtures/skill-distribution/valid/skills.lock.toml)
for a minimal fixture whose hashes match the pinned repository commit.

```toml
schema = 1

[manifest]
sha256 = "sha256:0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0"
sources_sha256 = "sha256:1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809"

[[source]]
id = "canonical"
kind = "git"
repository = "kostahuffman/agent-skills"
requested_ref = "v0.6.17"
commit = "8c99fa36d90068c82d547f7c12a9d67a3e95f4ee"
path = "skills"
catalogue_path = "catalogue.toml"

[[source]]
id = "external:polars"
kind = "git"
repository = "https://github.com/polars-inc/skills.git"
requested_ref = "v0.3.0"
commit = "3f4e5d6c7b8a901234567890abcdef1234567890"
path = "polars"
license = "MIT"
content = "files"
files = ["SKILL.md", "references/contexts.md"]

[[source]]
id = "package:python-utils"
kind = "package"
distribution = "python-utils"
version = "1.4.0"
provider = "python_utils.skills:provider"

[selection]
profile = "python-service"
skills = [
  "deprecation-and-migration",
  "polars",
  "python-utils-usage",
  "spec-driven-development",
  "test-driven-development",
  "using-agent-skills",
]

[[shared]]
id = "references"
source = "canonical"
path = "references"
files = ["definition-of-done.md", "security-checklist.md"]
hash = "sha256:0000000000000000000000000000000000000000000000000000000000000000"

[[skill]]
id = "deprecation-and-migration"
source = "canonical"
path = "skills/deprecation-and-migration"
hash = "sha256:0000000000000000000000000000000000000000000000000000000000000000"

[[skill]]
id = "polars"
source = "external:polars"
path = "polars"
hash = "sha256:0000000000000000000000000000000000000000000000000000000000000000"

[[skill]]
id = "python-utils-usage"
source = "package:python-utils"
path = "skills/python-utils-usage"
hash = "sha256:0000000000000000000000000000000000000000000000000000000000000000"

[[skill]]
id = "spec-driven-development"
source = "canonical"
path = "skills/spec-driven-development"
hash = "sha256:0000000000000000000000000000000000000000000000000000000000000000"

[[skill]]
id = "test-driven-development"
source = "canonical"
path = "skills/test-driven-development"
hash = "sha256:0000000000000000000000000000000000000000000000000000000000000000"

[[skill]]
id = "using-agent-skills"
source = "canonical"
path = "skills/using-agent-skills"
hash = "sha256:0000000000000000000000000000000000000000000000000000000000000000"
```

### 5.2 Field reference

Top-level:

| Field | Required | Meaning |
|---|---|---|
| `schema` | Yes | Integer `1`; must match the manifest schema. |
| `[manifest].sha256` | Yes | Hash of the exact `skills.toml` bytes (Section 5.3). |
| `[manifest].sources_sha256` | Conditional | Required when `skills.sources.toml` exists; hash of its exact bytes. |

`[[source]]`:

| Field | Required | Applies to | Meaning |
|---|---|---|---|
| `id` | Yes | All | Stable source identifier. `canonical`, `external:<skill-id>`, or `package:<distribution>`. |
| `kind` | Yes | All | `git` or `package`. |
| `repository` | Yes | `git` | Canonical `owner/name`, or the external HTTPS URL exactly as declared. |
| `requested_ref` | Yes | `git` | Ref requested by the manifest or `skills.sources.toml`. |
| `commit` | Yes | `git` | Full 40-hex commit SHA that was resolved. |
| `path` | Yes | `git` | Repository-relative source path. |
| `catalogue_path` | No | canonical | Repository-relative catalogue path. Default `catalogue.toml`. |
| `license` | Yes | external | License identifier from `skills.sources.toml`. |
| `content` | No | external | `tree` (default) or `files` for a legacy `files` allowlist. |
| `files` | Conditional | external | Required when `content = "files"`; the exact installed file set. |
| `distribution` | Yes | `package` | Installed Python distribution name. |
| `version` | Yes | `package` | Installed distribution version. |
| `provider` | Yes | `package` | Entry-point value that advertised the skill. |

`[selection]`:

| Field | Required | Meaning |
|---|---|---|
| `profile` | No | Profile name used to resolve the canonical set. Omit when no profile was used. |
| `skills` | Yes | Sorted, unique identifiers of every installed skill across all sources. Shared resources are not listed here. |

`[[skill]]`:

| Field | Required | Meaning |
|---|---|---|
| `id` | Yes | Installed skill identifier; unique across the file. |
| `source` | Yes | Matching `[[source]].id`. |
| `path` | Yes | Source-relative POSIX path to the skill directory or content root. |
| `hash` | Yes | `sha256:<64 lowercase hex>` content hash (Section 5.3). |

`[[shared]]`:

| Field | Required | Meaning |
|---|---|---|
| `id` | Yes | Matching catalogue `[[shared]].id`. |
| `source` | Yes | `canonical`. |
| `path` | Yes | Consumer-relative POSIX path of the installed shared root. |
| `files` | Yes | Sorted, unique required files relative to `path`. |
| `hash` | Yes | Content hash of exactly `files` (Section 5.3). |

The lock MUST NOT contain timestamps, hostnames, usernames, absolute paths, or
other machine-specific values. `skills-update` produces the same lock bytes for
the same manifest, sources, and source commits.

### 5.3 Content hash

The content hash reuses the installer's existing `digest()` inputs and content
normalization so external and package hashes remain compatible. The sort order
is specified explicitly below because host path ordering is not portable.

1. Enumerate every regular file under the skill directory (for `content =
   "tree"`), or every file in the declared `files` list (for `content =
   "files"`).
2. Reject symlinks, non-regular files, and paths containing NUL.
3. Sort paths by the raw bytes of their POSIX relative path. Do not use host
   path ordering; Windows and Linux MUST produce the same order.
4. Initialise SHA-256.
5. For each file: update with the POSIX relative path bytes, then `0x00`, then
   the normalized content bytes.
6. Normalize UTF-8 content by replacing CRLF and CR with LF, then encoding as
   UTF-8. Decoding is strict: a file is normalized only when the entire byte
   sequence is valid UTF-8. Non-UTF-8 content is hashed as raw bytes.
7. Encode as `sha256:` followed by lowercase hex.

Empty directories are not hashed. File modes and executable bits are not
hashed; installers MUST NOT rely on them and SHOULD invoke scripts through an
interpreter. The `.skills-managed` marker is installer metadata and MUST be
excluded from the hash. A source tree containing a `.skills-managed` file is
invalid.

The digest of `skills.toml` and `skills.sources.toml` uses the same
line-ending normalization, but the entire file is the content set.

A `[[shared]]` hash uses the same algorithm over exactly its `files` list, with
paths relative to the shared root's `path`. The `.skills-managed` marker is
installer metadata and is excluded.

### 5.4 Lifecycle

- `skills-install` reads `skills.toml` and `skills.lock.toml`, verifies the
  manifest hash, source declarations, selection, and commit, fetches exactly
  the locked commit, and writes only the selected skills and required shared
  resources. It NEVER resolves a tag or branch.
- `skills-check` is read-only and works offline. It verifies the lock against
  the manifest and sources, every installed skill file and shared resource
  against its hash, all generated adapters, package provider versions, and the
  absence of stale managed directories. It never contacts the network.
- `skills-update` is the only operation that resolves refs and mutates tracked
  metadata. It requires network access, resolves tags to commits, recomputes
  selection, required shared resources, and hashes, writes the lock, and is
  expected to produce a reviewable PR containing only manifest/lock/sources
  changes. It MUST NOT commit installed skill or shared resource content.
- `skills-sync` MAY remain as an alias for `skills-install` for existing
  templates, but the canonical command names are `skills-install`,
  `skills-check`, and `skills-update`.

A lock is stale when any of the following is true; the specified check MUST
fail rather than repair the lock implicitly:

- `skills.toml` or `skills.sources.toml` bytes changed but the lock hashes did
  not.
- The manifest `source` block differs from the lock's canonical source.
- The manifest `ref` differs from `requested_ref`.
- The manifest profile or include/exclude set resolves to a different selection.
- A selected skill is missing from the locked commit.
- A selected skill's content hash differs from the lock.
- A selected skill's required shared file set differs from the lock.
- A required shared resource is missing, or its content hash differs.
- A resolve commit is not a full SHA.
- Two installed sources own the same identifier.
- A package skill's distribution, version, provider, or content hash differs.

## 6. Source composition and collisions

### 6.1 Source classes

| Source class | Declared by | Selection | Lock source id |
|---|---|---|---|
| Canonical | `skills.toml` | Profile/include/exclude | `canonical` |
| External Git | `skills.sources.toml` | Automatic, opt-out via exclude | `external:<skill-id>` |
| Installed package | Provider entry point in the Pixi environment | Automatic, opt-out via exclude | `package:<distribution>` |

Canonical shared resources are part of the canonical source; they are not a
fourth source class and are not listed in `selection.skills`.

All three classes share one global identifier namespace. There is no
precedence order: an identifier MUST have exactly one owner among the installed
set. If two sources advertise the same identifier and it is installed,
validation fails with both source names. To resolve it, exclude the identifier
or remove one source declaration. An excluded duplicate is not installed and
does not cause a collision.

### 6.2 Existing external sources

External Git declarations live in a tracked `skills.sources.toml` at the
project root. Their existing shape is preserved:

```toml
[skills.polars]
kind = "external"
repository = "https://github.com/polars-inc/skills.git"
path = "polars"
ref = "main"
resolved_commit = "<full 40-hex SHA>"
license = "MIT"
update = "python scripts/skills.py sync polars"
files = ["SKILL.md", "references/contexts.md"]
```

The legacy `skills/sources.toml` path sits inside the ignored `skills/` root,
so it cannot remain tracked in a compliant consumer. During migration an
implementation MAY read it, but `skills-check` MUST fail with
`config.legacy_sources_path` while it is present. Moving the file to
`skills.sources.toml` preserves every field.

Requirements:

- `kind` MUST be `external`.
- `repository` MUST be HTTPS without credentials. GitHub repositories are
  trusted by default; other hosts require an explicit installer allowlist.
- `ref` is the requested ref. A branch name is allowed here only as input to
  explicit `skills-update` resolution; it is never followed by an ordinary
  install. `resolved_commit` MUST become a full 40-hex SHA once a lock exists;
  the old habit of leaving `main` in this field is invalid.
- `license` and `update` are required for provenance.
- `files` is a legacy allowlist. When present, the lock records
  `content = "files"` and hashes exactly that set. When absent, the content
  set is the full skill directory tree. New sources SHOULD use full trees so
  `references/` and `scripts/` cannot be silently omitted.
- External identifiers participate in duplicate-ownership checks.

### 6.3 Package-provided skills

This section defines compatibility with
[python-gh-workflows#34](https://github.com/kostahuffman/python-gh-workflows/issues/34)
and [#98](https://github.com/kostahuffman/python-gh-workflows/issues/98)
without introducing a second skill manager.

- A provider is discovered from the installed Pixi/Python environment through
  the `repo_skills` entry-point group. The provider supplies at least `name`,
  `distribution`, `distribution_version`, `skill_version`, and a resource root
  (or an equivalent `Traversable`).
- Package skills are installed automatically when a provider is present. The
  `selection.exclude` list can opt out of a specific identifier.
- The installer validates provider roots, rejects path traversal and symlinks,
  and recomputes the content hash. It MUST NOT execute skill scripts.
- Loading a provider entry point executes installed package code. That is a
  trust boundary inherited from the Pixi environment and `pixi.lock`, not from
  the skill repository. Implementations SHOULD prefer a metadata-only provider
  where the runtime supports it and MUST document the residual risk.
- Reproducibility is split: `pixi.lock` pins the distribution, and
  `skills.lock.toml` pins the installed distribution version, provider name,
  and skill content hash. An editable install whose content changes without a
  version change is detected as a hash mismatch.
- Removing a dependency removes its provider. `skills-check` then fails because
  the lock still expects the skill; `skills-update` removes the entry and the
  installer removes the stale managed directory.
- `python-utils` owns `python-utils-usage` at
  `skills/python-utils-usage/SKILL.md`. A consumer MUST choose one delivery
  mechanism for that identifier: the package provider (preferred once #34 is
  available) or the external Git source from #98. Declaring both is a
  duplicate-ownership error.

## 7. Installation roots and Git ignore semantics

The installer owns these roots:

```text
skills/
.agents/skills/
.claude/skills/
references/
agents/
```

`references/` and `agents/` are examples of catalogue-declared shared roots.
The installer owns only the shared roots that appear in the lock; a shared root
with no required files is not created.

Required consumer `.gitignore` entries:

```gitignore
/skills/
/.agents/skills/
/.claude/skills/
/references/
/agents/
```

Add only the shared-root entries that appear in `[[shared]]` in the lock.

Rules:

- `skills/<id>/` holds the canonical selected content, including
  `references/` and `scripts/` inside the skill directory.
- `references/<path>` and `agents/<path>` hold the required shared files at
  the same repository-relative paths, preserving the links in the selected
  skills. They are generated content, not a full copy of the source roots.
- `.agents/skills/<id>/SKILL.md` and `.claude/skills/<id>/SKILL.md` are thin,
  deterministic discovery adapters. They carry the skill frontmatter and point
  at `../../../skills/<id>/SKILL.md`; they do not duplicate full skill bodies.
- Every generated skill directory and shared root contains a `.skills-managed`
  marker. The installer MUST only replace or remove a directory that contains
  this marker. If a selected identifier or shared root already exists without
  the marker, install fails with `install.owned_conflict` and instructs the
  user to move it. This preserves unrelated skills that a developer may keep
  in `.claude/skills/`, `.agents/skills/`, `references/`, or `agents/`.
- The installer MUST NOT modify tracked files. `AGENTS.md`, `CLAUDE.md`, and
  other project configuration remain project-owned. After `skills-install`,
  `git status` MUST be clean because all generated content is ignored.
- Existing consumers with tracked skill content or tracked files under a
  shared root MUST untrack them in a dedicated migration PR, or avoid selecting
  skills that require the shared root. Adding ignore rules does not remove
  files already in the Git index. A tracked `skills/sources.toml` MUST move to
  `skills.sources.toml` in the same PR.
- Project-owned skill guidance, references, and personas belong outside the
  managed roots. If a project already uses `references/` or `agents/`, move
  that content or choose a shared root that does not collide.

## 8. Trusted-source and path safety

Installation is a supply-chain operation. Implementations MUST:

- Fetch only from the declared repository and only at the locked full commit
  SHA. Fetching a tag, branch, or short SHA is not an install operation.
- Verify every fetched skill's and shared resource's content hash before
  writing.
- Reject absolute paths, `..` segments, backslashes, drive letters, NUL bytes,
  empty segments, trailing dots/spaces, Windows reserved names (`CON`, `PRN`,
  `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9`), and case-insensitive collisions.
- Reject symlinks and non-regular files in selected skill trees and shared
  resource roots.
- Never execute fetched skill scripts, hooks, or package installation scripts
  during discovery, install, or check. Skill scripts are copied as content.
- Never write outside the generated skill roots and the catalogue-declared
  shared roots.
- Not forward credentials or embed tokens in URLs. Canonical sources use
  `owner/name`; external sources use credential-free HTTPS URLs.
- Prefer a cache keyed by commit SHA plus content hash. A cache hit MUST be
  re-verified before use.

## 9. Schema validation expectations

Validators are strict. Unknown keys, wrong types, unsupported schema versions,
and duplicate keys are errors, not ignored fields. Any new field requires a
schema version bump.

| Area | Rule | Error class |
|---|---|---|
| TOML | File parses and has no duplicate keys | `config.invalid_toml` |
| Schema | `schema = 1` and manifest/lock agree | `config.unsupported_schema` |
| Keys | No unknown keys in any table | `config.unknown_key` |
| Identifiers | Grammar, length, frontmatter match | `config.invalid_id` |
| Identifiers | Case-insensitive uniqueness | `config.duplicate_id` |
| Repository | `owner/name`, no URL or credentials | `config.invalid_repository` |
| Ref | Release tag or full 40-hex SHA | `config.invalid_ref` |
| Paths | Safe relative POSIX path, inside the allowed root | `config.unsafe_path` |
| Shared root | Shared path overlaps `skills/`, another shared path, or contains traversal | `config.unsafe_path` |
| Shared root | Shared id/path duplicates another entry | `config.duplicate_id` |
| Shared link | Selected skill link escapes declared shared roots | `shared.outside_root` |
| Shared link | Required shared file is missing at the pinned commit | `shared.missing` |
| Legacy path | Tracked `skills/sources.toml` not yet migrated | `config.legacy_sources_path` |
| Selection | Final set non-empty | `selection.empty` |
| Selection | Include/exclude identifiers exist | `selection.unknown_skill` |
| Selection | Include/exclude arrays have no duplicates | `selection.duplicate_entry` |
| Lock | Manifest hash matches | `lock.stale_manifest` |
| Lock | Sources hash matches | `lock.stale_sources` |
| Lock | Requested ref matches manifest/sources | `lock.ref_drift` |
| Lock | Repository/path/profile matches | `lock.source_drift` |
| Lock | Selection matches resolved selection | `lock.selection_drift` |
| Lock | Commit is a full 40-hex SHA | `lock.invalid_commit` |
| Lock | Skill content hash matches | `lock.hash_mismatch` |
| Lock | Shared file set or content hash matches | `lock.shared_drift` |
| Lock | No stale managed directories | `lock.stale_install` |
| Source | One owner per installed identifier | `source.duplicate_owner` |
| Source | Repository is trusted | `source.untrusted` |
| Source | No symlinks, traversal, or reserved files | `source.unsafe_content` |
| Install | Existing unmarked directory would be replaced | `install.owned_conflict` |
| Package | Provider/version/hash mismatch | `package.provider_drift` |

Errors MUST name the file, the identifier or source when applicable, and a
remediation command (usually `skills-update` or `skills-install`). Exit status
is non-zero.

## 10. Validation fixtures

Fixtures live under [`fixtures/skill-distribution/`](fixtures/skill-distribution/):

| Fixture | Expected result |
|---|---|
| [`valid/skills.toml`](fixtures/skill-distribution/valid/skills.toml) | Valid manifest; pins a frozen fixture revision containing `catalogue.toml` and selects three canonical skills using a profile plus a top-level include. |
| [`valid/skills.lock.toml`](fixtures/skill-distribution/valid/skills.lock.toml) | Valid lock matching the valid manifest, the pinned fixture revision's content hashes, and the shared references required by the selected skills. |
| [`invalid/missing-skill.toml`](fixtures/skill-distribution/invalid/missing-skill.toml) | `selection.unknown_skill`: the profile names a skill absent from the catalogue. |
| [`invalid/duplicate-name-catalogue.toml`](fixtures/skill-distribution/invalid/duplicate-name-catalogue.toml) | `config.duplicate_id`: the same identifier appears twice. |
| [`invalid/ref-drift.lock.toml`](fixtures/skill-distribution/invalid/ref-drift.lock.toml) | `lock.ref_drift` when paired with `valid/skills.toml`: the lock requests a different ref. |

The valid fixture pins `86e73f54d828da12ee337ffca28fcbf94355bc50`, a frozen
historical revision kept reachable by the `fixture/skill-distribution-v1` tag.
The fixture is intentionally independent of the current catalogue: the resolver
validates `catalogue.toml` from the working tree separately, then reads the
pinned catalogue, selected skills, and shared resources from the pinned
revision with `git cat-file` and `git show`. New catalogue entries do not
require re-pinning this fixture. Regenerate its lock hashes only when the
selected fixture content changes. Checkouts used to run the resolver MUST make
the pinned revision available, for example by fetching tags; a shallow clone
that omits it fails with an actionable message.

The valid lock's `manifest.sha256`, skill `hash` values, and `[[shared]]` hash
are recomputed from the pinned revision. Regenerate them if the selected skills
or required shared files change. Installer tests SHOULD copy the fixtures and
assert the error class and exit status rather than the exact message text.

The fixture resolver is `node scripts/validate-skill-distribution-fixtures.js`.
It validates the current catalogue from the working tree, resolves the valid
fixture against the frozen pinned revision, checks the shared reference set and
hashes, and confirms the intended error condition in each invalid fixture.

## 11. Compatibility and migration

- Existing `skills.py` architecture is extended, not replaced. Its adapter
  format and `digest()` semantics are preserved.
- Existing external-source declarations remain valid, but the tracked
  `skills/sources.toml` file must move to `skills.sources.toml` because
  `skills/` is now ignored. The lock is authoritative.
- Existing consumers keep their tracked skills until a migration PR untracks
  them, including moving `skills/sources.toml`. The contract does not migrate
  content. Consumers with tracked files under a catalogue-declared shared root
  must move or untrack them before installing a skill that requires that root.
  Shared roots are top-level paths such as `references/` and `agents/`, so
  treating them as managed install roots is a deliberate ownership trade-off.
  The installer MUST only write inside roots marked `.skills-managed` and MUST
  NOT delete or overwrite unmarked files. Downstream installer work MUST
  confirm this trade-off before enabling automatic shared-root ignores.
- Newly vended projects ship `skills.toml`, `skills.lock.toml`,
  `skills.sources.toml` when external sources are used, the installer entry
  point, agent guidance, and the ignore rules for the skill roots and the
  shared roots in their lock. They do not ship skill or shared resource
  content.
- `skills-update` PRs change tracked metadata, not installed files. If a PR
  includes installed skill or shared resource content, it violates this
  contract.

## 12. Review decisions to confirm

Architecture review must explicitly accept or change these decisions before B1
depends on them:

1. `catalogue.toml` is the source-side ownership index, and release commits pin
   it alongside `skills/`.
2. Profiles are consumer-defined; the source catalogue does not publish
   profiles.
3. Canonical skills are opt-in; external and package skills are automatic with
   explicit exclude.
4. Duplicate identifiers are hard errors when installed; there is no
   canonical-wins precedence.
5. A per-directory `.skills-managed` marker is the ownership boundary for safe
   replacement, rather than owning whole install roots.
6. Validation is strict; unknown keys require a schema bump.
7. Schema `1` has no aliases; renames require compatibility directories or a
   future schema migration.
8. The content hash matches the existing `digest()` algorithm, with a
   portable byte-order path sort.
9. Shared resources are discovered from selected canonical skill links,
   restricted to catalogue-declared roots, installed at the same
   repository-relative paths, and hashed in the lock.

## 13. Verification

Before accepting this contract:

- [ ] The catalogue lists every current skill exactly once and every
      `SKILL.md` frontmatter name matches.
- [ ] Every catalogue-declared shared root exists in the current repository and
      at the pinned fixture revision, and shared identifiers and paths are
      unique and non-overlapping.
- [ ] The current catalogue is validated separately from the pinned fixture
      revision, so adding catalogue entries does not invalidate the fixture.
- [ ] The valid manifest resolves to exactly the selected identifiers in the
      valid lock, with no duplicates.
- [ ] The valid lock's manifest hash matches `valid/skills.toml`, and every
      skill hash matches the pinned fixture revision's content, not the PR
      checkout.
- [ ] The pinned fixture revision contains `catalogue.toml` and every selected
      skill and required shared file.
- [ ] The valid lock's `[[shared]]` entry matches the shared references
      discovered from the selected skills, including the exact file set and
      hash.
- [ ] The missing-skill fixture fails with `selection.unknown_skill`, the
      duplicate-name fixture with `config.duplicate_id`, and the ref-drift
      fixture with `lock.ref_drift`.
- [ ] All fixture TOML files parse.
- [ ] `node scripts/validate-skill-distribution-fixtures.js` passes.
- [ ] The contract is reviewed against Python, Dagster, and FastAPI needs:
      non-frontend skills are selectable without installing UI or browser
      skills, and API/security/observability skills are available.
- [ ] No installer, Copier template, or installed skill content is changed by
      this contract change.
- [ ] Repository documentation checks pass.
