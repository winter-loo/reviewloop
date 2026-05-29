# LTSQL Online Local Code Review Platform PRD

**Created:** 2026-05-29 10:58 CST  
**Owner:** Winter Loo / LTSQL local development workflow  
**Working name:** `ltsql-review`  
**Status:** Draft v0.1 / ready for MVP implementation

---

## 1. Problem Statement

LTSQL development currently relies on local worktrees and an SVN-like shared integration flow. Because there is effectively only one shared branch/mainline, pushing or committing unfinished changes just to enable peer review is risky: a bad push can break the shared codebase and disrupt other developers.

Developers need a PR-like review workflow for **local worktree diffs** without requiring a remote branch or shared-mainline commit.

The platform must provide a safe intermediate layer:

```text
local LTSQL worktree changes
  -> publish read-only review snapshot online
  -> reviewers inspect/comment in browser
  -> developer/agent fixes local worktree
  -> only then commit/push through existing LTSQL gates
```

Publishing a review must not mutate the source worktree, commit code, push code, or run arbitrary commands.

---

## 2. Goals

### Primary goals

1. Publish local LTSQL worktree / commit / range diffs as online review pages.
2. Allow other developers to view file diffs in browser without accessing the server filesystem directly.
3. Support inline review comments anchored to file + old/new line/range.
4. Persist review snapshots and comments independently of Hunk live TUI sessions.
5. Let the agent read comments and act on them in the real local worktree.
6. Preserve the safety boundary: online review is read-only with respect to source worktrees.

### Secondary goals

1. Integrate with `ltsql-hunk` because it already works for local TUI review and exposes structured session/comment APIs.
2. Allow import/export between Hunk live notes and the online platform.
3. Track review lifecycle: draft, in review, changes requested, approved, superseded, closed.
4. Show useful metadata: repo root, range/ref, base/head revision, author, publish time, diff stats, test status.
5. Support republishing after fixes while keeping old review versions.

---

## 3. Non-goals for MVP

1. No direct SVN/Git push, commit, or merge from the web UI.
2. No arbitrary filesystem browsing.
3. No arbitrary command execution from browser.
4. No full GitHub/GitLab clone.
5. No complex permissions model in v0; start with private server / trusted users, then harden.
6. No requirement to serve live Hunk TUI in browser.

---

## 4. Target Users

### Author / developer

- Has one or more LTSQL local worktrees on server.
- Wants to publish a local diff for review before committing/pushing.
- Wants review comments to be actionable by the agent.

### Reviewer

- Opens an online URL.
- Reviews files and diff hunks.
- Adds inline comments and general comments.
- Does not need shell access to the server.

### Agent

- Reads durable review comments via API/files.
- Maps comments back to real worktree files.
- Applies code/test fixes locally after explicit instruction.
- Verifies diff/status before claiming changes.

---

## 5. Core Concepts

### Review

A review is a durable, read-only snapshot of a local diff plus persisted comments.

Example:

```json
{
  "id": "CR-20260529-0001",
  "title": "procedure datatype expected output update",
  "repoRoot": "/data/ludd50155/ltsql_branches/T202604293474-procedure-datatype",
  "sourceKind": "range",
  "sourceRef": "HEAD~4...HEAD",
  "baseCommit": "...",
  "headCommit": "...",
  "status": "in_review",
  "createdBy": "ludd50155",
  "createdAt": "2026-05-29T10:58:14+08:00"
}
```

### Review version

A review can have multiple versions. Republish creates a new snapshot version while keeping comment history.

```text
CR-0001 v1: initial diff
CR-0001 v2: after fixes
CR-0001 v3: final confirmation
```

### Comment

A comment is anchored to a review version and optionally to a file/line/range.

```json
{
  "id": "comment-001",
  "reviewId": "CR-20260529-0001",
  "version": 1,
  "filePath": "unisql/.../expected.out",
  "side": "new",
  "line": 258,
  "body": "为什么要把 sys_refcursor 改成 refcursor",
  "author": "winterloo",
  "status": "open",
  "createdAt": "2026-05-29T10:59:00+08:00"
}
```

---

## 6. Hunk Integration Strategy

Use Hunk as a local review/diff engine and compatibility layer, not as the sole online platform.

### Reuse Hunk for

- Local TUI review: `~/bin/ltsql-hunk-review`
- Range review: `~/bin/ltsql-hunk diff 'HEAD~4...HEAD'`
- Commit review: `~/bin/ltsql-hunk show HEAD`
- Reading live Hunk notes:

```bash
~/bin/ltsql-hunk session comment list --repo <git-root> --type user --json
```

