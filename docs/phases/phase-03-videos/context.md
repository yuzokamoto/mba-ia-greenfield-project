---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-10-24T19:02:23.437728100+00:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-24T17:59:18.968343732-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-10-24T18:01:25.694654487-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-10-24T19:02:23.432154661+00:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-10-24T19:02:23.435272571+00:00"
  docs/phases/phase-02-auth/context.md: "2026-10-24T19:02:23.436274942+00:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-10-24T19:02:23.435641460+00:00"
  .agents/skills/testing-guide-nestjs-project/SKILL.md: "2026-10-24T19:12:51.727122093+00:00"
---

# phase-03-videos — Context

## Scope

**Phase name:** Upload e Processamento de Vídeos

**Capabilities** (literal bullets, verbatim from project-plan.md):

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** `next-frontend/` — deferred by explicit user decision; backend-only phase with no UI scope.

**Deliverables:** functional uploads up to the TD-12 limit, automatic video processing, working streaming, and unique video URLs.

**Affected subprojects:**

- `nestjs-project` — backend-only scope by explicit user decision; no specific subproject note in the phase section.

**Deferred subprojects:** `next-frontend`

**Sequencing notes:** Depends on Phases 01 and 02.

**Neighbors (for boundary detection only):**

- **Phase 02:** Cadastro, Login e Gerenciamento de Conta; depende de Fase 01.
- **Phase 04:** Gerenciamento de Vídeos e Canal; depende de Fase 02, Fase 03.

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | phase | Backend | Processing Queue Technology | decided | A (BullMQ + Redis) | @nestjs/bullmq, bullmq |
| phase-03-videos/TD-02 | phase | Backend | Large, Resumable Upload Protocol | decided | A (S3 multipart with presigned part URLs) | @aws-sdk/client-s3, @aws-sdk/s3-request-presigner |
| phase-03-videos/TD-03 | phase | Backend | S3 Bucket and Key Organization | decided | A (one private bucket per environment, immutable per-video prefixes) | @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, @nestjs/config, joi |
| phase-03-videos/TD-04 | phase | Backend | Video Worker Execution and Boundary | decided | A (Nest standalone application context in a separate video-worker container) | @nestjs/core, @nestjs/bullmq, bullmq |
| phase-03-videos/TD-05 | phase | Backend | Media Access for Metadata and Thumbnail Extraction | decided | B (seekable remote read via HTTP Range) | @aws-sdk/client-s3, @aws-sdk/s3-request-presigner |
| phase-03-videos/TD-06 | phase | Backend | Playable Format and Processing Scope | decided | D (stream the original object as uploaded) | — |
| phase-03-videos/TD-07 | phase | Backend | Short, Stable, Conflict-Free URL | decided | A (random 12-char base64url public id + UNIQUE) | typeorm, pg |
| phase-03-videos/TD-08 | phase | Backend | Streaming and Download Delivery | decided | A (presigned GET served by the storage) | @aws-sdk/client-s3, @aws-sdk/s3-request-presigner |
| phase-03-videos/TD-09 | phase | Backend | Processing Lifecycle and Failure Policy | decided | A (draft → processing → ready or error, attempts tracked separately) | typeorm, bullmq |
| phase-03-videos/TD-10 | phase | Backend | Consistency Across S3 Completion, Database, and Queue | decided | B (video row as the durable intent + reconciler, no outbox table) | typeorm, pg, bullmq |
|     └─ Last revision: 2026-10-24 — Autonomously recover completed objects before the processing commit. | | | | | | |
| phase-03-videos/TD-11 | phase | Backend | Draft Persistence, Resumable Session, and Ownership | decided | A (Video + UploadSession) | typeorm, pg, @aws-sdk/client-s3 |
|     └─ Last revision: 2026-10-24 — Autonomously recover completed objects before the processing commit. | | | | | | |
| phase-03-videos/TD-12 | phase | Backend | Operational Limits, Expiration, and Upload Cleanup | decided | A (24h session window, short renewable part URLs, reconciler cleanup) | @aws-sdk/client-s3, @nestjs/config, joi |
| phase-03-videos/TD-13 | phase | Repo-wide | Compose Infrastructure and Real Upload/Processing Tests | decided | A (extend nestjs-project/compose.yaml) | jest, ts-jest, supertest |

_Source files:_

- phase-03-videos — `docs/decisions/technical-decisions-phase-03-videos.md` (scope_type: phase, related_phases: [3])

### Resolved decision parameters

