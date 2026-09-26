# CLAUDE.md — D-Trace

Working agreement for Claude Code (and any other agent or developer) in this repository.
Read this before writing code. If a change contradicts something here, update this file in the same commit.

---

## 1. What this project is

**D-Trace** is a traceability platform: accounts, roles, and an **append-only audit trail** of every
**row change** — every insert, update and delete, with the fields that moved. It is a monorepo with three workspaces.

| Workspace | Path | Stack | Role |
|---|---|---|---|
| `@dtrace/web` | `apps/web` | Next.js 16 (App Router, Turbopack), React 19, Tailwind 4 | UI **and** BFF. The only thing the browser talks to. |
| `@dtrace/api` | `apps/api` | NestJS 12 (ESM), Prisma 7, PostgreSQL 17 | The authority. Owns data, auth, and authorization. |
| `@dtrace/shared` | `packages/shared` | TypeScript + Zod 4 | The contract between them. No runtime dependencies. |

Ports: web `3000`, API `4000`, Postgres `5432`. API routes are prefixed `/api/v1`.

---

## 2. The flow — memorize this

### 2.1 Where a request goes

```
Browser ──▶ Next.js (apps/web) ──▶ NestJS (apps/api) ──▶ PostgreSQL
           ▲ holds the tokens     ▲ verifies every request
           │ in httpOnly cookies  │ (guards run before handlers)
           └── the browser never sees a token, and never calls the API directly
```

Two ways the web app reaches the API, and **there is no third**:

1. **Server components** → `apiFetch()` in `apps/web/src/lib/api/server.ts`. Reads the access token
   from the cookie jar and calls the API directly. Used for the initial render of a page.
2. **Client components** → `clientFetch()` in `apps/web/src/lib/api/client.ts` → `/api/bff/[...path]`
   → API. The proxy attaches the token server-side. Used for interactions after render.

Credential endpoints (`/api/auth/login|register|logout`) are separate route handlers, because they
are the only places that mint or clear session cookies.

**There is exactly one exception to "the browser never calls the API": the notification socket.**
A WebSocket cannot carry an `Authorization` header the way a fetch can, and the browser has no
token to put in one anyway. So the BFF mints a **one-shot ticket** — `POST /api/socket-ticket`,
authenticated server-side — and the browser presents only that in the Socket.IO handshake. A
ticket is opaque, expires in 60 seconds, is destroyed the moment it is redeemed, and grants
nothing over HTTP; the worst a leaked one buys is a single subscription to notifications its
holder could already read. The socket is **receive-only**: the gateway defines no message handler,
so there is nothing to send *to*. Rule 6 still holds — no token reaches the browser.

Tickets live in memory (`SocketTicketService`). They are worth seconds and have no value after the
handshake, so a table for them would be a write and a delete per page load. The cost is that a
second API instance would not recognise a ticket minted by the first: **behind more than one
process, that map becomes a Redis key with the same TTL.**

**Lists are fetched twice over their life, on purpose.** A list page (users, audit) is server
rendered once so the table arrives with the HTML — no loading flash, no token in the browser. After
that, **TanStack Query owns it**: filtering and paging rewrite the URL through
`history.pushState` (`lib/query/use-url-filters.ts`), which changes the query key and fires one
BFF call. The server component never runs again, so paging costs a single JSON request instead of a
full re-render. Both sides build the cache key with the **same** parser (`components/<domain>/query.ts`)
so the key the server prefetched and the key the browser wants are the same string — otherwise the
list would be fetched twice on hydration.

### 2.2 The auth flow, end to end

```
POST /api/auth/login (web)
  └─▶ POST /api/v1/auth/login (api)
        ├─ argon2id verify (a dummy hash runs when the email is unknown, so timing matches)
        ├─ lockout check  (MAX_FAILED_LOGINS within LOCKOUT_MINUTES)
        ├─ AuditLog: AUTH_LOGIN or AUTH_LOGIN_FAILED
        └─ returns { user, accessToken } + Set-Cookie: dtrace_rt (signed, httpOnly)
  └─▶ web stores BOTH tokens as its own httpOnly cookies (dtrace_at, dtrace_rt)
      and returns ONLY the user profile to the browser
```

**Refresh is automatic and happens in `apps/web/src/proxy.ts`** (the Next 16 replacement for
`middleware.ts`). The access cookie is given the token's own TTL, so when it expires the browser
drops it; the proxy sees "no access cookie + a refresh cookie" and rotates before the page renders.

**Rotation with reuse detection** (`apps/api/src/modules/auth/token.service.ts`):
every refresh revokes the presented token and issues a new one in the same transaction. Presenting an
already-revoked token means it leaked, so the **entire family** — every rotation descended from that
login — is revoked. This is verified behaviour, not an aspiration.

### 2.3 The guard chain (apps/api/src/app.module.ts)

Global providers run in registration order, and that order **is** the security posture:

1. `JwtAuthGuard` — authenticate; **deny by default**, `@Public()` opts a route out
2. `UserThrottlerGuard` — rate limit, keyed by **user id** once the principal is known,
   falling back to the client address for unauthenticated routes
3. `RolesGuard` — authorize; `@Roles(...)` / `@MinRole(...)`, opt-in

Authentication comes first on purpose: the API's only caller is the BFF, so every authenticated
request arrives from one address. Keying the limiter on the address would put every user in a single
bucket and let one session throttle everyone — which is exactly what happened before this ordering.

Then: `ZodValidationPipe` on the payload → controller → service → Prisma.
On the way out: `ResponseInterceptor` wraps the envelope; `AllExceptionsFilter` handles every error.

### 2.4 Roles

