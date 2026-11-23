# GitHub Issue and PR Contract

Use this contract when a project records work in GitHub Issues and pull requests. It defines the metadata and body fields that make an issue executable and a PR reviewable.

Decomposition rules live in `planning-and-task-breakdown`; commit, branch, and release rules live in `git-workflow-and-versioning`. This reference adds only the GitHub-specific contract. It does not replace either skill, and it does not create a second planning process.

## When to Use

- The project's agent rules or the user designate GitHub Issues as the task list.
- You are creating, splitting, or refining an issue.
- You are opening, reviewing, or updating a pull request.
- An issue is too large, lacks acceptance criteria, or has no verification.
- A PR needs an issue link, labels, or verification evidence.

## Issue Contract

### Title

Use a short, imperative summary. If the repository uses area prefixes such as `[NATS]` or `[API]`, keep them. Do not use conventional-commit types such as `feat:` on an issue title; those belong on commits and PR titles.

### Metadata

| Field | Rule |
|---|---|
| Labels | At least one type label (`feature`, `bug`, `docs`, etc. per the repository taxonomy), plus area labels. A child issue inherits the parent's area labels unless there is a stated reason to differ. |
| Parent | A child issue includes `Parent: #N`. A parent issue lists its children or uses GitHub sub-issues. |
| Size | `S` = one focused session and roughly one file; `M` = up to about five files; `L`/`XL` = split before implementation. |
| Task-list target | Use GitHub Issues or `tasks/todo.md`, not both. If GitHub Issues is selected, it is the task list; the plan document stays an ordered index. |

A tracking issue may be `L` when it exists only to group child issues. Executable issues are `S` or `M`; do not implement a tracking issue directly.

### Body

Required sections, in this order:

```markdown
## Goal
[One or two sentences: the outcome and why it matters.]

## Scope
- [What this issue includes.]

## Out of scope
- [Adjacent work that is explicitly excluded. Write "None" if there is none.]

## Acceptance criteria
- [ ] [Observable behavior, with the evidence that proves it.]
- [ ] [Keep this to one to three independently verifiable checks.]

## Verification
- [ ] `[command]` — [expected result or evidence.]
- [ ] [If a check cannot run, say why and what remains unverified.]

## Dependencies
- [Blocking issue, PR, or external prerequisite. Write "None" if there is none.]

## Likely files
- [Path or module expected to change. This is a forecast, not a guarantee.]
```

Optional sections: `## Risks`, `## Open questions`, `## Child issues` on a tracking issue.

Acceptance criteria answer "what must be true?" Verification answers "how do we prove it?" Do not collapse them into one checklist.

Checkpoints belong in the plan document or in a checkpoint issue. Do not create a second copy of the task list in `tasks/todo.md` when GitHub Issues is the selected target.

## PR Contract

### Title

Use a conventional title:

```
<type>: <imperative summary>
<type>(<scope>): <imperative summary>
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `ci`, `build`.

Do not put an issue number in the title. The issue link belongs on the first line of the body.

### First Body Line

The first nonblank line of the PR body is exactly one of:

- `Closes #N` — this PR completes issue `N`.
- `Refs #N` — this PR makes progress but does not complete issue `N`.

No heading before it. No trailing period. If more than one issue is involved, put each `Closes`/`Refs` line before the first heading; the first nonblank line still names the primary issue.

### Body

Required sections:

```markdown
Closes #N

## Summary
[What changed, why, and any user-visible behavior.]

## Verification
- `[command]` — [result, including counts or pass/fail.]
- [Skipped or incomplete check: which test, why it did not run, and what remains unverified.]
```

Optional sections: `## Changes`, `## Risks / Rollback`, `## Screenshots`, `## Follow-ups`.

### Labels

Copy the linked issue's labels to the PR. Add PR-specific labels only when the repository taxonomy requires them. Never leave a PR unlabeled when its issue has labels.

### Verification Evidence

Include the command and a concise result, not a claim. State skipped tests explicitly and say what remains unverified. "All tests pass" without a command or result is not evidence.

### Size

Target roughly 100 changed lines per PR. Split changes over roughly 1,000 lines. Keep one logical change per PR; move out-of-scope work to a follow-up issue.

## Fixed Example: python-utils#78 / #87

This example is the acceptance case for this contract. Issue #78 bundles an extraction, configuration, a test server, migration notes, and CI work. PR #87 implements the extraction.

### Original Issue #78

Passes:

- Descriptive title with the `[NATS]` area prefix.
- Labels `feature` and `module: nats`.
- A goal, an out-of-scope list, and an acceptance checklist covering tests, docs, CI, and acceptance.