**Second-cycle refinement (AMB-2, TD-10/B and TD-11/A):** The latest Revisions in Decisions Detail refine the earlier Notes' expiry wording. The reconciler scans `active` sessions after `expires_at` and verifies the known object with `HeadObject`. Matching `ContentLength` completes the session and commits the video to `processing`, then enqueues with the deterministic `jobId`; a mismatch deletes the object and expires the session with video `error` (`upload_expired`); no object triggers `AbortMultipartUpload` (`NoSuchUpload` means already aborted) and the same expiry/error transition. API completion and reconciliation both use `SELECT … FOR UPDATE` on the upload-session row in a short transaction and transition only from `active`, with idempotent S3 control calls re-checked under the lock and no transaction held during S3 byte transfer. Each session is completed or expired exactly once. The 24-hour window is the decision point for an unfinished session; a completed object is recovered without a client retry, a replacement session, or an extra entity. The full approved revision is reproduced under both TDs below.

The supplied Pass 1 answers and their refinements below govern implementation. Research Options and Recommendations are preserved as written; where they differ, the selected Decision and Note take precedence. In particular, TD-10 selects B without an outbox, TD-12 uses 10 GiB, and TD-03/TD-11 do not introduce reprocessing, generations, source replacement, replacement sessions, or initiation idempotency keys. Library pins are documentation-only at this stage; manifests and lockfiles are unchanged.

**TD-01 — A (BullMQ + Redis):** The official NestJS integration provides attempts, backoff, and concurrency while isolating queue load from the business database; TD-10 handles the dual-write gap. Enable Redis AOF persistence and `maxmemory-policy noeviction`; pin `redis:8.2.3-bookworm`. Pin `@nestjs/bullmq` to `12.0.0` and `bullmq` to `5.81.5`: the adapter accepts NestJS 11.1.16 and BullMQ 5. This BullMQ release includes its Redis driver transitively; no direct `ioredis` dependency is selected because application code need not import it. BullMQ 6.4.2 was checked but makes that driver an optional peer, which would require an explicit driver dependency. Exact pins and documentation-version discrepancies are recorded in `library-refs.md`.

**TD-02 — A (S3 multipart with presigned part URLs):** Video bytes never pass through the API. Clients PUT parts directly to S3/MinIO, providing native per-part resumption without an additional gateway. Pin both AWS packages to `3.1156.0`.

**TD-03 — A (one private bucket per environment, immutable per-video prefixes):** Use `videos/{videoId}/original` for the uploaded source and `videos/{videoId}/thumbnail.jpg`, with no `{sessionId}` or `{generation}` segments. Phase 03 has no reprocessing or source-replacement capability, TD-06/D creates no playback derivative, and TD-11 permits exactly one upload session per video; one source per video therefore suffices. This refinement takes precedence over the proposed layout in Option A. Configure the S3 client endpoint and `forcePathStyle` for MinIO, retaining inherited typed configuration and environment validation.

**TD-04 — A (Nest standalone application context in a separate video-worker container):** Build the worker from the same `nestjs-project` image as the API, installing FFmpeg/ffprobe in that image. Its own entrypoint imports only required modules through `createApplicationContext`, opens no HTTP listener, and starts with concurrency 1. Use asynchronous `node:child_process` subprocesses without a shell, apply timeouts, and kill subprocesses on shutdown. The verified `node:25.6.0-slim` container uses Debian bookworm; the available package pin is `ffmpeg=7:5.1.9-0+deb12u1`, which supplies both binaries. No FFmpeg wrapper is selected.

**TD-05 — B (seekable remote read via HTTP Range):** Give ffprobe/ffmpeg a short-lived presigned GET URL for the known object on the internal storage endpoint, never a user-supplied URL. Run ffprobe with JSON output, validate the result, extract one frame with input seeking, and upload the JPEG thumbnail; do not stage the entire source locally. Restrict media protocols to those needed for the controlled storage URL and prevent external references embedded in uploaded media from becoming arbitrary network access. This matches TD-06/D, which requires no playback derivative.

**TD-06 — D (stream the original object as uploaded):** Accept any input that ffprobe parses with at least one video stream and a finite positive duration; anything else is a terminal `invalid_media` error. `ready` means metadata and thumbnail have been persisted and the original verified in storage. Browser codec support is a client concern, so expose detected container/codec metadata in the API. No playback derivative, remuxing, or transcoding is created; FFmpeg/ffprobe are native binaries pinned by TD-04/TD-13.

**TD-07 — A (random 12-char base64url public id + UNIQUE):** Generate 9 bytes with `crypto.randomBytes` and encode them as 12 base64url characters. Enforce a UNIQUE constraint and allow at most 3 insert attempts on a public-ID unique violation, then return a 500-class error. The public ID is immutable. Native `node:crypto` requires no added package.

**TD-08 — A (presigned GET served by the storage):** Only the owner, authenticated by JWT and verified through the video's channel, may request playback/download URLs in this phase, and only for a `ready` video. Playback is inline; download sets `Content-Disposition: attachment` with a sanitized filename. Expiry is configurable, and a presigned URL remains a bearer credential until expiration. Sign all client-facing URLs (upload parts, playback, download) against a configurable public storage endpoint; API/worker operations use the internal Compose endpoint `minio`. In tests both endpoints use the internal endpoint so e2e tests can fetch the signed URLs inside the container. Never rewrite the hostname after signing.