`VIEWER (0) < OPERATOR (10) < AUDITOR (20) < ADMIN (30) < SUPER_ADMIN (40)` — defined once in
`packages/shared/src/constants/roles.ts` and mirrored by the `Role` enum in `schema.prisma`.
Change one, change the other, in the same commit.

`SUPER_ADMIN` is the platform operator: the only role that may open the Admin Panel, and the
only one that may grant itself. `ADMIN` is *not* a smaller version of it — it is the role a
person carries inside a workspace. Because of that distinction every route guard uses
`@MinRole()`, never `@Roles(ROLES.ADMIN)`: an exact match would lock the super admin out of
the very endpoints it is meant to own.

### 2.5 The two halves

The app is split into a **Workspace** (`/workspace/*` — project and document work, everyone has
it) and an **Admin Panel** (everything else — accounts, hierarchy, templates, audit, settings).
The sidebar switches between them; `modeForPath()` derives which half a URL belongs to, so a
deep link and a refresh always draw the same sidebar. The gate is one layout per route group:
`app/(app)/(admin)/layout.tsx` redirects anyone who is not `SUPER_ADMIN` to `/workspace`.
`/` forwards by role, which is why login and the proxy both send people there rather than
naming a half.

### 2.6 Workspace: node → project → document

Access is granted at the **node** (`UserNodeAccess`), never per project: one grant — "this person
is a Collaborator at ESS-HR" — covers every project under it. `WorkspaceAccessService` resolves a
grant against the Role & Akses matrix into `NodeCapabilities`, and that one answer decides both
what the sidebar offers and what the API accepts, so a menu can never offer what the API refuses.
A SUPER_ADMIN reaches every active node as a project ADMIN.

A project team adds two facts, kept apart on purpose: **job role** (TL, PM, BA, IP Compliance,
IT Security, Developer, QA) is what someone *does* and grants nothing; **project role** is what
they *may do*, and everyone added joins as COLLABORATOR. `canCreateDocument` is the one extra a
Manager may hand a Collaborator — it is what makes the "+" appear on a node for them.

On top of that, `DocumentPermission` overrides one member's access to one document. Absent means
inherit; present *replaces* — a merge could only ever widen, so a restriction would be unsayable.
`canView: false` is that restriction: the document leaves that person's tree, their lists and
their API results entirely, which is why `restrictedDocumentIds()` is applied in **every** place
documents are listed. Adding a new document query means applying it there too.

**Only a project's creator may delete it** (`Project.createdById === actor.id`) — not a matrix
capability, and no SUPER_ADMIN exemption, because a Manager runs projects other people started.
`ProjectView.canDelete` is what shows the button. The delete is soft (`Project.deletedAt`): the
project and its documents leave every list and every route 404s through `nodeIdOfProject` /
`nodeIdOfDocument`, but the history stays. The code is rewritten with a `~deleted-…` suffix so the
node can reuse it; the audit `before` keeps the original. A new project query must filter
`deletedAt: null`.

A new project is **seeded with the standard document checklist** (`DEFAULT_PROJECT_DOCUMENTS`) —
real `Document` rows, DRAFT and in PREPARE, rather than a second checklist table shadowing the list
the project already has. They are renameable and deletable, because the checklist is a starting
point per project, not a fixed form. Business Process Model is deliberately not in it: it is
produced per change request, not once per project.

**A project's document order is fixed at creation** (`Document.position`): the seeded checklist
keeps its standard order and a new document goes to the end. Saving never moves a row — "Last
Updated" is a column, not the sort. Lists order by `position`, then `createdAt`; never by
`updatedAt`.

**Only BPM, Release Readiness Checklist (`RRF`) and Security Checklist (`RRF_SEC`) are produced
from a master template.** An entry may
name a `templateCode`, and the seed links it when a template with that code is active; every other
entry is a blank document. A code
with no template seeded yet is left unlinked rather than treated as an error — a project must not
fail to be created because a template has not been seeded.

**A document row may be a door rather than a page.** `Document.screen` (`MANDAYS`, `TIMELINE`,
`TASKS`, `BUGS`, `SIT_SCRIPT`, `UAT_SCRIPT`, `IMPLEMENTATION_PLAN`) marks the rows that stand for screens the project already has; opening one
goes there instead of to the editor. They were buttons above the table until they became rows,
because the table is the list of what a project produces and a partial list is a list nobody
trusts. The document page redirects on `screen` rather than the table linking around it:
the sidebar tree and old bookmarks address documents by id too, and one choke point catches them
all.

Every row opens from the first minute. An earlier rule locked everything but the estimate until
it was submitted; it was dropped, so nothing in the list waits on anything else.

**Mandays is the way into a project.** The Timeline schedules the estimate's tasks and Task
Activity is filled from them, so none of the three means anything before an estimate exists:
`ProjectView.estimateSubmitted` is what lights Bug Tracking, Timeline and Task Activity, and
Mandays is the only one lit until then. The buttons are disabled and the three pages redirect
back to the project, because a disabled button is a hint and the URL is still typeable.

The test is the plan's **status**, not its contents. Existence will not do — opening Mandays
creates the plan and seeds the standard breakdown, so existence only proves somebody looked — and
neither will a filled cell, which was the test before: a half-typed grid is still being argued
over, and a schedule laid over rows that are still being added is scheduling work that may not
survive the morning. Submitting is the estimator saying the breakdown is settled. A plan reopened
to DRAFT closes the three again.

Task Activity is filled from the estimate **once**, on first listing, and `Project.tasksSeededAt`
records that it ran. A row count would not do: clearing the list would bring it all back on the
next visit, and a delete that undoes itself is worse than no delete. The seeded rows are ordinary
afterwards — renameable, re-datable, deletable.

