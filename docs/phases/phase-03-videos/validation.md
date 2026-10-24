---
kind: phase
name: phase-03-videos
status: dirty
issue_count: 0
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-24T18:01:26.203639670-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-24T17:59:18.968343732-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-10-24T18:01:25.694654487-03:00"
  docs/project-plan.md: "2026-10-24T19:02:23.437728100+00:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-10-24T19:02:23.435272571+00:00"
  docs/phases/phase-02-auth/context.md: "2026-10-24T19:02:23.436274942+00:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-10-24T19:02:23.435641460+00:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-10-24T19:02:23.432154661+00:00"
issues:
  - id: IC-1
    status: resolved
    summary: "Inherited authentication details omit the Notes governing actual choices"
    resolved_by: clarification
  - id: IC-2
    status: resolved
    summary: "Verification contracts still require excluded outbox and generation concepts"
    resolved_by: clarification
  - id: AMB-2
    status: resolved
    summary: "Recovery before the processing commit depends on an unspecified client retry"
    resolved_by: phase-03-videos/TD-10
  - id: AMB-1
    status: resolved
    summary: "Upload performance wording lacked a verifiable acceptance criterion"
    resolved_by: clarification
  - id: OQ-1
    status: resolved
    summary: "TD-01 — Processing Queue Technology"
    resolved_by: phase-03-videos/TD-01
  - id: OQ-2
    status: resolved
    summary: "TD-02 — Large, Resumable Upload Protocol"
    resolved_by: phase-03-videos/TD-02
  - id: OQ-3
    status: resolved
    summary: "TD-03 — S3 Bucket and Key Organization"
    resolved_by: phase-03-videos/TD-03
  - id: OQ-4
    status: resolved
    summary: "TD-04 — Video Worker Execution and Boundary"
    resolved_by: phase-03-videos/TD-04
  - id: OQ-5
    status: resolved
    summary: "TD-05 — Media Access for Metadata and Thumbnail Extraction"
    resolved_by: phase-03-videos/TD-05
  - id: OQ-6
    status: resolved
    summary: "TD-06 — Playable Format and Processing Scope"
    resolved_by: phase-03-videos/TD-06
  - id: OQ-7
    status: resolved
    summary: "TD-07 — Short, Stable, Conflict-Free URL"
    resolved_by: phase-03-videos/TD-07
  - id: OQ-8
    status: resolved
    summary: "TD-08 — Streaming and Download Delivery"
    resolved_by: phase-03-videos/TD-08
  - id: OQ-9
    status: resolved
    summary: "TD-09 — Processing Lifecycle and Failure Policy"
    resolved_by: phase-03-videos/TD-09
  - id: OQ-10
    status: resolved
    summary: "TD-10 — Consistency Across S3 Completion, Database, and Queue"
    resolved_by: phase-03-videos/TD-10
  - id: OQ-11
    status: resolved
    summary: "TD-11 — Draft Persistence, Resumable Session, and Ownership"
    resolved_by: phase-03-videos/TD-11
  - id: OQ-12
    status: resolved
    summary: "TD-12 — Operational Limits, Expiration, and Upload Cleanup"
    resolved_by: phase-03-videos/TD-12
  - id: OQ-13
    status: resolved
    summary: "TD-13 — Compose Infrastructure and Real Upload/Processing Tests"
    resolved_by: phase-03-videos/TD-13
advisories: []
---

# phase-03-videos — Validation

## Findings

Second resolve cycle: **3 issues resolved, 0 open issues**. All 13 current TD choices and all 14 previously resolved issues are preserved. IC-1 and IC-2 were applied as context/prose clarifications retaining the existing decisions; AMB-2 was applied as parameter-level Revisions to TD-10/B and TD-11/A. The frontmatter remains `status: dirty`: only a new `/plan-validate phase-03-videos` run can reconfirm the verdict.

The preceding validation review compared the decided TDs and their controlling Notes with each other, `context.md`, `library-refs.md`, inherited decisions/conventions, and `docs/project-plan.md`. Context source timestamps match the recorded values. All 13 current Notes are reproduced in the resolved decision parameters. Their explicit precedence resolves the historical Recommendation differences concerning outbox, generations, reprocessing, session replacement, and decimal versus binary size limits; those differences alone are not findings.

### Inconsistencies

_None open. IC-1 and IC-2 are recorded under Resolved Issues._

### Ambiguities

_None open. AMB-2 is recorded under Resolved Issues._

### Missing Decisions

_None._

All nine Phase 03 capability bullets in `docs/project-plan.md:73–81` match the Scope and Capability Coverage in `context.md`. Storage maps to TD-03/TD-12/TD-13; queues to TD-01/TD-04/TD-10/TD-13; upload to TD-02/TD-11/TD-12/TD-13; automatic draft creation to TD-09/TD-11; metadata processing to TD-04/TD-05/TD-09/TD-10; thumbnails to TD-04/TD-05/TD-09; unique URLs to TD-07; streaming to TD-06/TD-08/TD-13; and download to TD-08. No uncovered capability or current TD citing an out-of-scope capability was found.