**TD-09 — A (draft → processing → ready or error, attempts tracked separately):** Allow 3 attempts total with exponential backoff for transient failures. Invalid/unsupported media fails immediately without retry, under the acceptance policy in TD-06. Persist only a safe failure code (`invalid_media`, `processing_failed`, `upload_expired`) in the API-visible failure reason; internal diagnostics are bounded. TD-10 reconciliation recovers missing terminal updates rather than relying exclusively on event callbacks.

**TD-10 — B (video row as the durable intent + reconciler, no outbox table):** A single pipeline and job type does not justify an outbox table and dispatcher. The `processing` status written in the completion transaction is the durable intent. Enqueue after commit with a deterministic `jobId` per video. A periodic reconciler in the worker re-enqueues videos stuck in `processing` without a live job, marks `error` when a job failed permanently but the row was not updated, and aborts expired upload sessions under TD-12. The processor is idempotent through deterministic keys and a conditional update only from `processing`; queue deduplication alone is insufficient after a job is removed. There is no generation counter or database lease requirement in this phase. This selected B policy takes precedence over the research recommendation of A.

**TD-11 — A (Video + UploadSession):** Exactly one upload session per video is created together with the draft at upload start; there is no session replacement or initiation idempotency key in this phase. The reconciler aborts sessions that expire before completion and marks the video `error` with `upload_expired`. Every endpoint verifies ownership through `channel.user_id`; client-supplied bucket/key/uploadId never establishes authority. Reconcile repeated completion after a lost S3 response with `HeadObject` on the known key, serializing completion per session. Cross-check parts through paginated `ListParts` and complete only verified numbers/ETags. Keep SQL transactions short and never open during byte transfer. These parameters narrow the session replacement/reprocessing suggestions in the research text.

**TD-12 — A (24h session window, short renewable part URLs, reconciler cleanup):** Maximum size is 10 GiB = 10,737,418,240 bytes, covering both readings of "10GB" because operating systems commonly display GiB as "GB". Use server-defined 64 MiB parts (at most 160 parts), a 24-hour session from creation, and 15-minute part URLs renewable while the session is active. Validate parts through `ListParts` before completion and final object size through `HeadObject` against the declared size; a mismatch causes abort/delete as applicable and `error`. Reconciler cleanup does not depend on bucket lifecycle rules, and expired sessions cannot be replaced under TD-11. These parameters override the proposed decimal limit and replacement-session behavior in the research text.

The verifiable criterion for "without impacting performance" (AMB-1) is: (1) video bytes never pass through the API; it exchanges only small JSON control messages while clients PUT parts directly to storage through presigned URLs; (2) API memory use is independent of file size; (3) API control endpoints remain responsive during multipart upload, verified by an e2e test; and (4) a one-off controlled rehearsal transfers a real 10 GiB file through the multipart flow and records the environment, API memory observations, concurrent control requests, and outcome in `progress.md` during implementation. No latency SLA is added because none exists in `project-plan.md`.

**TD-13 — A (extend nestjs-project/compose.yaml):** Add `minio`, a one-shot bucket-init service, `redis`, and `video-worker` to backend Compose. Pin Redis to `redis:8.2.3-bookworm` and the Docker Hub community MinIO build to `pgsty/minio:RELEASE.2026-08-04T00-00-00Z@sha256:b6bfe7239bfc83fb90d31612d9704d86039dd714f7904b3f1ad68f211e602372`. This is the independent PGSTY MinIO fork, not an upstream MinIO, Inc. image: upstream Docker Hub tags returned 404/access denied and checked Quay tags were unavailable; the selected Docker Hub tag was verified by a successful pull. Its embedded `mcli` can initialize the bucket without adding an unverified `minio/mc` image. Both API and worker use the same image with `ffmpeg=7:5.1.9-0+deb12u1` on the verified bookworm base. See `library-refs.md` for provenance, exact pins, and verification evidence. Tests use a dedicated test bucket and queue name. Processing e2e tests run the processor against the test queue, independently of the development worker, and generate media with FFmpeg at test time; no binary fixtures are committed. Tests remain serialized against the shared test database.

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-03, phase-03-videos/TD-12, phase-03-videos/TD-13 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01, phase-03-videos/TD-04, phase-03-videos/TD-10, phase-03-videos/TD-13 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-02, phase-03-videos/TD-11, phase-03-videos/TD-12, phase-03-videos/TD-13 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-09, phase-03-videos/TD-11 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-04, phase-03-videos/TD-05, phase-03-videos/TD-09, phase-03-videos/TD-10 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-04, phase-03-videos/TD-05, phase-03-videos/TD-09 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-07 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-06, phase-03-videos/TD-08, phase-03-videos/TD-13 |
| Download do vídeo pelo usuário | phase-03-videos/TD-08 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** Nest integration and isolation of queue load favor this phase's worker, accepting an additional service and dual-write recovery in TD-10; B is a strong alternative if reducing services is the priority, with no scale evidence making Redis mandatory.
**Libraries:** @nestjs/bullmq, bullmq