It seeds from the **DEVELOP stage only, and only its leaves.** This screen follows a task through
development and then through testing, and "Define Scope" never travels that road — seeding every
stage put seventeen rows here that sat Unready for Dev forever, around the three that meant
something. A parent in the estimate is a roll-up of its children rather than work of its own, so
only leaves come across; the effort filter already picks them, because days live on the leaf. The
parent's name becomes the module, which is what the estimate's tree already means — "Master
Jabatan" broken into "Menu Master Jabatan" — falling back to the stage label for a leaf with no
parent. The other stages are still estimated and still scheduled on the Timeline; it is only this
list that is about build work.

Its rows are edited **in place**, one at a time, and the row's action buttons become Save and
Cancel while it is open. Eighteen fields were the argument for a dialog, but a plan date means
little except against the row above it and a dialog covers exactly what you are comparing against.
Duplicate copies a row in **directly below** the original (`POST /workspace/tasks/:id/duplicate`,
which shifts the positions after it in the same transaction) — appending it at the end would lose
the adjacency that made duplicating worth doing.

**Test scripts (SIT and UAT)** are one form in two documents: `/workspace/project/:id/test-script/sit|uat`,
one `TestScript` row per (project, kind), shaped module → sub-section → scenario and saved **whole**
as JSON with the `expectedUpdatedAt` guard. The row is written on the first save, not the first visit.
Paraf is a boolean from the browser; **who** initialled a row is stamped by the API from the session
and carried over while the row stays initialled — a name the browser could type proves nothing.
Submitting is refused while any scenario is Pending, and any later save returns the script to DRAFT,
because a "submitted" badge over results that have since changed is a claim nobody made. Captures are
`TestScriptCapture` rows (raster only, sniffed by `common/utils/raster-image.ts`, the same gate as
template images), served inline to anyone who can view the project. Type and Result are pill toggles,
not the dropdown — the one exception to that rule, because they are the two cells touched on every row.
The migration that turned the seeded SIT/UAT rows into doors skipped any that somebody had written in.

**Implementation Plan** is the cut-over runbook, and the screen the "Implementation Document" row
opens: `/workspace/project/:id/implementation-plan`, one `ImplementationPlan` row per project, shaped
phase → step and saved **whole** with the `expectedUpdatedAt` guard, written on the first save — the
same rules as the test scripts, for the same reasons. The **estimated** start and end are never
stored: each step starts where the one above it ended, counted from the plan's start time and
straight across phase boundaries, so `scheduleImplementationPlan()` (shared) is the one definition
the table, the cards and the export read. The **actual** start and finish are full timestamps, not
clock readings — a cut-over that starts at 22:00 finishes after midnight, and two clock readings
would give it a negative duration. A finish typed as a time is anchored to the next such time after
the start. Estimate and actual stand side by side, like the timeline's planned and actual end,
because "how long was it down against how long we said" is what this document answers afterwards.
Only Done and Skipped settle a step; marking the implementation finished is refused while any step
is open, **Failed included**, and any later save returns the plan to DRAFT. An unsaved plan opens
as `DEFAULT_IMPLEMENTATION_PLAN` (shared) — the standard DC → DRC log shipping switchover, 19 steps —
with fresh ids per request and no date; every part of it can be edited, removed or added to. Status is the dropdown
(with its clear button off — `SelectControl clearable={false}`), not pills: five values are too wide.
The migration that turned the seeded rows into doors skipped any that somebody had written in.

**Task Activity** is the module task list: one row per task, followed through development and then
through testing. The two halves are separate columns, not one status — a task can be Closed Dev and
Re-Opened by test at the same time, and a single field would have to pick one of those to be true.
Plan and actual dates are both kept, because overwriting the plan when it slips destroys the only
answer to "was it late". `bucketOf()` in `task.schema.ts` is the one definition of the five
dashboard buckets, so the board and the list can never disagree. The list is returned **whole**
(capped at 500): the screen filters, totals and exports across all of it at once, and a paginated
version would export the page you happened to be on and call it an export.

The mandays estimate is one plan per project, created on first open. **Submitting does not block
and does not lock.** It records that the breakdown is settled, opens the other three screens, tells
whoever manages the node, and hands the estimator back to the project — the grid stays editable and
can be submitted again. Submitting used to freeze the plan pending approval, which was a door with
no handle on the far side: no screen in the app records a decision, so a submitted estimate could
never be edited again by anybody.

Only `APPROVED` freezes it, and a decided plan (approved or rejected) can be **reopened** to DRAFT
by whoever may approve it, which clears the old decision — approval is a door that can be walked
back through, not a dead end. `POST .../mandays/decision` still accepts `APPROVED`/`REJECTED`;
**nothing in the UI sends them yet**, so that half of the state machine is reachable only from the
API.

The **timeline shares the estimate's task rows** — `MandayTask` carries `startsAt`, `endsAt` and
`progressPercent` — because "Project kickoff" is one task whether you are estimating it or
scheduling it. They are two services and two endpoints because they follow opposite rules: the
estimate freezes on approval, the schedule must not, since dates slip while a decision is pending.
Editing the schedule needs `manageProject`; reading it needs `viewProject`. `GET .../timeline`
seeds the plan the same way `GET .../mandays` does, so the chart is never an empty page.
A task also carries `actualEndsAt`, kept beside `endsAt` rather than written over it — the planned
end is what lateness is measured against. `isFinishedLate()` (shared) compares the two by calendar
day and is the one definition the table, the red overrun tail on the bar and the "Task terjadwal"
card all use.

**A task with no estimate gets no dates.** `scheduleSequentially()` skips it rather than rounding
it up to a day — rounding invented work, pushed every later task along by one, and handed a project
estimated at nothing a full calendar of bars. Half a day still rounds up to one, because that is a
real estimate. "Hitung dari mandays" is authoritative in both directions: it *clears* the dates of
a task the estimate no longer covers, since nothing else on the screen could. The day columns read
`0`, never a dash — in a column of numbers "none" and "zero" say the same thing, and the dash only
sent the reader looking for a difference.