Every selected npm library is covered by `library-refs.md`: `@nestjs/bullmq`, `bullmq`, both AWS SDK packages, `@nestjs/config`, `joi`, `@nestjs/core`, `typeorm`, `pg`, `jest`, `ts-jest`, and `supertest`. Redis, MinIO, embedded `mcli`, the Node base, and FFmpeg/ffprobe pins also have references. Native `node:crypto` and `node:child_process` require no additional npm dependency, and no direct `ioredis` dependency was selected. The cache explicitly records its documentation-version discrepancies; no missing library reference was found. Historical package/image verification claims were reviewed as recorded evidence, not rerun.

Inherited HTTP error shape and OpenAPI documentation are already decided by `phase-02-auth/TD-07` and `openapi-docs-nestjs/TD-01`/TD-02. No new error-envelope or contract-sync TD is required for this backend-only phase.

### Dependency Gaps

_None._

The declared Phase 01/02 prerequisites cover configuration, persistence, authentication, and the user's existing channel. Storage, Redis, bucket initialization, and the worker are explicitly supplied by current-phase TDs, rather than assumed prior deliverables. The upload → verified completion → durable processing intent → queue/worker → metadata/thumbnail → owner delivery sequence is documented. The pre-commit recovery ambiguity is resolved by the autonomous known-object recovery and serialization policy in the TD-10/TD-11 Revisions (AMB-2).

### Inherited Constraint Conflicts

_None._

The selected current choices preserve namespaced typed configuration and Joi environment validation, shared database configuration, class-validator/class-transformer DTOs, existing JWT authentication, the HTTP error envelope, and OpenAPI documentation/export. Internal storage and queue connections use Compose service names. TD-13 retains serialized tests and isolates the test bucket/queue. The separate public signing endpoint in TD-08 does not replace internal service-name connections. IC-1 restored the controlling inherited Notes without introducing a new authentication choice.

Owner-only access to ready videos does not publish drafts or bring forward Phase 04 visibility and Phase 05 anonymous watch-page behavior. Streaming the original, accepting client-dependent codec support, and omitting playback derivatives are explicit TD-06 choices; no normalized-playback requirement is added. Inherited deferred UI capabilities add no Phase 03 obligations.

### Unresolved Open Questions

_None._

All 13 TDs have a Decision and a controlling Note. OQ-1 through OQ-13 remain resolved; the new recovery clarification is classified as AMB-2, not duplicated as an open question.

### UI Coverage Gaps

_None._

The user explicitly deferred `next-frontend/`; no screen inventory or UI coverage gate applies. Phase 03 has one phase-scope decisions document, so cross-slice checks and advisories do not apply. No custom validation rule files exist in `docs/rules/plan-validate/`.

## Resolved Issues

- **AMB-1** — Upload performance wording lacked a verifiable acceptance criterion. **resolved_by:** clarification, recorded in `context.md` and the TD-12 Note. The API exchanges only small JSON control messages; video bytes go directly to storage. API memory use is independent of file size. An e2e test verifies that control endpoints keep responding during multipart upload. Implementation must also perform a one-off controlled rehearsal using a real 10 GiB file and record the environment, API memory observations, concurrent control requests, and outcome in `progress.md`. No latency SLA is introduced.

- **OQ-1** — TD-01: Processing Queue Technology. **Decision:** A (BullMQ + Redis). **resolved_by:** phase-03-videos/TD-01. The approved parameters and rationale are recorded immediately after the Decision in the source TD and propagated to `context.md`.

- **OQ-2** — TD-02: Large, Resumable Upload Protocol. **Decision:** A (S3 multipart with presigned part URLs). **resolved_by:** phase-03-videos/TD-02. The approved parameters and rationale are recorded immediately after the Decision in the source TD and propagated to `context.md`.

- **OQ-3** — TD-03: S3 Bucket and Key Organization. **Decision:** A (one private bucket per environment, immutable per-video prefixes). **resolved_by:** phase-03-videos/TD-03. The approved parameters and rationale are recorded immediately after the Decision in the source TD and propagated to `context.md`.

- **OQ-4** — TD-04: Video Worker Execution and Boundary. **Decision:** A (Nest standalone application context in a separate video-worker container). **resolved_by:** phase-03-videos/TD-04. The approved parameters and rationale are recorded immediately after the Decision in the source TD and propagated to `context.md`.

- **OQ-5** — TD-05: Media Access for Metadata and Thumbnail Extraction. **Decision:** B (seekable remote read via HTTP Range). **resolved_by:** phase-03-videos/TD-05. The approved parameters and rationale are recorded immediately after the Decision in the source TD and propagated to `context.md`.