### phase-03-videos/TD-02

**Recommendation:** uses the mandatory storage and eliminates a transfer gateway, keeping persisted sessions, renewed signatures for missing parts, authorized completion/abort, and `ListParts` reconciliation in the backend as described in TD-11.
**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

### phase-03-videos/TD-03

**Recommendation:** covers videos and thumbnails with less configuration, using AWS SDK v3 against both providers and granting individual access through signed URLs; bucket names are configurable per environment, and no expired URL is persisted as the video's identity.
**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, @nestjs/config, joi

### phase-03-videos/TD-04

**Recommendation:** preserves existing domain services and configuration with resource isolation from the API; start with concurrency 1 per worker, CPU/memory/disk limits, timeouts, and subprocess termination on shutdown, increasing only after measurement.
**Libraries:** @nestjs/core, @nestjs/bullmq, bullmq

### phase-03-videos/TD-05

**Recommendation:** with the recommended TD-06/D — avoids making a full 10GB local transfer a prerequisite for probe + thumbnail, accepting variable Range traffic and validating bounded reads/timeouts against the chosen storage and worker image; reconsider A if derivative generation is selected or measured remote access is inefficient, while retaining an in-duration frame with a start-frame fallback for short clips as an extraction heuristic rather than a product requirement.
**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

### phase-03-videos/TD-06

**Recommendation:** best fits this phase's 10GB and storage-cost concerns without adding a normalized-playback requirement, avoiding an additional full-file preparation pass and copy while accepting client-dependent codec support and extra index-seek requests; expose detected container/codec metadata and verify startup/seeking on representative compatible clients, retaining A when predictable index placement and a restricted profile justify the extra copy, or B when broader normalized compatibility is required.
**Libraries:** —

### phase-03-videos/TD-07

**Recommendation:** balances a short URL with generation without external coordination, bounded retries without overwriting, an immutable ID, and reservation retained even after future deletion; reservation failure returns an error instead of publishing a conflict.
**Libraries:** typeorm, pg

### phase-03-videos/TD-08

**Recommendation:** follows the C4 and keeps bandwidth outside the API, issuing links only after access-policy and readiness checks, with configurable duration, authorized renewal, and download headers set in the signature; technical access in this phase belongs to the owner, without making a draft public because it is `ready`.
**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

### phase-03-videos/TD-09

**Recommendation:** meets the requested lifecycle without bringing publication forward, proposing three total attempts with exponential backoff for transient failures, an immediate terminal error for invalid media or media incompatible with the selected processing policy, and `error` after exhaustion; authorized reprocessing opens a new generation, without infinite retries or regression of a generation already ready. Under TD-06/D, lack of codec support in a particular client alone is not a processing failure.
**Libraries:** typeorm, bullmq

### phase-03-videos/TD-10

**Recommendation:** for TD-01/A — makes processing intent explicit, combining queue deduplication with conditional writes per generation and a database lease; redelivered or old jobs cannot overwrite current results, and reconciliation must also recover jobs lost after dispatcher confirmation.
**Libraries:** typeorm, pg, bullmq

**Revisions:**
- 2026-10-24 — Autonomously recover completed objects before the processing commit. Rationale: verify the known object and autonomously continue, so no completed upload is forgotten and no extra entity is needed.
  The reconciler scans `active` upload sessions whose `expires_at` has passed and runs `HeadObject` on each session's known key. If the object exists and `ContentLength` equals the declared size, finish the same completion path as the API: commit session `completed` and video `processing`, then enqueue with the deterministic `jobId` per video. If the object exists with a different size, delete it and commit session `expired` and video `error` with `upload_expired`. If there is no object, call `AbortMultipartUpload`, treating `NoSuchUpload` as already aborted, then commit session `expired` and video `error` with `upload_expired`.
  API completion and reconciliation both lock the upload-session row with `SELECT … FOR UPDATE` inside a short transaction and only transition from `active`; each session is therefore completed or expired exactly once. Never hold the transaction during S3 byte transfer. S3 control calls that must precede the commit (`CompleteMultipartUpload`/`HeadObject`) are idempotent and re-checked under the lock. If the API exits after S3 completion but before the database commit and the client never retries, this reconciliation path still recovers the upload. A crash after the completion commit but before enqueue remains recoverable from the video's durable `processing` intent.
  TD-12's 24-hour window is the point at which an unfinished session is decided; it does not discard a verified completed object. This refinement governs the earlier expiry wording while retaining TD-10/B, the single immutable source, and the no-reprocessing boundary.