### 2.7 Document contents and history

The **template owns the shape**, the **document owns the answers**. A document's `content` is
`sectionKey -> answer`, where the answer's schema is decided by the section's component type
(`document-content.schema.ts`). Nothing there repeats what the template already says — no labels,
no column headings — so a template may gain a section without migrating every document: a key with
no entry is an unanswered blank, and a key the template dropped is discarded on save rather than
rejected.

A section's component type is one of seven. Six shape a page — header, info grid, text, flow,
table, approval strip. The seventh, **CHECKLIST**, is a list of named items somebody verifies:
the template owns the items (they are the standard a release is held to, and a checker who could
rename them could quietly shorten it), the document owns one answer per item — `NO_NEED`, `NEED`,
`IN_PROGRESS`, `CLOSED`, or `null` for not yet answered. Only `CLOSED` and `NO_NEED` settle an
item; a Release Request Form cannot be submitted while any item is outstanding, and
`tallyChecklist()` (shared) is the one count both screens use. Unanswered is the *absence* of an
answer on purpose: a form where somebody could tick "pending" on every line would count as fully
answered. `CLOSED` was once `DONE`; the content schema reads old `DONE` answers as `CLOSED`.

An **INFO row can be typed**: `field` picks the control an `INPUT` row offers — a select with its
own options, a date, a datetime, a number, or a pair (`DATE_RANGE`, `DATETIME_RANGE`, `DURATION`).
A pair stores `[start, end]` in one key rather than in two rows, because it is one answer; splitting
it would let a template drop the end and leave the start standing as if it meant something alone.
`TEXT` is the default, so every row written before this stays what it was, and the content value is
`string | string[]`, so every document written before it still parses.

A checklist **item may carry a `description`** — what the line actually asks for ("min. TLS 1.2").
It defaults to empty, so older templates still parse; the builder edits it as `Nama item | keterangan`
on the item's line.

**Any section may carry images** (`attachments`: `{ assetId, fileName, caption, width }[]`, max
10), printed under the section in the builder preview, the document editor and the RRF screen. The
bytes are a `DocumentTemplateAsset` row plus a file under `UPLOAD_DIR/template-assets`, uploaded
the moment the image is picked (`POST /document-templates/:id/assets`, ADMIN) — the template save
stays one JSON payload and only carries ids, which it checks exist. Images are served **inline**
(`GET /document-templates/assets/:assetId`, any signed-in account, since workspace readers see
them), so storage is raster only and the magic bytes must match the declared type; SVG is never
accepted. An asset outlives its template (`templateId` goes null) because a duplicate points at the
same images.

**Release Request Form – Security Checklist** (code `RRF_SEC`) is the second: the same section A as
RRF, and 56 security items in 7 domains (one group per domain) for IT Security. Both forms open on
`ReleaseRequestForm`, chosen by template code in `OWN_SCREEN`; the `SECURITY` variant lays groups out
as a Domain column with filter chips instead of header rows, and keeps each item's form number when
filtered. The seed also links project documents titled "Security Checklist" (→ `RRF_SEC`) and
"Release Readiness Checklist" (→ `RRF`) that were created before the link existed — but only ones nobody has written in (no version, no file), each with
an audit row.

**Release Request Form** is the first template shipped rather than drawn: `npm run db:seed:templates`
creates it (code `RRF`) with an INFO section for the requester and a 29-item CHECKLIST for IT
Operation. That seed **never overwrites** — a template whose code exists is left alone, because a
template is a form somebody edits afterwards and re-running a script must not undo that.

An **uploaded** document has no template and no sections — its content is the file. PDFs are shown
inline; the API grants that one MIME type an exception and nothing else, because an uploaded HTML or
SVG served inline would run its own script against this origin. Reading uses the browser's own
viewer in a frame (hence `frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN` — cross-origin
framing, the clickjacking case, is still refused). Annotating swaps the frame for a **Konva** canvas
over a PDF.js-rendered page, since an iframe's internals cannot be drawn on from outside it; that
bundle is dynamically imported so a reader never pays for the editor. Saving flattens the layer onto
a **copy** with pdf-lib and uploads it as a new file, so what was signed and what was sent stay
distinguishable.

Every save appends a **`DocumentVersion`**; nothing ever updates or deletes one. Restoring an
earlier version writes its content as a *new* version carrying `restoredFrom`. History that can be
rewritten is not history, and the question this exists to answer — "what did this say when it was
approved?" — depends on that. `Document.content` mirrors the latest version so the common read
needs no join.

A **TEXT section holds sanitised HTML**, written with TipTap (free, MIT). The editor's extension
set is the format — TipTap drops anything it has no node for — but that is convenience, not the
boundary: `sanitizeDocumentContent()` runs on every save in `document-content.service.ts`, because
a document is written by one person and approved by another, and an unsanitised body is a script
running in the approver's session. The allow-list is `RICH_TEXT_ALLOWED_TAGS` in the contract.

Attributes were once empty, and that was right while the editor offered only bold and bullets.
Alignment and font size cannot be said without one, so the rule is now: **an attribute is allowed
only where its values can be checked.** `style` survives, but the sanitiser parses it and keeps
only the three properties in `RICH_TEXT_ALLOWED_STYLES` — `text-align`, `font-size` (two digits,
so one paragraph cannot fill a page) and `color` (hex only, so `url()` is unreachable). Everything
else in the declaration is dropped, which is what stops a body positioning itself over the page.
`href` is bounded by scheme instead: `RICH_TEXT_ALLOWED_SCHEMES` has no `javascript:` and no
`data:`, and every link is rewritten to `target="_blank" rel="noopener noreferrer nofollow"`.