- **OQ-6** — TD-06: Playable Format and Processing Scope. **Decision:** D (stream the original object as uploaded). **resolved_by:** phase-03-videos/TD-06. The approved parameters and rationale are recorded immediately after the Decision in the source TD and propagated to `context.md`.

- **OQ-7** — TD-07: Short, Stable, Conflict-Free URL. **Decision:** A (random 12-char base64url public id + UNIQUE). **resolved_by:** phase-03-videos/TD-07. The approved parameters and rationale are recorded immediately after the Decision in the source TD and propagated to `context.md`.

- **OQ-8** — TD-08: Streaming and Download Delivery. **Decision:** A (presigned GET served by the storage). **resolved_by:** phase-03-videos/TD-08. The approved parameters and rationale are recorded immediately after the Decision in the source TD and propagated to `context.md`.

- **OQ-9** — TD-09: Processing Lifecycle and Failure Policy. **Decision:** A (draft → processing → ready or error, attempts tracked separately). **resolved_by:** phase-03-videos/TD-09. The approved parameters and rationale are recorded immediately after the Decision in the source TD and propagated to `context.md`.

- **OQ-10** — TD-10: Consistency Across S3 Completion, Database, and Queue. **Decision:** B (video row as the durable intent + reconciler, no outbox table). **resolved_by:** phase-03-videos/TD-10. The approved parameters and rationale are recorded immediately after the Decision in the source TD and propagated to `context.md`.

- **OQ-11** — TD-11: Draft Persistence, Resumable Session, and Ownership. **Decision:** A (Video + UploadSession). **resolved_by:** phase-03-videos/TD-11. The approved parameters and rationale are recorded immediately after the Decision in the source TD and propagated to `context.md`.

- **OQ-12** — TD-12: Operational Limits, Expiration, and Upload Cleanup. **Decision:** A (24h session window, short renewable part URLs, reconciler cleanup). **resolved_by:** phase-03-videos/TD-12. The approved parameters and rationale are recorded immediately after the Decision in the source TD and propagated to `context.md`.

- **OQ-13** — TD-13: Compose Infrastructure and Real Upload/Processing Tests. **Decision:** A (extend nestjs-project/compose.yaml). **resolved_by:** phase-03-videos/TD-13. The approved parameters and rationale are recorded immediately after the Decision in the source TD and propagated to `context.md`.

- **IC-1** — Inherited authentication details omitted the Notes governing actual choices. **resolved_by:** clarification. Action: context fidelity only. Restored both controlling Notes verbatim from Phase 02 in Phase 03's Inherited Decisions Detail: custom guards using `@nestjs/jwt` govern the Passport Recommendation, and the JWT refresh-token Note governs the opaque-token Recommendation. Existing decisions and prior-phase artifacts are unchanged.

- **IC-2** — Verification contracts still required excluded delivery-control concepts. **resolved_by:** clarification, aligned with `phase-03-videos/TD-10` and `phase-03-videos/TD-11`. Action: prose correction without changing a TD choice. Rewrote the affected validation contracts to verify the video-row durable intent, reconciliation after a crash between completion commit and enqueue, duplicate delivery with an idempotent processor and conditional updates only from `processing`, worker crash/stall recovery for the single immutable source, and the AMB-2 path. Removed the obsolete wording from that section; TD-10/B and the no-reprocessing boundary remain controlling.

- **AMB-2** — Recovery before the `processing` commit depended on an unspecified client retry. **resolved_by:** phase-03-videos/TD-10, with the same refinement also appended to `phase-03-videos/TD-11`. Action: append parameter-level Revisions, retaining B and A respectively. The reconciler scans `active` sessions after `expires_at`, verifies their known key with `HeadObject`, and autonomously completes a correctly sized object (session `completed`, video `processing`, deterministic enqueue after commit). A mismatched object is deleted and the session expires with video `error` (`upload_expired`); a missing object is aborted, accepting `NoSuchUpload`, then receives the same expiry/error transition. API completion and reconciliation lock the upload-session row with `SELECT … FOR UPDATE` in a short transaction, transition only from `active`, re-check idempotent S3 control calls under the lock, and never hold a transaction during S3 byte transfer. Each session is completed or expired exactly once at the 24-hour decision point, without requiring a client retry or another entity. The full revisions and index annotations are propagated to `context.md`.

## Review Boundaries and Next Step

This resolve cycle applied the supplied Pass 1 answers to the current decisions document, Phase 03 context, and validation record, and refreshed the library cache source fingerprint. No prior-phase artifact, inventory, source code, or dependency manifest was edited. No tests, Docker commands, npm commands, Git state changes, or Context7 calls were run in this cycle. Existing library references were sufficient; the 10 GiB rehearsal and runtime verification remain implementation work.

Run `/plan-validate phase-03-videos` to reconfirm status before building. Proceed to `/plan-build phase-03-videos` only after validation reports `status: clean`.