Fails:

- `L`/`XL` bundle. It is not split into executable child issues.
- The out-of-scope list is buried at the end instead of appearing near the scope.
- No `## Verification` section with commands and evidence.
- No `## Dependencies` section; related work is only mentioned inline.
- No `## Likely files` section; modules are named, but paths are not forecast.
- No parent/child decomposition or size labels.

Correct the issue by turning it into a tracking issue with `S`/`M` children. Example child:

```markdown
Title: [NATS] Add NatsClient and typed server config
Labels: feature, module: nats, size:M
Parent: #78

## Goal
Provide a reusable async NATS client and a typed server configuration so
services stop copying connection and JetStream setup.

## Scope
- Add `src/python_utils/nats.py` with an async `NatsClient`.
- Add a typed `NatsClientConfig` to `src/python_utils/config.py`.

## Out of scope
- Migrating existing task services.
- Docker/JetStream integration harness changes.

## Acceptance criteria
- [ ] `NatsClient` connects, publishes, and drains without leaking connections.
- [ ] `NatsClientConfig` validates URLs, credentials, and stream settings.
- [ ] Existing behavior in `nats_task_client.py` remains available until migration.

## Verification
- [ ] `pytest tests/unit/test_nats.py tests/unit/test_config.py -q` — passes.
- [ ] `ruff check src/python_utils/nats.py src/python_utils/config.py` — passes.
- [ ] Docker-backed JetStream tests — run in CI; note locally skipped checks explicitly.

## Dependencies
- None.

## Likely files
- `src/python_utils/nats.py`
- `src/python_utils/config.py`
- `tests/unit/test_nats.py`
```

The tracking issue's acceptance criteria should be the child issues being closed, with the child links listed under `## Child issues`. A tracking issue is not implementation work.

Assume this child is #79. The PR that implements it uses `Closes #79`; the parent #78 closes only when all of its child issues are closed.

### Original PR #87

Passes:

- Conventional `feat:` title type.
- `## Summary` and `## Verification` sections.
- Verification includes commands, a test count, and an explicit statement that Docker-backed tests were skipped locally.

Fails:

- Title includes `(#78)`. Remove the issue reference from the title.
- `Closes #78.` is the last line of the body. Move it to the first nonblank line and drop the trailing period.
- After the split, the same PR must close the executable child (#79), not the tracking issue (#78).
- Labels are empty even though issue #78 has `feature` and `module: nats`.

### Corrected PR

Metadata:

```text
Title: feat: extract generic NatsClient with typed config and test factory
Labels: feature, module: nats
Base: main
```

Body:

```markdown
Closes #79

## Summary
Extracts a reusable async `NatsClient` from `nats_task_client.py` and adds a
typed `NatsClientConfig` plus a `NatsTestServer.client_config` factory, as
child #79 of the #78 tracking issue. Existing task-backed behavior remains
available while services migrate.

## Verification
- `pytest tests/unit/test_nats.py tests/unit/test_config.py -q` — 172 passed, 1 skipped.
- `ruff check src/python_utils/nats.py src/python_utils/config.py src/python_utils/test_utils/nats.py tests/unit/test_nats.py tests/unit/test_config.py` — passed.
- `mypy src/python_utils/nats.py src/python_utils/config.py src/python_utils/test_utils/nats.py` — passed.
- Docker-backed JetStream tests skipped locally: Docker is unavailable in this
  environment. CI runs them; treat the PR as unverified for that path until CI is green.
```

## Checklist

Before creating or updating an issue:

- [ ] Title is an imperative summary with the repository's area prefix, if any.
- [ ] Goal, Scope, Out of scope, Acceptance criteria, Verification, Dependencies, and Likely files are present.
- [ ] Executable issue is `S` or `M`; `L`/`XL` is split into child issues.
- [ ] Child issues include `Parent: #N`; the parent lists its children.
- [ ] Labels include a type and area; children inherit the parent's area labels.
- [ ] GitHub Issues is the only task-list target, or `tasks/todo.md` is the only target.

Before opening or updating a PR:

- [ ] Title is conventional, imperative, and has no issue number.
- [ ] First nonblank body line is `Closes #N` or `Refs #N`, with no trailing period.
- [ ] The `Closes`/`Refs` line targets the executable issue, not a tracking issue.
- [ ] PR labels match the linked issue.
- [ ] `## Summary` and `## Verification` are present.
- [ ] Verification includes commands and results, plus explicit skipped or incomplete checks.
- [ ] Out-of-scope work is a follow-up issue, not hidden in the PR.