**Adding a toolbar control means checking what HTML it emits.** A control whose output the
sanitiser strips is worse than a missing one — it teaches people a formatting that silently
disappears on save. Verified against `position:fixed`, `background:url()`, `font-size:999px`,
`rgb()`, `javascript:`, `data:`, `<script>`, `onerror` and `<iframe>`: all removed, surrounding
text kept.

Values written before this editor are bare text; `looksLikeHtml()` detects them and
`plainTextToHtml()` converts, so old line breaks survive.

**A body may hold pictures and tables** — a BPM is flow diagrams and module tables as much as prose.
A picture is uploaded first (`POST /workspace/documents/:id/images`, same edit check as a save) and
stored as a `DocumentFile` with `purpose: CONTENT_IMAGE`: out of the file list, sniffed as raster,
and therefore the only kind besides PDF served inline. The sanitiser keeps an `<img>` only when its
`src` matches `DOCUMENT_IMAGE_SRC_PATTERN` (this document store, through the BFF); anything else —
a hot-link, a `data:` paste — is dropped whole, since it would be a request to a third party the
moment an approver opens the document. `width`/`height`, `colspan`/`rowspan`/`colwidth` survive only
as small integers. Table header cells print yellow, like the docx originals.

**Placeholders resolve against the real project.** `DocumentDetail.context` carries the project,
its node, every ancestor keyed by node type code (`{{hierarchy.APP.name}}`), the team by job role
(`{{team.TL.name}}`), the mandays total and today. The builder previews with sample values and
leaves an unknown binding standing; a document renders it blank. An INFO `INPUT` row whose template
value holds a binding starts filled with it (`withDocumentDefaults()`, used by the editor and the
print page alike) and is stored like any answer from the next save. A HEADER line may reserve a
per-document blank with `{{input:Nomor BPM}}`; its answer lives in the header's content.