### phase-03-videos/TD-11

**Recommendation:** keeps identity and ownership in the video domain and resumption in the upload domain, with short transactions and `channel.user_id` checks on initiation, retrieval, signing, completion, abort, and reprocessing; no endpoint treats arbitrary bucket/key/uploadId values as authority, and drafts remain restricted to their owner.
**Libraries:** typeorm, pg, @aws-sdk/client-s3

**Revisions:**
- 2026-10-24 — Autonomously recover completed objects before the processing commit. Rationale: verify the known object and autonomously continue, so no completed upload is forgotten and no extra entity is needed.
  The reconciler scans `active` upload sessions whose `expires_at` has passed and runs `HeadObject` on each session's known key. If the object exists and `ContentLength` equals the declared size, finish the same completion path as the API: commit session `completed` and video `processing`, then enqueue with the deterministic `jobId` per video. If the object exists with a different size, delete it and commit session `expired` and video `error` with `upload_expired`. If there is no object, call `AbortMultipartUpload`, treating `NoSuchUpload` as already aborted, then commit session `expired` and video `error` with `upload_expired`.
  API completion and reconciliation both lock the upload-session row with `SELECT … FOR UPDATE` inside a short transaction and only transition from `active`; each session is therefore completed or expired exactly once. Never hold the transaction during S3 byte transfer. S3 control calls that must precede the commit (`CompleteMultipartUpload`/`HeadObject`) are idempotent and re-checked under the lock. This works without a repeated client completion request after a lost S3 response or API crash, preserving exactly one upload session per video.
  TD-12's 24-hour window is the point at which an unfinished session is decided; it does not discard a verified completed object. This refinement governs the earlier expiry wording while retaining TD-11/A, the single immutable source, and the no-reprocessing boundary.

### phase-03-videos/TD-12

**Recommendation:** proposes interpreting 10GB as `10_000_000_000` bytes, 64MiB parts, and suggested consumer concurrency of four parts, validating expected size and actual size of every part before completion and final size before processing; oversized files are aborted/rejected without trusting client-declared MIME or size, and suggested concurrency is not a storage-enforced quota.
**Libraries:** @aws-sdk/client-s3, @nestjs/config, joi

### phase-03-videos/TD-13

**Recommendation:** fits the adopted Docker environment without changing the frontend, with real PostgreSQL/MinIO/queue integration and real FFmpeg in the worker path; use unit tests for branches and deterministic failures, and integration/e2e tests for external contracts and recovery.
**Libraries:** jest, ts-jest, supertest

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** Option A (@nestjs/config) — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem: the factory function can be imported as a plain function by `data-source.ts` while also serving as a DI injection token inside NestJS. Building a custom module recreates solved functionality; third-party packages carry maintenance risk.

**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** Option A (Joi) — First-class integration with `@nestjs/config` via `validationSchema`, requiring zero custom wiring. Handles string-to-number coercion natively. Using a different tool for env validation vs. request validation is reasonable — env config is validated once at startup, DTOs are validated per-request. Zod is elegant but adds a third validation paradigm to the project.