### Platform persistence requirement

Hunk notes are live-session state. Therefore the web platform must persist comments itself, e.g. in SQLite and artifact files.

### Import from Hunk

Command:

```bash
ltsql-review import-hunk-notes --review CR-20260529-0001 --repo <git-root>
```

Internally reads Hunk notes and stores them as platform comments.

---

## 7. MVP User Flows

### Flow A: Publish current worktree diff

```bash
cd /data/ludd50155/ltsql_branches/T202604293474-procedure-datatype/unisql
ltsql-review publish --type worktree --title "procedure datatype local changes"
```

Output:

```text
Created review CR-20260529-0001
URL: http://<server>:<port>/reviews/CR-20260529-0001
```

### Flow B: Publish commit range

```bash
ltsql-review publish \
  --repo /data/ludd50155/ltsql_branches/T202604293474-procedure-datatype \
  --range 'HEAD~4...HEAD' \
  --title "procedure datatype range review"
```

### Flow C: Reviewer comments online

1. Open review URL.
2. Select file.
3. Click line/hunk.
4. Add comment.
5. Submit.

### Flow D: Agent reads comments

```bash
ltsql-review comments --review CR-20260529-0001 --json
```

Agent maps comments to repo-relative paths and fixes local worktree after explicit instruction.

### Flow E: Republish after fixes

```bash
ltsql-review publish --review CR-20260529-0001 --update
```

Creates a new version while keeping previous comments.

---

## 8. Functional Requirements

### CLI

- `ltsql-review publish`
  - Detect Git root from cwd or accept `--repo`.
  - Accept `--type worktree`, `--staged`, `--show <ref>`, `--range <range>`.
  - Capture metadata, diff patch, file stats.
  - Create durable review/version artifacts.
  - Print review URL.

- `ltsql-review list`
  - List reviews with status, title, repo, source, updated time.

- `ltsql-review comments --review <id> --json`
  - Print durable platform comments.

- `ltsql-review import-hunk-notes --review <id> --repo <git-root>`
  - Import live Hunk user notes into durable platform storage.

### Web UI

- Review list page.
- Review detail page.
- File tree/list with status and stats.
- Unified diff rendering for MVP.
- Inline comment creation and display.
- General review comments.
- Status labels.

### Backend/API

- `GET /api/reviews`
- `GET /api/reviews/:id`
- `GET /api/reviews/:id/versions/:version/files`
- `GET /api/reviews/:id/versions/:version/diff`
- `GET /api/reviews/:id/comments`
- `POST /api/reviews/:id/comments`
- `PATCH /api/comments/:id`

---

## 9. Data Storage MVP

Use SQLite + artifact files.

```text
~/.ltsql-review/
  reviews.db
  artifacts/
    CR-20260529-0001/
      v1/
        metadata.json
        diff.patch
        files.json
```

SQLite tables:

- `reviews`
- `review_versions`
- `comments`
- `events`

---

## 10. Security Requirements

1. Published reviews expose snapshots only, not arbitrary filesystem access.
2. API must never accept arbitrary shell commands.
3. Repo paths must be explicitly published by local CLI.
4. Web comments must not mutate source files.
5. Diff capture should redact obvious secrets in future versions.
6. Paths displayed in UI should be repo-relative.
7. For v0 deployment, bind to private/internal network or localhost behind SSH tunnel until auth exists.

---

## 11. Technical Recommendation

### MVP stack

- SvelteKit / Svelte 5 frontend.
- Node/Bun backend.
- SQLite storage.
- Git CLI for patch generation.
- Hunk CLI/session APIs for local note import/export.

### Why not only Hunk

Hunk is excellent for local TUI review and agent-friendly live sessions, but online collaboration needs durable review records, browser UI, and persistent comments. Therefore Hunk should be an engine/integration point, not the only source of truth.

---

## 12. Success Criteria

MVP is successful when:

1. A local LTSQL worktree diff can be published without committing/pushing.
2. Another user can open a URL and read the diff.
3. Another user can add at least one inline comment.
4. The agent can read that comment from durable storage.
5. The author can republish after fixes.
6. No source worktree mutation occurs from viewing/commenting online.

---

## 13. Open Questions

1. Initial auth model: private LAN only, password, or corporate SSO later?
2. Preferred public/internal port and reverse proxy location?
3. Should review artifacts be under user home (`~/.ltsql-review`) or a shared project directory?
4. How many reviewers/users in v0?
5. Should comments support resolve/reopen in MVP or v1?
6. Should the platform support binary/generated expected files with special rendering?