**A `DATA` section takes its numbers from another screen** — `MANDAY_ACTIVITY` (Plan & Activity:
stage banners, parent subtotals, leaf efforts) and `MANDAY_EFFORT` (days per role spread evenly over
each leaf's working days into Monday-based weeks, plus team head-count by job role). The document
stores a **snapshot**, because a signed BPM must keep saying what it said: the server takes it on
the first save and again only when the author asks (`refresh: true`), and never stores numbers the
browser sent. `ProjectDataService` computes both; it only reads, and never creates a mandays plan.

**"Download PDF" is the browser's print engine**, not a server renderer: `/cetak/dokumen/[id]` sits
outside the `(app)` group (no shell to hide), prints the saved content, and auto-opens the print
dialog. The identification strip is the `<thead>` of one table wrapping the document, which the
browser repeats on every page; "Page X of Y" is the `@bottom-center` box of the named `@page
document` in `globals.css`, so no other screen's printing is affected. Colours are forced to print.
The editor refuses to open it with unsaved changes, because it would print the saved version.

**BPM** is seeded from `BPM_Sample_ESS-HR.docx` (`bpmSections` in `seed-templates.ts`, logo in
`prisma/assets/`). To rewrite a template that already exists, name it explicitly:
`SEED_REPLACE=BPM npm run db:seed:templates` — an environment variable because npm swallows a
`--replace` flag. Replacing keeps the template row and the ids of sections whose key survives.

A save with nothing changed, no note and no status move writes no version: the history records
decisions, not keystrokes. Concurrency uses the same `expectedUpdatedAt` guard as settings and
templates.

---

## 3. Rules that are not negotiable

These exist because breaking them silently weakens the system rather than failing loudly.

1. **A shared contract lives in `@dtrace/shared`.** If the frontend and backend must agree on a
   payload shape, a role name or an error code, it is defined there and imported by both. Never
   redeclare a schema in an app workspace.
2. **Validate with a shared zod schema at the boundary.** `@Body(zodPipe(schema))` on the API,
   `zodResolver(schema)` in the form. The pipe returns the *parsed* value, which strips undeclared
   fields — that is what makes mass assignment impossible. Do not bypass it.
3. **Never read `process.env` outside the config layer.** API: `src/config/configuration.ts`.
   Web: `src/lib/config/env.ts`. Both validate with zod and fail at boot.
4. **Never select a user with `select: true` or a bare `findMany`.** Use `USER_PUBLIC_SELECT`
   (`apps/api/src/modules/users/user.select.ts`). It is an allow-list, so a newly added sensitive
   column cannot leak by default.
5. **Never put a secret, token or password in a log, an error message or an audit record.**
   `redact()` from `@dtrace/shared` is applied centrally in `AuditService` and in the pino config.
6. **Never return a token to the browser.** The access token stops at the Next.js server. If you find
   yourself adding `NEXT_PUBLIC_` to anything auth-related, stop and reconsider.
7. **Login failures must be indistinguishable.** Unknown email, wrong password and disabled account
   all return `INVALID_CREDENTIALS` after comparable work. Do not "improve" these messages.
8. **List endpoints paginate through `paginate()`** with an explicit `allowedSortFields` allow-list.
   User input must never reach `orderBy` unchecked.
9. **Every row change writes to the audit trail, with its snapshot.** `AuditService.record()`
    takes `before` and `after` — the whole row, in the *same projection* on both sides. It
    narrows them to the fields that actually moved, redacts them and stores them. An insert
    passes only `after`, a delete only `before`. `record()` never throws: a failed audit write
    must not roll back a successful operation, but it must log.
    **What does not belong here:** sign-ins, sign-outs, token refreshes, test emails — anything
    that changes no business data. They are structured log lines, read through Grafana. The trail
    is for what changed in the database, and one row per token refresh buried exactly that.
    Rows written under the retired actions stay in the table and still render.
10. **The audit trail is append-only.** There is no update or delete endpoint for `AuditLog`, and
    there should never be one.
11. **Rate limits are per identity, not per address.** `THROTTLE_LIMIT` is a single user's budget.
    Never key a limiter on `req.ip` here — behind the BFF, that is one bucket for the whole app.
12. **Hierarchy placement is data, not code.** A node's type decides where it may stand
    (`canBeRoot`, `allowedParents`). Every create, move and type change re-checks it server-side;
    the UI only filters the menu to what will be accepted. Deactivation cascades **down**;
    activation never cascades in the API — the UI names the branch explicitly instead.
13. **Stored secrets are sealed, never returned.** The SMTP password goes through `sealSecret()`
    (AES-256-GCM, keyed by `SETTINGS_SECRET`) and the API answers with `hasPassword: boolean`.
    An empty password field means "keep the stored one" — never overwrite a secret with a blank.
14. **UI copy is Indonesian, code and comments are English.** A new screen follows the same split.
15. **Access is granted per node, not per project.** `UserNodeAccess` holds (user, node, role,
    canCreateDocument). Ticking a node in the form expands **downwards** only — never upwards, and
    never locking the descendants, so a grant can be narrowed afterwards. `canCreateDocument` is
    forced to false for any role other than COLLABORATOR, server-side.
16. **A signature is the signer's own, and lives in its own table.** `UserSignature` is not
    columns on `User`: `USER_PUBLIC_SELECT` is an allow-list, but a personal mark should not be
    one careless `select` away from every user list — a separate table makes that leak
    impossible rather than merely unlikely. Every route is `/auth/me/signature` and works on
    `actor.id`; none takes a user id, because a mark somebody else can set proves nothing. The
    barcode's `code` is minted once and never re-minted — a code already printed on a document
    has to keep resolving to the same person.
17. **The system role is not on the user form.** Every account is created as an ordinary user;
    Super Admin comes from the seed. What someone can do is decided by their node access.
18. **The permission catalog is code, the matrix is data.** A key in `PERMISSIONS`
    (@dtrace/shared) must have a real enforcement point; which role gets it is editable on
    Role & Akses. Adding a key needs no migration — it reads as its default until someone saves.
19. **A whole-document form sends the version it loaded.** `PUT /settings` takes
    `expectedUpdatedAt` and answers `409 CONFLICT` when the row has moved on. Any future
    replace-the-whole-thing endpoint needs the same guard — without it, a tab left open overwrites
    whatever was saved in the meantime. Check it with `!== undefined`, never for truthiness:
    `null` means "I loaded a document that had never been saved", which is still a claim.

---

## 4. How to add things (the reusable path)

### A new API endpoint
1. Schema + inferred types → `packages/shared/src/schemas/<domain>.schema.ts`, exported from the barrel.
2. `npm run build:shared` (or leave `npm run dev` running, which watches it).
3. Controller method: `@MinRole(...)` or `@Roles(...)`, `@Body(zodPipe(schema))`, `@CurrentUser()`,
   `@Client()` for request provenance.
4. Service method: `USER_PUBLIC_SELECT`-style projection, `paginate()` for lists, `AuditService.record()`
   for anything that mutates.
5. Test the piece that has logic worth protecting (a guard, a pipe, a rule) — not the framework.

### A new page
1. Server component by default. `apiFetch()` for data. Add `export const dynamic = 'force-dynamic'`
   for per-user data.
2. Drop to `'use client'` only for interaction, and keep that component small.
3. Filters and pagination go in the URL, parsed with the same shared schema the API uses.
4. Compose from `@/components/ui` — do not write a new button.
5. A page whose URL carries an id renders `<SetBreadcrumbs trail={[…]} />`. The header sits
   above the page, so it can only derive a crumb from the navigation definition — it cannot know
   that `/workspace/project/6716…/timeline` means "ESS-HR › ESS-HR Additional PTK › Timeline".
   The last crumb is the current page and takes no `href`; leave the trail off and the header
   falls back to the menu entry, which is right for every screen that is just a menu entry.

### A new filterable list
1. `components/<domain>/query.ts`: one `parse…Query(URLSearchParams)` built on the shared list
   schema, plus a `…SearchString()` that runs it through `toSearchString()`. Both the page and the
   panel import it — never parse the query string twice.
2. The page stays a server component: parse, `apiFetch()`, pass `initialSearch` + `initialResult`.
3. `components/<domain>/<domain>-panel.tsx` (client): `useQuery` keyed by the search string,
   `placeholderData: keepPreviousData`, and `initialData` applied **only** when the key still
   matches `initialSearch`.
4. Filters are **declared, not written**: a `FilterDef[]` constant (module level, so its
   identity is stable) handed to `<UrlFilterBar>`. Do not hand-roll a filter row — a new filter
   kind belongs in `ui/filter-bar.tsx` so every list gains it at once. Give it a `title` and it
   renders as its own card with the show/hide toggle in the header (and then the page must not
   also render a `PageHeader` saying the same thing); leave the title off to embed it in
   someone else's card.
5. `PaginationBar` gets `onPageChange` and `onPageSizeChange`; both write through
   `useUrlFilters()`, never `router.push` — a router navigation re-runs the `force-dynamic`
   page and throws the cache away. Both must `params.delete('page')` when the page size changes.
6. A sortable column sets `sortKey` — and only for a field the service lists in its
   `allowedSortFields`. `paginate()` rejects anything else, so a header the API cannot honour
   is a 400 waiting to happen.
7. `DataTable` rows are `density="compact"` by default — these are tables to scan, not to
   read. Only the vertical padding changes; the horizontal padding is fixed so the first column
   stays aligned with the card header above it.
8. Rows per page default to `DEFAULT_PAGE_SIZE` (10) from `lib/query/keys.ts`. The shared
   `paginationQuerySchema` still defaults to 20 for API callers that send no limit; the list
   parsers always send an explicit one, so the two never disagree.

### A new mutation from the browser
1. A form: `useFormMutation()` (`lib/query/use-form-mutation.ts`). It maps the API's field-level
   errors onto the right fields and leaves everything else as one banner. Use `isPending`, not
   react-hook-form's `isSubmitting` — the submit handler now returns before the request does.
2. Not a form: `useMutation` directly.
3. Anything that changes a list must `invalidateQueries` its key prefix (`['users']`), not
   `router.refresh()` — the list is client state now, and a refresh would not touch it.

### A new settings field
1. Add it to the section schema in `packages/shared/src/schemas/settings.schema.ts` *and* to the
   `AppSettingsView` shape the API returns.
2. Add the column to `AppSetting` in `schema.prisma`, then `npm run db:migrate`.
3. Map it in both directions in `settings.service.ts` (`toView`) and in
   `apps/web/src/components/settings/form-schema.ts` (`toFormValues` / `toApiPayload`).
4. Render it in the matching tab component. Forms hold strings; `toApiPayload` converts.

### A new UI primitive
The design system is **shadcn/ui** (`components.json`, style `base-nova`, which is built on
**Base UI** — not Radix). Generated files land in `apps/web/src/components/ui` and **are ours to
edit**; that is the whole point of shadcn.

1. `npx shadcn@latest add <component>` from `apps/web`. **Never pass `--overwrite`** — it has
   already silently destroyed a customised `button.tsx` twice.
2. Rewrite the generated `import { cn } from "cn"` to `from '@/lib/utils/cn'`. One `cn` in the
   codebase; `lib/utils.ts` re-exports it for components that import the shadcn alias.
3. Export it from `ui/index.ts`.
4. Hand-written components follow the same rules: variants with `cva`, classes merged with
   `cn()` so a caller's `className` always wins.

**Colours come from the theme tokens** in `globals.css` (`bg-primary`, `text-muted-foreground`,
`border-border`), not from raw `slate-*`/`sky-*`. shadcn was initialised with the *neutral* base
colour, so `--primary` arrived near-black; it is overridden to sky-600 in `:root`. Change the
accent there, not in a component.

**Every choice control is a searchable dropdown.** There is no `<select>` in this app: `SelectField`
(labelled) and `SelectControl` (bare, for inline use) both render the combobox. They take
`onValueChange(value: string)` — not a change event, because a combobox has no single input whose
`target.value` is the answer.

---

## 5. Commands

```bash
npm run dev            # shared (watch) + api (watch) + web, concurrently
npm run build          # shared → api → web, in dependency order
npm run typecheck      # every workspace
npm run test           # every workspace
npm run lint

npm run docker:up      # PostgreSQL 17 on 127.0.0.1:5432
npm run db:migrate     # prisma migrate dev
npm run db:seed        # satu akun saja: admin@dtrace.local / password1234 (Super Admin)
npm run db:seed:templates  # master template standar (RRF, RRF_SEC, BPM); tidak menimpa yang sudah ada
SEED_REPLACE=BPM npm run db:seed:templates  # sengaja menimpa template tertentu
npm run db:studio
```

First run: `npm install` → `npm run docker:up` → copy both `.env.example` files → `npm run db:migrate`
→ `npm run db:seed` → `npm run dev`.

---

## 6. Environment gotchas that will bite you

- **The API is ESM.** Every relative import needs a `.js` extension, including in `.ts` files
  (`import { X } from './x.js'`). TypeScript resolves it; Node needs it.
- **Prisma 7 requires a driver adapter.** `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`.
  `datasourceUrl` no longer exists. The generated client lives in `apps/api/src/generated/prisma`
  (gitignored — run `npm run db:generate` after cloning; `prebuild` does it automatically).
- **Prisma CLI config is `prisma.config.ts`**, not the schema. The datasource URL is set there.
- **Next 16 renamed `middleware.ts` to `proxy.ts`** with an exported `proxy` function.
- **`typedRoutes` is on.** Runtime-built URLs go through `dynamicRoute()` in `lib/utils/routes.ts`.
- **Do not pass a component reference from a server component to a client component.** Pass a
  rendered element instead (`icon={<Icon />}`, not `Icon={Icon}`). This already caused one bug.
- **`@node-rs/argon2` exports a `const enum`**, unusable under `isolatedModules`. Argon2id is
  inlined as `2` in `password.service.ts` and `prisma/seed.ts` — keep them in step.
- **The API binds dual-stack (`HOST=::`).** Node resolves `localhost` to `::1` before
  `127.0.0.1`, so an IPv4-only bind (`0.0.0.0`) yields `ECONNREFUSED ::1:4000` while the server
  is plainly listening. Do not "simplify" it back.
- **An unreachable API is a state, not a crash.** `apiFetch` turns a connection failure into
  `ApiRequestError` with `SERVICE_UNAVAILABLE`, and `(app)/layout.tsx` renders `ApiUnreachable`.
  A raw `fetch failed` stack in the browser is a regression.
- **`npm audit` must stay at zero.** The root `overrides` block pins `mysql2` and `deepmerge-ts`
  (vulnerable transitive deps of the Prisma CLI). Do not remove it.
- **The `.xlsx` writer is `write-excel-file`, not `exceljs`.** exceljs was tried first and drags in
  a `uuid` below 11.1.1 (GHSA-w5hq-g745-h8pq), which breaks the line above; an override is not a
  way out, because uuid 11 is ESM-only and exceljs requires it as CJS. `write-excel-file` has one
  dependency (`fflate`) and audits clean. Import it from `write-excel-file/browser` — the package
  has no root export — and import it **dynamically**, the way the PDF annotator is, so a reader who
  never downloads anything does not pay for a zip writer.

---

## 7. Where things are

```
packages/shared/src/
  constants/     roles, error codes, audit actions
  schemas/       zod schemas + inferred types (the contract)
  types/         ApiResponse envelope, Paginated
  utils/         redact(), maskEmail(), safeEqual()

apps/api/src/
  config/        env.schema.ts (zod) + configuration.ts (typed tree)
  common/        decorators, guards, filters, interceptors, pipes, middleware, utils
  modules/
    prisma/      PrismaService (the only DB access point)
    auth/        auth.service, token.service (rotation), password.service (argon2id)
    users/       CRUD + role changes + USER_PUBLIC_SELECT
    hierarchy/   node types (the placement grammar) + nodes (the tree)
    permissions/ the project permission matrix (policy, not membership)
    document-templates/ master document templates and their section list
    workspace/   projects, documents, team roles, per-document access, mandays
    settings/    the singleton settings row, marquee schedule, SMTP config
    audit/       AuditService.record() + read-only controller
    health/      /health/live (no DB) and /health/ready (DB)

apps/web/src/
  proxy.ts       session refresh, route gating, CSP nonce
  app/
    (auth)/      login, register
    (app)/(admin)/    dashboard, users, audit, settings, hierarki, jenis-node,
                      dokumen-template, role-akses — SUPER_ADMIN only
    (app)/(workspace)/ workspace, workspace/project, workspace/dokumen
    (app)/akun, (app)/bantuan — belong to neither half, so they sit directly
                      under (app) and keep whichever sidebar the reader came from
    (print)/cetak/dokumen/[id] — a document as paper for "Download PDF"; no shell
  components/layout/  sidebar, shell chrome, breadcrumbs, marquee
  components/settings/ the four settings tabs and their form mapping
  components/document-templates/ the template builder: structure, live document
                 preview, section inspector, flow and table editors
    api/auth/    login, register, logout  (mint/clear cookies)
    api/bff/     generic authenticated proxy for client components
  components/ui/ the design system (button, field, card, badge, alert, data-table,
                 filter-bar…)
  components/filters/ url-filter-bar.tsx — FilterBar wired to the URL
  lib/query/     keys.ts (query keys + toSearchString), use-url-filters.ts,
                 use-form-mutation.ts, provider.tsx (the QueryClient)
  lib/           api clients, session cookies, config, utils
```

Deeper detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/FLOW.md](docs/FLOW.md),
[docs/SECURITY.md](docs/SECURITY.md), [docs/CONVENTIONS.md](docs/CONVENTIONS.md),
[docs/API.md](docs/API.md).