**Libraries:** `joi@^17.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** Option B (Namespaced/grouped with registerAs) — The project roadmap explicitly calls for auth, email, and storage in upcoming phases. Namespaced configs provide clear file boundaries per domain, typed injection via `ConfigType<typeof databaseConfig>`, and natural scalability. The `registerAs()` factory is dual-purpose: DI token inside NestJS and plain importable function for `data-source.ts`. Initial files for Phase 01: `src/config/database.config.ts`, `src/config/app.config.ts`.

**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Option A (Shared registerAs factory) — Natural outcome of choosing `@nestjs/config` with `registerAs`. The factory is already callable by design. `data-source.ts` imports it, calls `dotenv.config()`, then calls the factory. Zero duplication, minimal code, no extra abstraction.

**Libraries:** `dotenv` (transitive via `@nestjs/config`)

### phase-02-auth/TD-01

**Recommendation:** Argon2id — For a greenfield project in 2026, Argon2id is the OWASP-recommended choice. The native build dependency is a one-time Docker setup cost. The project has no legacy constraints favoring bcrypt. OWASP minimum: 19MiB memory, 2 iterations.

**Libraries:** `argon2@^0.41.x`

### phase-02-auth/TD-02

**Recommendation:** Option A (@nestjs/passport) — The project plan includes only email/password auth for now, but the plugin architecture costs little and future phases may add social login. Aligns with official NestJS docs, making onboarding and maintenance easier.

**Note:** Decision deliberately diverged from the Recommendation during implementation — custom guards were preferred over `@nestjs/passport` to keep the dependency surface smaller; social login is not on the near-term roadmap, so the plugin-architecture benefit did not justify the extra abstraction layer.

**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-03

**Recommendation:** Option A (Refresh Token Rotation) — Provides the strongest security model with automatic theft detection. The DB write overhead is acceptable for a video platform (auth refresh is infrequent vs. video operations). PostgreSQL is already in the stack, so no new infrastructure needed. Race conditions can be mitigated with a short grace period for the old token.

**Libraries:** —

### phase-02-auth/TD-04

**Recommendation:** Option B (Random Opaque Tokens in DB) — Revocability is important: when a user requests a new password reset, previous tokens should be invalidated. The DB table is trivial to implement, and the tokens table can also serve future needs (e.g., API keys). Keeps email tokens decoupled from the JWT auth system.

**Libraries:** —

### phase-02-auth/TD-05

**Recommendation:** Option A (@nestjs-modules/mailer) — Best NestJS integration with minimal boilerplate. Supports SMTP (matching the architecture diagram), works with MailHog/Mailpit for local development without external dependencies, and scales to any SMTP provider in production. Template engine support (Handlebars) simplifies email formatting. No vendor lock-in.

**Libraries:** `@nestjs-modules/mailer@^2.x`, `handlebars@^4.x`

### phase-02-auth/TD-06

**Recommendation:** Option A (class-validator + class-transformer) — This is a backend-only project (no shared schemas with frontend), so Zod's single-source-of-truth advantage is less impactful. class-validator is the documented NestJS approach, and the project already uses decorators extensively (TypeORM entities, NestJS DI). Fewer integration surprises with NestJS 11.

**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Option A (Custom Domain Exception Filter) — Provides machine-readable error codes that the Next.js frontend can switch on, without the overhead of RFC 9457's URI-based type system. The project is single-consumer (first-party frontend), so a simple `{ statusCode, error, message }` format with domain codes balances clarity and simplicity. The custom filter cost is low — two small files.

**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** Option A (@nestjs/throttler) — Native NestJS integration is decisive: the guard system allows scoping rate limiting to `AuthModule` only via module-level `APP_GUARD`, with `@SkipThrottle()` for exemptions. The project is single-instance with no distributed requirements, so in-memory storage is sufficient. Using express-rate-limit would bypass NestJS's DI and guard lifecycle for no clear benefit.

**Libraries:** `@nestjs/throttler@^6.x`

### phase-02-auth/TD-09

**Recommendation:** Option B (Opaque) — Since DB lookup is mandatory (TD-03), JWT signature adds no security value. Opaque tokens are shorter, leak no data, and are simpler to generate.

**Note:** Decision deliberately diverged from the Recommendation — JWT was kept to reuse the access-token signing/verification infrastructure (`@nestjs/jwt`), trading token size and base64-readability for a single token format across the codebase.

**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-10

**Recommendation:** Option A — The platform is a video sharing service with URL-based channel handles. A strict `[a-z0-9_]` allowlist is the simplest and most portable choice: no extra dependencies, no edge cases around hyphen positioning, and the `user_<random>` fallback provides a valid handle even for extreme email prefixes. Hyphens can always be added in a future iteration if user feedback justifies it.

**Libraries:** —

### phase-02-auth-frontend/TD-01

**Recommendation:** Three reasons. (1) **Architectural fit.** The strict-BFF model in `next-frontend-config-base/TD-03` already nominates the Route Handler as the only NestJS caller; cookie-based sessions are the natural match, and Auth.js's framework adds layers between the BFF and the cookie that buy nothing because the backend is the auth authority — Auth.js's value (DB adapters, OAuth providers, magic-link, `getServerSession` helpers) is mostly unused in this configuration. (2) **Smaller blast radius.** A ~50-LOC session helper is grep-friendly, debuggable, and test-friendly via the existing MSW+BFF integration test pattern; a misconfigured Auth.js callback is a longer fault-isolation loop. (3) **Compatibility with Next.js 16 / React 19.** Built-in `next/headers` `cookies()` is the canonical primitive both runtimes already use; Auth.js v5 versions track Next.js majors with a lag, adding compatibility risk that Option A does not have. Option C is rejected as unsafe (`localStorage` for refresh tokens) and architecturally regressive (loses RSC personalization).
**Libraries:** —

### phase-02-auth-frontend/TD-02

**Recommendation:** Three reasons. (1) **Defense in depth on the cookie content** — `httpOnly` blocks JS, encryption blocks accidental log/proxy inspection; the marginal cost is one ~3KB dep. (2) **Single cookie to manage** simplifies logout (one `session.destroy()` call) and avoids the orphan-cookie failure mode of Option A. (3) **Room to carry minimal user metadata** (`userId`, `email`, `channelSlug`) lets `app/layout.tsx` RSC render the authenticated chrome (avatar, channel name) without a per-render `/auth/me` round-trip — Phase 04+ gains compound here. Option A is a viable downgrade if the team rejects `iron-session` for any reason; the migration A→B (or B→A) is a one-Route-Handler refactor with no test changes downstream because the BFF interface is unchanged. Option C is rejected: it solves a problem (server-side revocation) the project does not have at the cost of infrastructure the project does not own.
**Libraries:** iron-session

### phase-02-auth-frontend/TD-03

**Recommendation:** The single-flight detail is non-trivial and goes in the helper from day one — tested by MSW with a "two concurrent intercepted upstream calls; one refresh expected" assertion. Option B's client-driven pattern is rejected because it doesn't replace Option A (RSC still needs server-side refresh) — adopting B means doing both. Option C's pre-emptive timer is rejected because the failure modes (multiple tabs, sleep/wake) outweigh the latency saving and force a `"use client"` shell near the root.
**Libraries:** —

### phase-02-auth-frontend/TD-04

**Recommendation:** Three reasons. (1) **Decoupled from TD-05** — works with Route Handlers OR Server Actions; the form code does not change if TD-05 is revisited later. (2) **Aligned with shadcn's canonical form primitive** — the project already commits to `radix-nova` shadcn (`components.json`); `npx shadcn@latest add form` produces react-hook-form wrappers; choosing react-hook-form means using the supported primitive instead of hand-rolling around it. (3) **Zod-first developer ergonomics match the rest of the FE foundation** — `next-frontend-config-base/TD-01` chose Zod 4 for env; the same schemas-as-source-of-truth pattern carries to forms with zero new validator paradigm. Option B is rejected for impedance with shadcn's primitive and for over-investing in progressive-enhancement that the strict-BFF model does not require. Option C is rejected for the per-field boilerplate and the loss of client-side feedback on a project that values quick, type-safe form iteration.
**Libraries:** react-hook-form, @hookform/resolvers

### phase-02-auth-frontend/TD-05

**Recommendation:** Three reasons. (1) **Strict-BFF alignment.** `next-frontend-config-base/TD-03` named Route Handlers as the BFF surface; Option A keeps every mutation visible under `app/api/**`. (2) **Test scaffold already exists** — `next-frontend/CLAUDE.md` § Testing and `next-frontend-msw-foundation` were authored for Route-Handlers-as-functions; Option A reuses them with zero invention. (3) **Single mutation surface** — Phase 02 sets the precedent for Phases 03–07; uniformity beats per-mutation idiom-picking when the cost of inconsistency compounds (Option C). Option B has real ergonomic appeal for the simplest forms but fragments the BFF surface and forces test-pattern reinvention; if the team later wants progressive enhancement for specific forms, the migration A→B is per-form and doesn't require touching unrelated routes — A is the safer default and the cheaper baseline.
**Libraries:** —

### phase-02-auth-frontend/TD-06

**Recommendation:** Two reinforcing reasons. (1) **No first-render flicker, no round-trip** — the session is delivered in the same response as the page HTML; the Client Provider hydrates with the correct initial state; users never see "Login" briefly turn into their avatar. (2) **No new BFF endpoint** — the cookie is the source of truth, RSC reads it, the Provider broadcasts it; the BFF surface stays minimal. The `router.refresh()` requirement after mid-session mutations is a small price (one line in the relevant mutation handler) for the structural benefits. Option B is rejected for the double-read-and-flicker; Option C is dominated by Option B and rejected.
**Libraries:** —

### phase-02-auth-frontend/TD-07

**Recommendation:** Three reasons. (1) **First-paint-correct** — the user sees the right outcome on the first paint, no skeleton, no flicker. (2) **Single integration pattern across both flows** — confirmation is RSC-only; reset is RSC + Client form (TD-04, TD-05 patterns reused) — both share the "RSC owns the token, Client Component owns the input" split. (3) **Email-prefetch behavior** is solved at the backend's idempotent-confirmation level (a small note for `/plan-build` to confirm; not a separate TD). Option B's Route-Handler-as-link-target adds redirects for no clean gain. Option C is dominated.
**Libraries:** —

### openapi-docs-nestjs/TD-01

**Recommendation:** é a única opção que preserva as decisões anteriores (`class-validator` em TD-06 de phase-02-auth) sem re-platform; o CLI plugin com `classValidatorShim: true` aproveita os decoradores `class-validator` existentes para inferir schemas, mantendo o boilerplate baixo. Nestia tem mérito técnico real mas o custo de migração do stack de validação inviabiliza-a sem uma decisão upstream de supersede de TD-06. Manual authoring é descartado.

**Libraries:** @nestjs/swagger

**Revisions:**

- 2026-05-12 — Esclarece que o CLI plugin (`classValidatorShim: true`) cobre apenas inferência de schemas de DTOs a partir de `class-validator`; documentação de operações, respostas tipadas por status code, contratos de erro (alinhados ao envelope de phase-02-auth/TD-07) e exemplos exigem decoradores explícitos (`@ApiOperation`, `@ApiResponse`, `@ApiBody`, `@ApiParam`, `@ApiQuery`, `@ApiExtraModels`). _Rationale:_ openapi.json gerado pelo bootstrap atual está genérico — sem detalhes de parâmetros, schemas de retorno por status, nem contratos de erro — porque a base instalada se apoiou só na introspecção automática. Esta revisão fixa que enriquecimento via decoradores explícitos faz parte da Option A escolhida, não é trabalho fora do escopo do TD.

### openapi-docs-nestjs/TD-02

**Recommendation:** o custo marginal sobre Option A é apenas um npm script (~15 linhas) e o benefício é uma fundação correta para futura integração FE (codegen offline) sem perder a UI interativa que dev/QA usam. Option B sozinho pune a experiência de desenvolvimento em dev/local; Option A sozinho compromete o pipeline de codegen futuro. Combinar é dominante.

**Libraries:** —

### openapi-docs-nestjs/TD-03

**Recommendation:** alinha com a postura defensiva já estabelecida em phase 02 e não compromete consumidores legítimos (o `openapi.json` commitado em TD-02 cumpre o papel de "spec consultável fora da UI"). Re-abrir como Option A ou C é trivial no futuro se um caso de uso de API pública aparecer.

**Libraries:** —

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 02)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({ validationSchema, ... _(from phase 02)_
- Config is injected into modules via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; the same factory is importable as a ... _(from phase 02)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'` at the top, then imports `databaseConfig` and calls it as a plain function. _(from phase 02)_
- Database connection parameters (host, port, etc.) are sourced from a single `databaseConfig` factory — never duplicated between ... _(from phase 02)_
- `TypeOrmModule.forRootAsync` is used (not `forRoot`), with `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, `useFactory` ... _(from phase 02)_

## Inherited Deferred Capabilities

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de frontend | deferred | phase-01-configuracao-base | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred | phase-02-auth | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| "Confirmação de conta via e-mail com link de ativação" | deferred | phase-02-auth-frontend | deferred_to_next_phase — UI landing screen de-scoped 2026-05-14; FE confirmation flow (TD-07) picked up by a future phase. BE side unchanged in `phase-02-auth`. |
| "Logout" | deferred | phase-02-auth-frontend | deferred_to_next_phase — logout button lives inside authenticated chrome (typically Phase 04). Phase 02 still implements POST `/api/auth/logout` (BFF route handler + `session.destroy()`) so the contract is ready when the chrome lands. |
| "Recuperação de senha (destination screen / set-new-password)" | deferred | phase-02-auth-frontend | deferred_to_next_phase — `/forgot-password` ships this phase sending the e-mail; the reset-password destination screen is absent from Figma → link destination remains a 404 until a later phase delivers the screen via `/screen-inventory` extension run. Documented as a known gap. |
| "Telas de cadastro, login, confirmação de conta e recuperação de senha" | deferred | phase-02-auth-frontend | a tela de confirmação da conta não será implementada nesta fase corrente, será adiada — the umbrella bullet's full coverage requires the confirmação and reset-password destination screens; both are deferred per Non-UI rows above. The 3 ship-this-phase telas (signup, login, forgot-password) are inventoried and covered by their own verbs; the umbrella bullet itself is deferred to the phase that lands the missing screens. |

## Non-UI / Deferred Capabilities

_None._

## Testing Requirements

### nestjs-project

| Artifact type | Required layers |
|---------------|-----------------|
| Entity (`*.entity.ts`) | Integration: constraints, defaults, `select: false` |
| Service with branching + DB | Unit: branch logic (mock repo) + Integration: DB contract |
| Service with DB only (no branching) | Integration: DB contract |
| Service with configured lib (JWT, cache) | Unit: real lib with test config |
| Service with side-effect dep (email, storage) | Integration: real capture service (Mailpit) or local adapter |
| Module with configured imports | Unit: compilation test |
| Controller | E2E only — do NOT write unit tests |
| DTO | E2E: one validation wiring test per endpoint |
| Guard (delegates to service for business logic) | E2E + Unit if complex internal logic |
| Guard (simple, delegates to Passport) | E2E only |
| Strategy (Passport) | E2E via guard |
| Pipe (custom transformation/validation) | Unit |
| Interceptor (response transform, logging) | Unit and/or E2E |
| Exception Filter | Unit + E2E |
| Middleware | E2E |

### next-frontend

_Deferred subproject — testing requirements will be defined when this subproject enters scope._