---

## 7b. Fase sekarang: kejar fitur (lint & test ditunda)

**Berlaku sampai pemilik proyek mencabutnya.** Yang diutamakan sekarang adalah fungsionalitas yang
jalan, bukan gerbang kualitas.

- **Jangan jalankan `npm run lint` dan `npm run test`** sebagai bagian dari menyelesaikan tugas.
  Keduanya memperlambat iterasi fitur.
- **`npm run build` tetap dijalankan** bila ada perubahan yang bisa merusak render: Next
  memeriksa tipe dan rute hanya saat build, jadi ini yang membuktikan halaman benar-benar hidup.
- Tetap **tulis kode seolah gerbang itu aktif** — aturan di bagian 3 tidak ikut ditunda. Yang
  ditunda hanya eksekusi pemeriksanya.
- Catat utang yang muncul di daftar di bawah, jangan diam-diam dibiarkan.

### Utang yang ditunda (per 23 September 2026)

| Hal | Di mana | Catatan |
|---|---|---|
| ~~Lint gagal: `setState` sinkron dalam effect~~ | `components/auth/login-form.tsx` | **Beres** — sudah pakai `useSyncExternalStore` |
| `PasswordField` baru dipakai di login | `components/ui/field.tsx` | Form registrasi dan ganti password masih `TextField type="password"` biasa |
| Suite test tidak dijalankan lagi | `apps/api` | Terakhir hijau 37/37 |
| Bug Tracking Timeline hanya UI | `components/workspace/bug-tracking/` | Data contoh di `bug-mock-data.ts`; tidak ada tabel, endpoint, atau write path. Tombol yang mengubah data sengaja dinonaktifkan dan halaman menyatakan dirinya pratinjau |
| `eslint-disable` untuk exhaustive-deps | `components/layout/breadcrumb-context.tsx` | Efeknya sengaja bergantung pada trail terserialisasi, bukan objeknya — depend ke objek akan memicu loop lewat update-nya sendiri |
| Lint belum diverifikasi untuk kode TanStack Query | `components/users`, `components/audit`, `lib/query` | `@tanstack/eslint-plugin-query` terpasang tapi belum dijalankan atas kode baru |

Jalankan `npm run lint && npm run test` sekali lagi sebelum rilis atau sebelum menggabungkan ke
`main`, lalu bereskan tabel di atas.

---

## 8. Definition of done

Before calling a change complete:

- [ ] `npm run build` passes (it is stricter than dev — Next typechecks routes at build time)
- [ ] ~~`npm run lint`~~ dan ~~`npm run test`~~ — **ditunda**, lihat bagian 7b
- [ ] New or changed endpoint: validated with a shared schema, guarded by a role, audited if it mutates
- [ ] No secret in a log, response body or audit record
- [ ] Docs updated if a rule, a flow or the environment changed
