---
kind: phase
name: phase-03-videos
test_specs_aware: true
ui_in_scope: deferred
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-24T21:01:26.203639670+00:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-10-24T21:01:25.694654487+00:00"
  docs/project-plan.md: "2026-10-24T19:02:23.437728100+00:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-24T20:59:18.968343732+00:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-10-24T19:02:23.432154661+00:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-10-24T19:02:23.435272571+00:00"
  docs/phases/phase-02-auth/context.md: "2026-10-24T19:02:23.436274942+00:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-10-24T19:02:23.435641460+00:00"
  .agents/skills/testing-guide-nestjs-project/SKILL.md: "2026-10-24T19:12:51.727122093+00:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Deliver backend storage and background processing for resumable video uploads up to 10 GiB, automatic draft creation, duration and metadata extraction, thumbnail generation, immutable unique video identifiers, owner-authorized streaming, and downloads, with recovery across storage, database, and queue failures; `next-frontend/` is deferred.

---

## Step Implementations

### SI-03.1 — Install Dependencies and Prepare the Shared Infrastructure

**Description:** Provide the pinned storage, queue, and media-tool environment used by API, worker, and container tests.

**Technical actions:**

1. Install exact `@nestjs/bullmq@12.0.0`, `bullmq@5.81.5`, `@aws-sdk/client-s3@3.1156.0`, and `@aws-sdk/s3-request-presigner@3.1156.0` inside `nestjs-api`, updating manifest/lockfile; verify the cached Nest 11/Node compatibility and ESM loading boundary (`phase-03-videos/TD-01`, `TD-02`, `TD-04`; `library-refs.md`).
2. Extend `Dockerfile.dev` with the specified bookworm FFmpeg package before returning to the non-root user; API and future worker share this build, including ffprobe for tests (TD-04/TD-13; review R3).
3. Add pinned `minio` and `redis` services with persistent data/readiness checks, MinIO host ports 9000/9001, Redis AOF/`noeviction`, and no Redis host publication, exactly per Infrastructure (TD-01/TD-13; review R2).
4. Add idempotent `minio-init` using the pinned image's embedded mcli; create both private buckets and their configured CORS, and establish successful-init/healthy-service dependencies. Define the shared image/resources for `video-worker`, deferring its executable startup command until SI-03.18; do not auto-start an incomplete worker or the API server (TD-13; reviews R2/R3).

**Tests:** _(empty — Infra)_

**Dependencies:** none

**Acceptance criteria:**

- The shared image reports working ffmpeg and ffprobe binaries as its non-root runtime user.
- MinIO accepts S3 connections on host port 9000 and console connections on 9001; Redis accepts Compose-network connections without publishing a host port.
- Re-running bucket initialization succeeds and leaves both named buckets private with the configured origin/ETag rules.
- Redis reports AOF enabled and `maxmemory-policy noeviction`; infrastructure readiness succeeds without launching an HTTP application server.

---

### SI-03.2 — Define Video Constants and Validated Runtime Configuration

**Description:** Separate fixed upload policy from required operational configuration and supply the reviewed local development values.

**Technical actions:**

1. Create `src/videos/videos.constants.ts` with the four fixed TD-12 constants from Infrastructure; DTOs, services, and migration generation reference them, and none becomes an env key (TD-12; review R1).
2. Add typed storage, queue, and media-worker `registerAs()` factories and central Joi validation for the Infrastructure env contract, keeping required keys free of schema defaults and optional Redis credentials optional (`phase-01-configuracao-base/TD-01`–`TD-04`; `phase-03-videos/TD-03`, `TD-12`).
3. Add the exact labelled local development block to `.env.example`, including host-facing public storage, the frontend dev CORS origin, local credentials, resource limits, and reviewer-supplied timings; document copying these values into the local dotenv environment without replacing unrelated DB/JWT values (review R2).
4. Share configuration initialization between API and the forthcoming standalone worker without importing the API module into the worker; validate booleans, ports, origins, positive durations, resource settings, and signing/operation lifetime compatibility (TD-03/TD-04/TD-05/TD-08).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Runtime configuration and central env schema | Integration: real ConfigModule/Joi; reviewed local values load, missing/invalid required settings fail, optional credentials remain optional | `src/config/env.validation.integration-spec.ts` |
| Namespaced config factories | Unit: supplied environment maps to typed client/worker settings without hidden defaults | `src/config/video.config.spec.ts` |

**Dependencies:** SI-03.1 — selected packages and shared environment.

**Acceptance criteria:**

- The documented local values produce valid API/worker configuration; omitting a required setting produces a startup validation error.
- Upload policy remains 10 GiB, 64 MiB parts, 24-hour sessions, and 900-second maximum part URLs regardless of environment overrides.
- Host clients receive storage URLs using the configured public endpoint; internal operations resolve `minio` and `redis` through Compose.

---

### SI-03.3 — Establish Isolated Video Test Helpers

**Description:** Give subsequent integration and HTTP suites repeatable storage, queue, media, and database setup inside the backend container.

**Technical actions:**

1. Add `src/test/video-test-environment.ts` to save/apply/restore the three exact R3 overrides after dotenv loading and before module/config/client construction; update existing app-booting test setup to use it when the new modules are introduced (TD-13; review R3).
2. Add focused fixture helpers for generated short valid/invalid media and multipart PUTs, using the shared image's native FFmpeg and internal signed endpoint; isolate queue/bucket cleanup from development resources (TD-02/TD-13).
3. Reuse `createTestDataSource` and serialized database conventions; expose cleanup hooks that later model changes can extend, close generated-media resources, and preserve both Jest `dotenv/config` setup entries (context Testing Requirements; review R3).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Test environment helper | Unit: overrides occur before factory evaluation and previous values are restored, including originally absent values | `src/test/video-test-environment.spec.ts` |
| Media/storage test setup | Integration: native FFmpeg generates media, both buckets exist, test URL origin is internal, cleanup preserves development objects | `src/test/video-test-environment.integration-spec.ts` |

**Dependencies:** SI-03.1, SI-03.2 — infrastructure, FFmpeg, and local configuration.

**Acceptance criteria:**

- A container test module uses `streamtube-videos-test`, `video-processing-test`, and the internal endpoint before opening external clients.
- Test teardown restores prior configuration and removes its generated media without touching development storage or queues.
- Unit/integration and e2e commands retain the established dotenv loading and serialized database behavior.

---

### SI-03.4 — Implement Internal and Public S3 Storage Clients

**Description:** Encapsulate private object storage and signing so domain services exchange control messages rather than video bytes.

**Technical actions:**

1. Create `src/storage/storage.module.ts` and a focused `StorageService` using modular AWS SDK clients, typed config, shared bucket/credentials, internal control endpoint, and separate public signer endpoint (TD-02/TD-03/TD-08; AWS entries in `library-refs.md`).
2. Provide multipart create/list-all-pages/complete/abort, HeadObject, and delete operations over server-owned references; preserve S3 ETags and distinguish absence/`NoSuchUpload` from transient failures (TD-11/TD-12).
3. Add part signing with the domain lifetime constant, internal known-object GET signing, and public inline/attachment GET signing; return explicit expirations and required signed headers, never rewrite signed hosts or bind playback to one Range (TD-05/TD-08; review R1).
4. Support bounded JPEG upload and client shutdown, map expected transient boundary errors to `STORAGE_UNAVAILABLE`, and keep media validity/ownership decisions in domain services (Error Catalog; TD-03/TD-09).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Storage adapter | Integration: real MinIO multipart lifecycle, paginated inventory, absence versus outage, signed PUT/Range GET and dispositions | `src/storage/storage.service.integration-spec.ts` |
| Signing and client endpoint configuration | Integration: public/internal hosts are signed correctly, test overrides work, credential/checksum compatibility and expiry are observable | `src/storage/storage-signing.integration-spec.ts` |
| StorageModule | Unit: DI compilation with controlled providers, no external I/O | `src/storage/storage.module.spec.ts` |

**Dependencies:** SI-03.2, SI-03.3 — typed settings and isolated external-system fixtures.

**Acceptance criteria:**

- An authorized server-side reference can create, inspect, complete, or abort a multipart object through the internal endpoint without passing source bytes through an API process.
- Public and internal signed URLs retain their signed hostname; expired/tampered signatures are rejected by storage.
- Real storage serves a valid byte range and attachment disposition, and the adapter returns all uploaded parts across S3 pages.

---

### SI-03.5 — Create Video and Upload Session Persistence

**Description:** Add the exact reviewed data model and a reversible migration before introducing upload behavior.

**Technical actions:**

1. Implement `Video` and `UploadSession` entities with Data Model columns, explicit relation/FK types, enum values, defaults, and indexes; add the Channel inverse relation without moving channel ownership into another module (TD-07/TD-09/TD-11).
2. Generate `{timestamp}-CreateVideosAndUploadSessions.ts` with its matching class/name, review up/down SQL, preserve the declared-size range and `part_size > 0` checks, and derive the generated range from the constants module while freezing the resulting historical SQL (Data Model; review R1).
3. Add a controller-free `VideoPersistenceModule` registering the entities for API and worker reuse; include the full relation closure in existing isolated DataSources/module fixtures affected by the new Channel relation (TD-04/TD-11; existing TypeORM conventions).
4. Extend shared cleanup and migration-runner coverage for child-before-parent deletion, enum teardown, run/revert/re-run, and restored migrated state after tests; keep application/CLI `synchronize: false` (TD-13; inherited database conventions).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Video | Integration: real PostgreSQL public-ID uniqueness/shape, defaults, size/attempt/readiness checks, JSON/bigint mapping and channel FK | `src/videos/entities/video.entity.integration-spec.ts` |
| UploadSession | Integration: unique video FK, positive part_size, lifecycle enum/defaults, expiry representation | `src/videos/entities/upload-session.entity.integration-spec.ts` |
| Migration chain | Integration: actual migration runner, rollback order, checks and reapplication | `src/database/migrations.integration-spec.ts` |
| VideoPersistenceModule | Integration: configured TypeORM graph and exports resolve against real PostgreSQL | `src/videos/video-persistence.module.integration-spec.ts` |

**Dependencies:** SI-03.2, SI-03.3 — policy constants and database/test setup.

**Acceptance criteria:**

- Duplicate public IDs or a second session for one video are rejected; invalid FK references cannot persist.
- Declared sizes beyond 10 GiB and non-positive part_size values fail database checks, while a positive part_size is accepted without an equality constraint.
- Applying, reverting, and reapplying the migration restores the expected schema without leaving orphan enum types or breaking existing auth data contracts.

---

### SI-03.6 — Add Owner-Scoped Persistence Services and Domain Errors

**Description:** Centralize video/session persistence and ownership checks behind focused services reusable by upload, retrieval, and worker use cases.

**Technical actions:**

1. Add a channel-owned lookup to `ChannelsService` for the initiating user's channel and implement `VideoRecordsService` queries scoped through `channel.user_id`, preserving the Authorization Matrix's 404 behavior (`phase-03-videos/TD-11`).
2. Implement `UploadSessionsService` creation/lookups and active-session row locking with the transactional EntityManager; video creation/state writes remain in VideoRecordsService, which accepts that same manager for atomic pairs (TD-10/TD-11 Revisions; inherited TypeORM transaction contract).
3. Add the Error Catalog's named video/upload/storage exceptions extending `DomainException`; reuse the existing filter and guard response behavior rather than changing the inherited envelope (TD-09; `phase-02-auth/TD-07`).
4. Export only the persistence/domain providers required by later use cases and add explicit response mapping for safe bigint/date handling; keep storage credentials, keys, upload IDs, and diagnostics out of DTOs (Data Model and shared API DTOs).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| VideoRecordsService | Unit: missing/foreign-owner and safe mapping branches | `src/videos/video-records.service.spec.ts` |
| VideoRecordsService | Integration: real owner-scoped joins and manager-bound video writes | `src/videos/video-records.service.integration-spec.ts` |
| UploadSessionsService | Integration: unique pair creation, row locking and transactional rollback | `src/videos/uploads/upload-sessions.service.integration-spec.ts` |
| ChannelsService lookup | Integration: user-to-channel lookup respects existing ownership | `src/channels/channels.service.integration-spec.ts` |
| Domain error mapping | Unit: each new catalog code/status/message passes through the existing filter | `src/common/filters/domain-exception.filter.spec.ts` |

**Dependencies:** SI-03.5 — entities and persistence module.

**Acceptance criteria:**

- A video lookup for another user's channel produces `VIDEO_NOT_FOUND`, with the same outcome as an absent public ID.
- An initiating user without a channel receives `CHANNEL_NOT_FOUND`; client-nominated ownership is never accepted.
- Rolling back a draft/session operation leaves neither an acknowledged partial pair nor committed writes through a different EntityManager.
- Domain errors retain the cataloged envelope and do not expose internal storage references.

---

### SI-03.7 — Implement the Queue Producer with Bounded Failure

**Description:** Publish deterministic processing intent without letting a Redis outage hold an API control request open.

**Technical actions:**

1. Add a producer-only queue module using typed `BullModule.forRootAsync`/queue registration and `@InjectQueue`, with the exact queue/job/payload/jobId contract from Events/Messages (`phase-03-videos/TD-01`, `TD-10`; cached Nest/BullMQ APIs).
2. Configure its API connection separately from worker connections: `enableOfflineQueue: false`, bounded request retry behavior, explicit `redis` host, error listeners, and orderly closure. Verify behavior with the pinned BullMQ 5 release; do not introduce a direct ioredis dependency (review R4; cached production settings and verified failing-fast documentation).
3. Expose a focused processing publisher using three total attempts and configured exponential backoff, accepting the remaining budget for reconciler-created jobs; preserve retained terminal job evidence and deterministic IDs (TD-09/TD-10).
4. Make recoverable enqueue unavailability observable to application callers for post-commit handling and bounded logging; do not hide unrelated programming/database failures or register a consumer in the API (TD-04/TD-10/B).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Processing publisher | Integration: real Redis, exact payload/ID/retry options, duplicate enqueue and established-connection outage fail promptly | `src/videos/queue/video-processing-producer.integration-spec.ts` |
| Producer module | Integration: real configured BullMQ module graph, readiness and connection closure | `src/videos/queue/video-queue.module.integration-spec.ts` |

**Dependencies:** SI-03.1, SI-03.2, SI-03.3 — pinned integration, Redis, typed settings, and test queue isolation.

**Acceptance criteria:**

- Publishing one video produces `process-video` with `{ videoId }` and a colon-free `video-${videoId}` ID in the configured queue.
- Repeated publication does not create duplicate live work; the initial execution budget is three total attempts with the configured exponential delay.
- After a ready producer connection is disconnected, an enqueue attempt fails within the controlled verification timeout instead of waiting indefinitely for reconnection.

---

### SI-03.8 — Implement Upload Initiation and Public-ID Reservation

**Description:** Create one durable owner-scoped draft/session pair and compensate storage allocation failures.

**Technical actions:**

1. Add a native-crypto public-ID generator and bounded reservation path: 9 bytes → 12 base64url characters, at most three insert attempts for the public-ID UNIQUE constraint, with a valid transaction boundary/savepoint between failures (`phase-03-videos/TD-07`).
2. Implement `StartVideoUploadService` using the caller's channel, server-generated UUID/key, declared metadata, and the fixed size/part/session constants; allocate the S3 upload and atomically create the draft/session through their owning services (TD-02/TD-03/TD-11; review R1).
3. Abort an S3 allocation if the draft/session transaction fails; propagate the cataloged allocation/storage/ownership errors without acknowledging partial creation (TD-10/TD-11).
4. Return the exact `StartVideoUploadResponseDto` projection defined in API Contracts; keep initiation non-idempotent per the approved boundary and add the use case to an API-only `VideosModule` consuming the persistence/storage modules (TD-11/A).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Public-ID generation/reservation branches | Unit: character shape, only public-ID violations retry, three-attempt exhaustion | `src/videos/public-id.spec.ts` |
| Initiation orchestration | Unit: allocation failure, compensation and unexpected-error propagation at owned service boundaries | `src/videos/uploads/start-video-upload.service.spec.ts` |
| Initiation persistence/storage | Integration: real PostgreSQL/MinIO, one pair per acknowledged call, rollback compensation and concurrent reservation | `src/videos/uploads/start-video-upload.service.integration-spec.ts` |
| VideosModule | Integration: real configuration/persistence/storage graph resolves with test overrides | `src/videos/videos.module.integration-spec.ts` |

**Dependencies:** SI-03.4, SI-03.6 — storage control and owner-scoped domain persistence.

**Acceptance criteria:**

- Starting a valid upload creates a draft and exactly one active session with the reviewed part size and 24-hour deadline.
- A failed draft/session commit leaves no acknowledged partial pair and its S3 allocation is aborted.
- Three public-ID collisions return `VIDEO_ID_ALLOCATION_FAILED`; unrelated unique/database errors do not consume a fabricated public-ID retry path.

---

### SI-03.9 — Expose Upload Initiation

**Description:** Wire the first video control endpoint to the tested initiation service with inherited authentication and validation.

**Route:** POST /videos/uploads
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Authenticated user's own channel, per Authorization Matrix.

**Technical actions:**

1. Add `StartVideoUploadDto` and the shared response DTO classes verbatim from API Contracts, with constant-based declared-size validation and explicit nullable/enum/nested OpenAPI properties (`phase-03-videos/TD-11`, `TD-12`; review R1).
2. Add `VideosController` and delegate `POST /videos/uploads` to the initiation service using `@CurrentUser().sub`; register VideosModule in AppModule without adding `@Public()` or moving orchestration into the controller (TD-11; inherited custom JWT guard).
3. Declare 201 and all cataloged status/error responses, bearer security, JSON-only body and exact-byte limit; ensure main.ts filters/pipes are reproduced in this endpoint's external HTTP scenarios (`openapi-docs-nestjs/TD-01` Revision; API Contracts).

**Tests:** _(empty — HTTP scenarios are owned by the Test Specs field above)_

**Dependencies:** SI-03.8 — independently verified initiation use case and API module.

**Acceptance criteria:**

- `POST /videos/uploads` with valid metadata returns 201 and the exact draft/session response without accepting source bytes.
- Missing/invalid JWT returns the inherited 401; invalid or unknown body fields return 400 `VALIDATION_ERROR`.
- Missing own channel returns 404 `CHANNEL_NOT_FOUND`; the body cannot grant ownership through a channel/user/storage field.
- An advertised size greater than `10737418240` is rejected before S3 initiation.

---

### SI-03.10 — Implement Part Signing and Resumption

**Description:** Authorize missing-part URL renewal and reconcile resumable state against the real storage inventory.

**Technical actions:**

1. Implement `UploadPartsService` using owner-scoped video/session services, active-session/deadline checks, constant-derived part count and valid unique part numbers (`phase-03-videos/TD-02`, `TD-11`, `TD-12`; review R1).
2. Produce `SignUploadPartsResponseDto`-shaped results using public signing, at most 900 seconds bounded by the remaining window, and no client bucket/key/upload ID authority (API Contracts; TD-08/TD-11).
3. Aggregate paginated ListParts into the exact `ListUploadedPartsResponseDto` shape with sorted numbers, actual ETags/sizes, and session deadline/count; distinguish a closed upload from an empty active inventory (TD-11/TD-12).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Signing/resume policy | Unit: owner/closed/deadline/number branches and expected domain errors | `src/videos/uploads/upload-parts.service.spec.ts` |
| Signing/resume contracts | Integration: real PostgreSQL/MinIO, missing-part renewal, returned signatures/ETags, pagination and cross-owner denial | `src/videos/uploads/upload-parts.service.integration-spec.ts` |

**Dependencies:** SI-03.4, SI-03.6 — signing operations and owner/session lookups.

**Acceptance criteria:**

- Renewed URLs refer only to expected parts of the caller's active upload and stop at the session deadline.
- Resuming after a direct part PUT reports its actual number, ETag, and byte size; unuploaded numbers remain missing.
- Closed/expired sessions fail with `UPLOAD_NOT_ACTIVE`; another owner's video fails with `VIDEO_NOT_FOUND`.

---

### SI-03.11 — Expose Part URL Signing

**Description:** Make the reviewed signing contract available as an owner-authenticated JSON operation.

**Route:** POST /videos/:publicId/upload/parts
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Owner only; active, unexpired session.

**Technical actions:**

1. Add the shared validated public-ID path DTO and `SignUploadPartsDto` exactly as specified, deriving maximum part count from domain constants (`phase-03-videos/TD-07`, `TD-11`, `TD-12`).
2. Delegate the route to UploadPartsService and explicitly return 200 rather than Nest's POST default; document its nested URL response, bearer security, parameters, and cataloged errors (API Contracts; `openapi-docs-nestjs/TD-01` Revision).

**Tests:** _(empty — HTTP scenarios are owned by the Test Specs field above)_

**Dependencies:** SI-03.9, SI-03.10 — controller/global wiring and signing behavior.

**Acceptance criteria:**

- Valid owner requests return 200 with exactly the requested part numbers, URLs, and expirations.
- Duplicate/out-of-range/malformed part numbers or public IDs produce the specified 400/409 result.
- Anonymous requests return 401, foreign-owner requests return 404, and non-active sessions return 409 `UPLOAD_NOT_ACTIVE`.

---

### SI-03.12 — Expose Uploaded-Part Resumption

**Description:** Return the verified storage inventory needed to resume the existing upload session.

**Route:** GET /videos/:publicId/upload/parts
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Owner only; active, unexpired session.

**Technical actions:**

1. Reuse the validated public-ID DTO and delegate the GET route to UploadPartsService, returning `ListUploadedPartsResponseDto` exactly as defined (`phase-03-videos/TD-02`, `TD-11`).
2. Document the 200 session/parts response, complete server-side S3 pagination, resumption instructions, closed-session behavior, and inherited validation/security errors (API Contracts; `openapi-docs-nestjs/TD-01` Revision).

**Tests:** _(empty — HTTP scenarios are owned by the Test Specs field above)_

**Dependencies:** SI-03.10, SI-03.11 — resumption use case and shared path DTO/controller wiring.

**Acceptance criteria:**

- A part uploaded directly to storage appears in the owner's GET response with its actual ETag/size and the existing session deadline.
- The response covers all storage pages without accepting a client S3 continuation token or arbitrary upload ID.
- Completed/aborted/expired sessions return 409 rather than an empty active inventory; a foreign owner receives 404.

---

### SI-03.13 — Implement Serialized Upload Completion

**Description:** Make storage completion and durable processing intent recoverable across lost responses, concurrent calls, and queue outages.

**Technical actions:**

1. Add `UploadFinalizationService` and a controller-free `UploadLifecycleModule` using storage and persistence providers; serialize through the session lock and route every video/session write through its owning service with the same EntityManager (`phase-03-videos/TD-10/B`, `TD-11` Revisions).
2. Verify the complete contiguous manifest against paginated ListParts with exact expected numbers/ETags/sizes, complete the known S3 upload, and recover an ambiguous completion response through HeadObject (TD-02/TD-11/TD-12).
3. Atomically commit session `completed` plus video `processing` only from `active` after size verification; reject/clean up size mismatches with the specified safe reason. Expose the same verified-object transition for deadline reconciliation, without holding SQL locks across byte transfer (Technical Specifications; TD-10/TD-11 Revisions).
4. Add an API completion application service that calls this neutral finalizer, publishes after commit through SI-03.7, and returns the current video on repeat completion without regressing terminal states. A recoverable Redis enqueue failure produces a bounded log line and preserves the 202 result (review R4; TD-10/B).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Completion/finalization policy | Unit: manifest mismatches, missing object versus transient failure, repeated completion and safe errors | `src/videos/uploads/upload-finalization.service.spec.ts` |
| Completion consistency | Integration: real PostgreSQL/MinIO/Redis, concurrent locks, lost S3 response, commit/enqueue failure window and no byte-transfer transaction | `src/videos/uploads/upload-finalization.service.integration-spec.ts` |
| API completion orchestration | Unit: owned finalizer/publisher boundaries prove post-commit handling and bounded safe logging | `src/videos/uploads/complete-video-upload.service.spec.ts` |
| UploadLifecycleModule | Integration: real configured persistence/storage providers resolve without API/AuthModule imports | `src/videos/uploads/upload-lifecycle.module.integration-spec.ts` |

**Dependencies:** SI-03.4, SI-03.6, SI-03.7 — storage operations, transaction-aware persistence, and bounded publisher.

**Acceptance criteria:**

- A verified complete upload commits `completed`/`processing` exactly once and only then becomes eligible for publication to the queue.
- Repeating completion after an ambiguous S3 response recovers the same object/session rather than allocating a replacement.
- Invalid manifests or mismatching completed lengths never start processing; the cataloged error and required cleanup are observable.
- An established producer's Redis outage leaves the pair durably committed and the API use case returns the current processing representation promptly with a bounded diagnostic.

---

### SI-03.14 — Expose Upload Completion

**Description:** Provide the asynchronous completion HTTP contract over the serialized, independently tested finalization path.

**Route:** POST /videos/:publicId/upload/complete
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Owner only; session rules and repeated-completion policy from Authorization Matrix.

**Technical actions:**

1. Add `CompleteVideoUploadDto` with the exact nested `parts: [{ part_number, etag }]` shape and constant-derived count bounds; reuse the public-ID DTO (`phase-03-videos/TD-11`, `TD-12`; review R1).
2. Delegate to the completion application service and explicitly return 202 with `VideoResponseDto`, documenting asynchronous readiness and all completion/expiry errors (API Contracts; TD-10/B).
3. Include the established-connection Redis outage and idempotent repeated-completion cases in this route's external HTTP contract, retaining real PostgreSQL/MinIO and the isolated Redis publisher (review R4; TD-13).

**Tests:** _(empty — HTTP scenarios are owned by the Test Specs field above)_

**Dependencies:** SI-03.11, SI-03.13 — shared path/controller infrastructure and verified completion behavior.

**Acceptance criteria:**

- A valid owner completion returns 202 and processing intent after a verified object/DB commit.
- Malformed manifests return 400; verified-inventory or final-size conflicts return their exact 409 catalog codes.
- With Redis disconnected after producer readiness, completion still returns 202 without waiting for reconnection, and the database retains recoverable processing intent.
- A repeated completed-session request returns the same video's current state without regressing `ready` or `error`.

---

### SI-03.15 — Implement Abort and Deadline Resolution

**Description:** Settle the single upload session safely when cancellation or expiry races with S3/API completion.

**Technical actions:**

1. Add a focused `UploadTerminationService` to the neutral lifecycle module for owner-authorized voluntary abort and worker-invoked expiry resolution; reuse the session lock and known object references (`phase-03-videos/TD-11`, `TD-12`).
2. For active expired sessions implement every revised HeadObject branch: matching object delegates to SI-03.13's verified completion path; wrong length deletes and expires with `upload_expired`; no object aborts (`NoSuchUpload` idempotent) and expires. Transient inspection/cleanup failure leaves the decision pending (TD-10/TD-11 Revisions).
3. Implement idempotent voluntary abort/closed-session rules exactly as API Contracts: retain the draft with `aborted` session, refuse to discard a verified completed object, and do not add a new failure code or replacement session (TD-09 safe allowlist; TD-11/A).
4. Connect completion's after-deadline branch to this same resolver without a circular service dependency; use a shared lower-level verification/transition provider if needed so API and worker invoke one policy (TD-10/TD-11 Revisions; root single-responsibility convention).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Termination policy | Unit: all three expiry branches, NoSuchUpload, transient cleanup failure, repeated abort and completed-object protection | `src/videos/uploads/upload-termination.service.spec.ts` |
| Abort/expiry consistency | Integration: real PostgreSQL/MinIO, competing completion/abort/expiry locks and exactly one terminal session decision | `src/videos/uploads/upload-termination.service.integration-spec.ts` |
| Lifecycle dependency graph | Integration: resolver/finalizer exports compile without circular injection or API imports | `src/videos/uploads/upload-lifecycle.module.integration-spec.ts` |

**Dependencies:** SI-03.13 — shared verified completion transition and lifecycle module.

**Acceptance criteria:**

- Expiry recovers a known correctly sized completed object to `completed`/`processing`, even when the client has not retried.
- Missing or wrong-size objects at expiry produce `expired` plus `error`/`upload_expired` only after the prescribed abort/delete decision.
- Repeated abort is harmless; completion winning the lock cannot be undone by cancellation.
- A transient storage outage leaves an active session undecided for a later retry instead of falsely expiring or completing it.

---

### SI-03.16 — Expose Upload Abort

**Description:** Give the owner the specified cancellation operation without creating replacement-session or deletion behavior.

**Route:** POST /videos/:publicId/upload/abort
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Owner only; completed sessions conflict, already-aborted/expired sessions are idempotent.

**Technical actions:**

1. Reuse the path DTO and delegate abort to UploadTerminationService, explicitly returning 204 with no response body (`phase-03-videos/TD-11`; API Contracts).
2. Document repeat/race behavior, inherited 401/400, owner-scoped 404, `UPLOAD_NOT_ACTIVE` and storage errors without adding controller-side business logic (`openapi-docs-nestjs/TD-01` Revision; Error Catalog).

**Tests:** _(empty — HTTP scenarios are owned by the Test Specs field above)_

**Dependencies:** SI-03.11, SI-03.15 — validated path wiring and tested termination policy.

**Acceptance criteria:**

- Aborting an active owner upload returns 204 with an empty body and the specified retained draft/aborted-session state.
- Repeating an aborted/expired session abort returns 204; attempting to abort a completed session returns 409 `UPLOAD_NOT_ACTIVE`.
- An anonymous caller receives 401 and a foreign owner receives 404 without aborting another upload.

---

### SI-03.17 — Implement Remote Media Inspection and Thumbnail Extraction

**Description:** Obtain validated duration/container/codec data and one JPEG without staging an entire source file.

**Technical actions:**

1. Add a focused media inspection provider using asynchronous `node:child_process` execution without a shell; give ffprobe JSON and ffmpeg input-seeking commands only a short-lived internal GET for the known original key (`phase-03-videos/TD-04`, `TD-05`).
2. Restrict protocols and embedded references to controlled storage access, enforce configured timeouts/bounded diagnostics, and terminate child processes on timeout/shutdown (TD-04/TD-05).
3. Validate at least one video stream and finite positive duration; return safe detected container/codec metadata and `invalid_media` for terminal input-policy failure, without rejecting solely on browser codec support (TD-06/D, TD-09).
4. Extract an in-duration frame with the approved short-clip fallback, upload the bounded JPEG at the immutable thumbnail key, and close temporary resources; do not transcode/remux or produce a playback derivative (TD-03/TD-05/TD-06/D).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Media subprocess policy | Unit: duration/result validation, command construction, bounded diagnostics and timeout/shutdown branches | `src/videos/processing/media-inspection.service.spec.ts` |
| Native media/storage boundary | Integration: real FFmpeg/ffprobe/MinIO, valid/invalid generated inputs, Range access, JPEG output, protocol restrictions and process termination | `src/videos/processing/media-inspection.service.integration-spec.ts` |
| Media module | Unit: configured provider compilation without external I/O | `src/videos/processing/media-inspection.module.spec.ts` |

**Dependencies:** SI-03.3, SI-03.4 — generated media fixtures, shared-image binaries, and internal storage access.

**Acceptance criteria:**

- Valid generated media yields finite positive duration, container/video codec metadata, and a readable JPEG thumbnail through remote storage access.
- Missing/invalid video streams or invalid duration fail with `invalid_media`; browser codec compatibility alone does not trigger a failure.
- Prohibited external references are not fetched, and timeout/shutdown leaves no owned media subprocess running.
- Processing creates no normalized playback derivative and does not stage the full original locally.

---

### SI-03.18 — Run the Standalone Video Worker and Processor

**Description:** Consume processing jobs with durable attempts, idempotent results, native media tools, and no HTTP listener.

**Technical actions:**

1. Implement `VideoProcessingService` with atomic attempt reservation under `status = 'processing' AND processing_attempts < 3`, media-provider delegation, original-object verification, and conditional ready/error persistence (Data Model; `phase-03-videos/TD-06`, `TD-09`, `TD-10/B`).
2. Add the `WorkerHost` processor for the exact queue/job/payload contract at concurrency 1; invalid media throws `UnrecoverableError('invalid_media')`, transient failures consume only the remaining budget with exponential backoff, and terminal evidence is retained for reconciliation (TD-01/TD-09/TD-10; BullMQ cache).
3. Create `src/video-worker.ts` and a worker-only module graph through `createApplicationContext`, importing persistence/storage/media/queue providers with worker-specific Redis settings (`maxRetriesPerRequest: null`), never the API/AuthModule/controller graph (TD-04).
4. Activate the Compose `video-worker` command and required build/start script while preserving the existing API build/bootstrap and export behavior; enable signal shutdown, queue/client/timer closure, child termination, resource limits, and safe logs (Infrastructure; TD-04/TD-13).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Processing policy | Unit: terminal/no-op branches, safe failure handling, affected-row checks and exhausted budget | `src/videos/processing/video-processing.service.spec.ts` |
| Processing persistence | Integration: real PostgreSQL/MinIO/FFmpeg, durable attempt increments, ready fields, stale result rejection | `src/videos/processing/video-processing.service.integration-spec.ts` |
| BullMQ processor | Integration: real test Redis queue and native media processing, one-attempt invalid-media failure, transient retry exhaustion and redelivery | `src/videos/processing/video.processor.integration-spec.ts` |
| Standalone worker graph | Integration: application-context boot/close, configured providers, no HTTP listener, isolated test queue and shutdown | `src/videos/processing/video-worker.module.integration-spec.ts` |

**Dependencies:** SI-03.6, SI-03.7, SI-03.17 — durable domain services, queue contract, and verified media extraction.

**Acceptance criteria:**

- A processing job for valid media yields `ready` with duration/metadata/thumbnail while the original remains the playback source.
- Invalid media fails immediately with `invalid_media`; transient failures never receive more than three total durable processing attempts.
- Redelivery for a ready/error row does not change its result or create a new generation.
- The worker consumes only its configured queue, opens no HTTP listener, and closes its connections and children during shutdown.

---

### SI-03.19 — Reconcile Uploads and Processing Intent

**Description:** Recover every approved storage/database/queue failure window without requiring a client retry or replacement session.

**Technical actions:**

1. Add `VideoReconcilerService` to the worker with a lifecycle-owned, non-overlapping native timer using required `VIDEO_RECONCILE_INTERVAL_MS`; allow explicit tick invocation for focused verification and clear the timer on shutdown (`phase-03-videos/TD-10/B`; Events/Messages).
2. Scan active expired sessions via the indexed predicate and invoke SI-03.15's shared resolver; verified completed objects commit processing intent and are published after commit, including API-crash/no-client-retry recovery (TD-10/TD-11 Revisions).
3. Reconcile processing rows with real `getJob`/`getState`: preserve all live states, distinguish retained completed/failed jobs, repair permanent failure rows, and re-enqueue missing intent only with remaining durable budget (TD-09/TD-10; BullMQ cache).
4. Remove only inspected terminal job records when required for safe same-ID recovery; preserve ready/error rows, classify allowlisted safe failure reasons, and treat dependency unavailability as undecided rather than absent (Events/Messages state table).
5. Verify lock races, commit/enqueue windows, Redis loss, missed terminal updates, and timer teardown using real dependencies with test-controlled faults and short positive timing configuration (TD-13; reviews R3/R4).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Reconciliation decisions/timer | Unit: every state-table branch, non-overlap, unavailable-dependency handling and shutdown | `src/videos/processing/video-reconciler.service.spec.ts` |
| Expired-session recovery | Integration: real PostgreSQL/MinIO, completed-object/no-client-retry recovery, mismatch/no-object expiry and competing API decisions | `src/videos/processing/upload-reconciliation.integration-spec.ts` |
| Queue-intent recovery | Integration: real PostgreSQL/Redis/worker, post-commit outage recovery, lost/terminal/live jobs and durable retry budget | `src/videos/processing/processing-reconciliation.integration-spec.ts` |

**Dependencies:** SI-03.13, SI-03.15, SI-03.18 — reusable completion/expiry transitions and real worker/queue processing.

**Acceptance criteria:**

- A completed object left in an active session by API failure reaches `processing` after the expiry decision without any client request or replacement record.
- Restoring Redis after a post-commit enqueue outage eventually produces the deterministic job and completes valid processing.
- Live waiting/active/delayed jobs are not duplicated or failed; permanent failures and exhausted missing jobs are reflected in safe terminal video states.
- Concurrent resolver/reconciler calls make one session decision, and shutdown leaves no active reconciler timer.

---

### SI-03.20 — Implement Own-Video Detail and Listing Queries

**Description:** Project every lifecycle state safely through the authenticated user's channel without exposing internal upload/storage data.

**Technical actions:**

1. Add focused own-video query methods/providers using the existing owner-scoped persistence services, loading the session for detail and returning only the caller's videos for listing (`phase-03-videos/TD-07`, `TD-09`, `TD-11`).
2. Return `OwnVideoResponseDto` and `VideoResponseDto[]` shapes exactly from API Contracts, preserving null processing fields, safe bigint/date conversion, and list order `created_at DESC, id DESC` (Data Model and shared DTOs).
3. Keep empty listing as `[]`, foreign/missing detail as `VIDEO_NOT_FOUND`, and avoid adding filtering/publishing/pagination/editing contracts not selected for this phase (context Scope; Authorization Matrix).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Own-video queries and projection | Integration: real PostgreSQL owner joins, all four states, aborted-session visibility, deterministic order, null/bigint/date conversion and empty list | `src/videos/own-videos.service.integration-spec.ts` |

**Dependencies:** SI-03.6 — owner-scoped persistence and safe projections.

**Acceptance criteria:**

- An owner can retrieve draft, processing, ready, and error videos with their specified session/nullable result fields.
- Listing excludes every other user's videos, returns the specified order, and yields `[]` when the caller has no videos.
- Detail/list results contain no storage keys, credentials, S3 upload IDs, or processing diagnostics.

---

### SI-03.21 — Expose Own-Video Detail

**Description:** Expose the stable public-ID lookup and owner-visible upload/processing status.

**Route:** GET /videos/:publicId
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Owner only, in every lifecycle state.

**Technical actions:**

1. Delegate the validated public-ID GET route to the own-video query provider, returning the exact `{ video, upload_session }` response (`phase-03-videos/TD-07`, `TD-09`, `TD-11`).
2. Document UUID versus public ID, nullable result fields/session state, 200 response, inherited 401/400, and owner-scoped 404 (`openapi-docs-nestjs/TD-01` Revision; API Contracts).

**Tests:** _(empty — HTTP scenarios are owned by the Test Specs field above)_

**Dependencies:** SI-03.11, SI-03.20 — shared public-ID controller validation and detail queries.

**Acceptance criteria:**

- The owner receives 200 with the exact detail DTO for a valid immutable public ID, including safe failure state when processing failed.
- A malformed public ID returns 400, an anonymous caller receives 401, and a missing/foreign video receives 404 `VIDEO_NOT_FOUND`.
- Retrying GET does not renew a session, restart processing, or change video identity.

---

### SI-03.22 — Expose the Own-Video Listing

**Description:** Return the authenticated user's video collection through the selected private listing contract.

**Route:** GET /videos
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Authenticated; the query always restricts rows through `channel.user_id = user.sub`.

**Technical actions:**

1. Delegate the collection GET route to the tested own-video query provider and return `VideoResponseDto[]` without adding unselected query parameters (`phase-03-videos/TD-11`; API Contracts).
2. Document the array schema, ordering, empty result, owner scope, and inherited authentication/throttler responses (`openapi-docs-nestjs/TD-01` Revision).

**Tests:** _(empty — HTTP scenarios are owned by the Test Specs field above)_

**Dependencies:** SI-03.9, SI-03.20 — API module/controller and collection queries.

**Acceptance criteria:**

- `GET /videos` returns 200 with only the caller's videos in the specified deterministic order.
- A caller with no videos receives `[]`; no token produces the inherited 401 response.
- The response remains a safe collection projection and cannot nominate another owner through request data.

---

### SI-03.23 — Implement Playback and Download URL Authorization

**Description:** Issue expiring storage access only for the owner's ready original video.

**Technical actions:**

1. Add a focused `VideoAccessService` that resolves owner-scoped detail and enforces `ready` before asking StorageService for a URL (`phase-03-videos/TD-08`; Authorization Matrix).
2. Return `SignedUrlResponseDto` with configured independent playback/download expirations; playback is inline without a fixed Range, download is attachment with a sanitized original filename (TD-08; API Contracts).
3. Keep original-format delivery and safe metadata expectations, renew only through the same authorized methods, and avoid persisting signed URLs or using client-supplied keys (TD-03/TD-06/D/TD-11).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Video access policy | Unit: owner/readiness branches, safe filename/header construction, correct signer mode/TTL | `src/videos/video-access.service.spec.ts` |
| Real media access | Integration: real PostgreSQL/MinIO, valid signed Range playback, attachment filename, expiry and URL tampering | `src/videos/video-access.service.integration-spec.ts` |

**Dependencies:** SI-03.4, SI-03.20 — storage signing and owner-scoped retrieval.

**Acceptance criteria:**

- Ready owner videos yield inline playback or attachment download URLs with the requested operation's configured lifetime.
- Draft/processing/error videos fail with `VIDEO_NOT_READY`, and foreign-owner lookup fails with `VIDEO_NOT_FOUND` before URL issuance.
- Download filenames cannot inject path/control/header content; storage Range requests retrieve part of the original without API byte proxying.

---

### SI-03.24 — Expose the Playback URL

**Description:** Offer authorized streaming access through an expiring JSON URL response.

**Route:** GET /videos/:publicId/playback-url
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Owner only; video must be `ready`.

**Technical actions:**

1. Delegate the validated route to VideoAccessService's playback operation and return the exact `SignedUrlResponseDto` (`phase-03-videos/TD-06`, `TD-08`).
2. Document JSON 200 rather than binary/redirect output, Range seeking at storage, bearer-until-expiry semantics, renewal, original-format limitations, and the cataloged errors (`openapi-docs-nestjs/TD-01` Revision; API Contracts).

**Tests:** _(empty — HTTP scenarios are owned by the Test Specs field above)_

**Dependencies:** SI-03.11, SI-03.23 — validated route infrastructure and access authorization.

**Acceptance criteria:**

- A ready owner request returns 200 with `{ url, expires_at }`, and a subsequent storage Range GET returns partial original bytes.
- A non-ready video returns 409 `VIDEO_NOT_READY`; anonymous/foreign callers receive 401/404 respectively.
- Issuing or renewing playback access does not publish the video or alter its immutable identity.

---

### SI-03.25 — Expose the Download URL

**Description:** Offer owner-authorized original-file downloads with the approved attachment behavior.

**Route:** GET /videos/:publicId/download-url
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Owner only; video must be `ready`.

**Technical actions:**

1. Delegate the validated route to VideoAccessService's download operation and return `SignedUrlResponseDto`, using the independent download lifetime (`phase-03-videos/TD-08`).
2. Document JSON 200, signed attachment disposition with sanitized original filename, original-object delivery, bearer expiry, and all readiness/ownership/validation errors (`openapi-docs-nestjs/TD-01` Revision; API Contracts).

**Tests:** _(empty — HTTP scenarios are owned by the Test Specs field above)_

**Dependencies:** SI-03.11, SI-03.23 — validated route infrastructure and attachment signing.

**Acceptance criteria:**

- A ready owner request returns 200 with an expiring URL whose storage GET downloads the original with a safe attachment filename.
- Non-ready/anonymous/foreign-owner requests receive the specified 409/401/404 without obtaining a download URL.
- Filename manipulation cannot change the signed object's key or inject a response header.

---

### SI-03.26 — Regenerate OpenAPI and Document Backend Conventions

**Description:** Make the implemented video contracts and operating conventions reviewable through the tracked export and canonical project documentation.

**Technical actions:**

1. Audit all nine API operations against Technical Specifications: explicit request/path/response/nested models, constants-derived validation bounds, status/error examples, bearer security, and native guard 401 shape; retain the inherited opt-in Swagger policy (`openapi-docs-nestjs/TD-01` Revision, `TD-02`, `TD-03`).
2. Run the existing container `npm run openapi:export`, regenerate the tracked OpenAPI artifact, and verify that the export includes video schemas/contracts without starting worker consumers or an HTTP listener (`phase-03-videos/TD-04`; existing export convention).
3. Document backend configuration, labelled local examples, constants, isolated test helpers, private bucket/CORS setup, worker startup/shutdown, fail-fast producer behavior, recovery, and rehearsal instructions in `nestjs-project/CLAUDE.md`; change root `CLAUDE.md` only if an actual repo-wide convention requires it (TD-13; review documentation guidance).
4. After canonical documentation changes, run `node scripts/port-ai-foundation-to-codex.mjs` and then `node scripts/port-ai-foundation-to-codex.mjs --check` from the repository root; include generated AGENTS.md updates without hand-editing them (root Codex port convention).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Offline OpenAPI export | Integration: actual export bootstrap and tracked schemas/status/error/security contracts | `src/openapi-export.integration-spec.ts` |
| Swagger visibility and video paths | E2E: existing documentation-policy checks extended for the video surface | `test/swagger.e2e-spec.ts` |

**Dependencies:** SI-03.9, SI-03.11, SI-03.12, SI-03.14, SI-03.16, SI-03.19, SI-03.21, SI-03.22, SI-03.24, SI-03.25 — all routes and worker recovery behavior are available to document.

**Acceptance criteria:**

- The regenerated tracked OpenAPI export describes all nine video endpoints with the actual DTO/status/security contracts and exact 10 GiB limit.
- Documentation gives working local storage/queue examples and container test commands while distinguishing host-facing public URLs from Compose-internal operations.
- Canonical backend conventions and generated Codex instructions agree, and the regeneration check exits successfully.
- Exporting the API document does not start a processing consumer or an HTTP listener.

---

### SI-03.27 — Verify the Full Pipeline and Rehearse a Real 10 GiB Upload

**Description:** Close the phase with measured large-upload evidence and every repository Definition of Done check.

**Technical actions:**

1. Run all unit/integration tests serially and the complete e2e collection inside `nestjs-api`, including the externally authored endpoint scenarios and actual PostgreSQL/MinIO/Redis/FFmpeg paths; verify all contexts/clients/timers/subprocesses close (TD-13; context Testing Requirements).
2. Perform the explicit TD-12 controlled rehearsal using a real probe-valid `10737418240`-byte source transferred through all 160 direct-storage multipart parts. Record environment/image/resource settings, baseline/during/after API memory observations, concurrent JSON control requests with statuses/timing observations, actual transferred size, completion/processing result, and outcome in this phase's `progress.md`; compare with the small-upload baseline and verify no source bytes traverse the API. Do not substitute declared-size-only or mocked transfers, and do not invent a latency SLA (TD-12 acceptance criterion).
3. Verify the post-commit Redis outage/recovery flow and no-client-retry completion recovery using the isolated test harness, and confirm owner playback Range/download delivery after processing. Keep the real-size rehearsal distinct from the fast automated suite (TD-08/TD-10 Revisions; review R4).
4. Run container `npx tsc --noEmit`, `npm run lint` with zero errors, the build, and OpenAPI regeneration; verify the tracked export is current and canonical/generated documentation remains synchronized. Record command outcomes and rehearsal evidence in `progress.md`; do not mark the phase complete while a required check or rehearsal is outstanding (repository Definition of Done; review guidance).

**Tests:** _(empty — final verification runs the existing suites and the explicit controlled rehearsal)_

**Dependencies:** SI-03.19, SI-03.26 — complete recovery pipeline, implemented routes, export, and documentation.

**Acceptance criteria:**

- The full unit/integration/e2e collections pass, TypeScript exits successfully, lint has zero errors, the build succeeds, and the tracked OpenAPI export is regenerated.
- `progress.md` contains reproducible evidence of a real 10 GiB multipart transfer, API memory observations, concurrent control-request outcomes, and successful completion/processing.
- Observed source transfer bypasses the API, API memory does not scale with video size, and control endpoints remain responsive during transfer under the documented environment.
- The outage/no-client-retry recovery scenarios converge to the specified states, and the ready original supports authorized Range playback and safe attachment download.

---

## Technical Specifications

### Data Model

The tables below materialize `phase-03-videos/TD-07`, `TD-09`, `TD-10/B`, and `TD-11/A`, governed by the **Resolved decision parameters** and the TD-10/TD-11 Revisions in `context.md`. New column names and SQL representations are derived here from those concepts; they are not quotations of an existing entity. UUID identifiers, snake_case columns, explicit foreign keys, enum columns, and generated timestamps follow `src/channels/entities/channel.entity.ts` and the existing migrations. Unbounded descriptive values use `text`, avoiding an unsupported product length limit.

#### Video — `videos`

| Column | PostgreSQL type | Constraints / default | Source and meaning |
|--------|-----------------|-----------------------|--------------------|
| id | uuid | PK, generated with `uuid_generate_v4()` | Existing entity/migration convention; internal video identity in TD-11 |
| channel_id | uuid | NOT NULL, FK → `channels.id`, ON DELETE/UPDATE NO ACTION | TD-11; channel ownership follows existing `channels.user_id` |
| public_id | varchar(12) | NOT NULL, UNIQUE, CHECK exactly 12 characters in `[A-Za-z0-9_-]` | TD-07: 9 random bytes encoded as base64url; immutable |
| title | text | NOT NULL | Draft identity in scope and TD-11; supplied at initiation, no edit operation in this phase |
| status | enum `videos_status_enum` | NOT NULL, default `draft`; `draft`, `processing`, `ready`, `error` | TD-09; `ready` does not publish the video |
| failure_reason | text | Nullable; CHECK NULL or `invalid_media`, `processing_failed`, `upload_expired` | TD-09 safe API-visible failure codes; no raw tool/storage messages |
| original_key | text | NOT NULL | TD-03 Note: `videos/{videoId}/original`, where `videoId` is `videos.id` |
| thumbnail_key | text | Nullable until successful processing | TD-03 Note: `videos/{videoId}/thumbnail.jpg` |
| original_filename | text | NOT NULL | TD-08 download filename; stored as metadata, never used to construct a storage key |
| content_type | text | NOT NULL | Original declared MIME under TD-11/TD-12; not evidence of playable media |
| declared_size | bigint | NOT NULL, CHECK `1 <= declared_size <= 10737418240` | TD-12 Note: 10 GiB; a 32-bit integer cannot hold the limit |
| duration | double precision | Nullable until successful processing; CHECK NULL or finite and strictly positive | TD-05/TD-06; seconds from validated ffprobe output |
| metadata | jsonb | Nullable until successful processing | TD-05/TD-06: detected container/codec metadata, validated before persistence |
| processing_attempts | integer | NOT NULL, default `0`, CHECK `0 <= processing_attempts <= 3` | TD-09 attempts tracked separately; durable retry budget for TD-10 recovery |
| created_at | timestamp without time zone | NOT NULL, default `now()` | Existing migrations and `@CreateDateColumn`; stored/interpreted as UTC |
| updated_at | timestamp without time zone | NOT NULL, default `now()`, maintained on updates | Existing `@UpdateDateColumn`; processing scan in TD-10 |

**Relations:** `Video` → `Channel` (many-to-one, explicit `channel_id`); `Channel` → videos (one-to-many). `Video` ↔ `UploadSession` (one-to-one, owned by `upload_sessions.video_id`). Entity classes remain in their own domains, following the root single-responsibility convention.

**Indexes:** UNIQUE `(public_id)` for ID reservation and lookup (TD-07); `(channel_id, created_at, id)` for own-video retrieval (TD-11); `(status, updated_at)` for the reconciler's processing-intent scan (TD-10). Existing UNIQUE `channels(user_id)` supports ownership lookup. Primary and unique constraints already supply their corresponding indexes.

**Public-ID insertion:** Generate 9 random bytes with native `node:crypto`, encode as base64url, and attempt insertion at most three times, retrying only a violation of the public-ID UNIQUE constraint. Each failed transactional attempt must roll back before retry (or use a valid savepoint); do not continue querying a PostgreSQL transaction already aborted by a unique violation. Exhaustion returns the cataloged 500-class failure without overwriting another video (TD-07 and inherited TypeORM transaction conventions).

**Consistency constraints:** `ready` requires `thumbnail_key`, `duration`, and `metadata` to be non-NULL and `failure_reason` to be NULL; the worker also verifies the original object before this transition. Other statuses cannot expose partial processing as readiness. Terminal processing writes are conditional on `status = 'processing'` and must inspect affected rows (TD-06, TD-09, TD-10). `metadata` is a validated object containing detected format/container and video codec information; there is no approved fixed ffprobe JSON schema, so additional metadata keys are not mandatory API fields.

**Type boundary:** PostgreSQL `bigint` values are read as decimal strings by the ORM/driver boundary; explicitly convert and range-check `declared_size` before exposing it as a JSON integer. All accepted sizes are safely below `Number.MAX_SAFE_INTEGER`. Dates are serialized as ISO-8601 UTC strings. These conversions preserve TD-12's exact byte limit rather than using floating-point GB calculations.

#### UploadSession — `upload_sessions`

| Column | PostgreSQL type | Constraints / default | Source and meaning |
|--------|-----------------|-----------------------|--------------------|
| id | uuid | PK, generated with `uuid_generate_v4()` | Existing ID convention; server-owned session identity under TD-11 |
| video_id | uuid | NOT NULL, UNIQUE, FK → `videos.id`, ON DELETE/UPDATE NO ACTION | TD-11 Note: exactly one session per video; no replacement session |
| upload_id | text | NOT NULL | S3 `UploadId` returned by `CreateMultipartUpload`; never accepted as authority from a client |
| status | enum `upload_sessions_status_enum` | NOT NULL, default `active`; `active`, `completed`, `aborted`, `expired` | TD-11 completion/abort and TD-10/TD-11 Revisions' `active` → `completed` / `expired` transitions |
| part_size | integer | NOT NULL, CHECK `part_size > 0` | TD-12 Note and review R1: the videos-domain constant supplies the server-defined 64 MiB value |
| expires_at | timestamp without time zone | NOT NULL | TD-12 Note: creation time + 24 hours; fixed session window |
| created_at | timestamp without time zone | NOT NULL, default `now()` | Existing convention; expiry calculation |
| updated_at | timestamp without time zone | NOT NULL, default `now()`, maintained on updates | Existing convention; session transition bookkeeping |

**Relations:** `UploadSession` → `Video` (one-to-one, explicit `video_id` and `@JoinColumn`). Bucket selection is environment configuration; the key and declared size come from the related video. No duplicate owner, object-key, declared-size, or signed-URL fields are needed in this table. Uploaded part numbers, sizes, and ETags are reconciled from paginated S3 `ListParts`, not from a second persisted part inventory (TD-02, TD-11).

**Indexes:** UNIQUE `(video_id)` enforces one session per video; `(status, expires_at)` supports the expired-active-session scan in TD-10's Revision. A caller-supplied session ID is only a lookup key; authorization always joins through video → channel → `user_id`.

**Transactional invariants:** Create the draft and its session together using one transactional EntityManager. An initiation failure after S3 allocation must abort that allocation rather than leave an acknowledged partial pair. Completion, abort, and expiry serialize on the session row; completion/reconciliation use `SELECT … FOR UPDATE` and transition only from `active`. Session `completed` and video `processing` commit together, before queue publication. No SQL transaction spans a video-byte transfer. Short, idempotent S3 control calls are re-checked under the lock as required by the TD-10/TD-11 Revisions. Retain public-ID reservation; this phase provides no deletion or reprocessing operation (TD-07 Note, TD-10/B, TD-11/A).

**Migration:** One migration, `nestjs-project/src/database/migrations/{timestamp}-CreateVideosAndUploadSessions.ts`, class and `name` = `CreateVideosAndUploadSessions{timestamp}`. `{timestamp}` is the actual 13-digit TypeORM generation timestamp, greater than `1777579850478`; it is not fabricated at planning time. This follows `1775687773260-CreateUsersAndChannels.ts` and `1777579850478-CreateAuthTokens.ts`. `up()` creates enums, tables, checks, indexes, and foreign keys; `down()` reverses them in dependency order, dropping `upload_sessions` before `videos` and then their enum types. Keep `synchronize: false` and the existing CLI data-source pattern. No outbox, generation, lease, or replacement-session table is introduced (TD-10/B and the resolved TD-11 parameters).

---

### API Contracts

These new control-plane routes and DTO names materialize the initiation, signing, resumption, completion, abort, retrieval, and access operations in `phase-03-videos/TD-02`, `TD-08`, and `TD-11`. Plural resource paths and HTTP methods follow `nestjs-project/AGENTS.md` REST conventions; wire fields retain the backend's snake_case convention. No pre-existing video controller is implied by these derived contracts.

**Common request headers:** `Authorization: Bearer <access_token>` on every route; `Content-Type: application/json` when a JSON body is present. The existing `APP_GUARD` registration supplies `JwtAuthGuard`; video routes do not use `@Public()`. Take identity from `JwtPayload.sub` via `@CurrentUser()`. The signed storage URL itself is subsequently a bearer credential (TD-08); storage PUT/GET requests are not Nest endpoints.

**Shared response DTOs:**

| DTO | Shape | Source |
|-----|-------|--------|
| `VideoResponseDto` | `{ id: string(uuid), public_id: string, channel_id: string(uuid), title: string, status: 'draft' \| 'processing' \| 'ready' \| 'error', failure_reason: 'invalid_media' \| 'processing_failed' \| 'upload_expired' \| null, original_filename: string, content_type: string, declared_size: number(integer), duration: number \| null, metadata: Record<string, unknown> \| null, created_at: string(date-time), updated_at: string(date-time) }` | Data Model; TD-06 metadata, TD-07 public identity, TD-09 state |
| `UploadSessionResponseDto` | `{ id: string(uuid), status: 'active' \| 'completed' \| 'aborted' \| 'expired', part_size: number(integer), total_parts: number(integer), expires_at: string(date-time) }` | TD-11/TD-12; `total_parts = ceil(declared_size / part_size)`, at most 160 |
| `UploadedPartDto` | `{ part_number: number(integer), etag: string, size: number(integer) }` | TD-11/TD-12: verified S3 `PartNumber`, `ETag`, and `Size`; preserve ETag value for completion |
| `SignedUrlResponseDto` | `{ url: string(uri), expires_at: string(date-time) }` | TD-08: renewable, expiring access; no signed URL persisted in the video row |

Serialize explicitly rather than returning ORM entities. Object keys, bucket credentials, S3 `UploadId`, internal URLs, processing diagnostics, and attempt bookkeeping are not response fields; this follows TD-11's server-owned storage references and TD-09's safe failure policy. The stable backend lookup is `/videos/{public_id}`; an expiring object URL is never the video's identity (TD-03/TD-07). No frontend watch route is selected in this backend-only phase.

#### POST /videos/uploads

**Request headers:** Common headers above.

**Request body:** `StartVideoUploadDto` = `{ title: string, original_filename: string, content_type: string, declared_size: number(integer) }`; all required. Strings must be non-empty; size is `1..10737418240`. Resolve the caller's channel through `channels.user_id = user.sub`; do not accept ownership, bucket, key, public ID, or `UploadId` fields.

**Response 201:** `StartVideoUploadResponseDto` = `{ video: VideoResponseDto, upload_session: UploadSessionResponseDto }`, with video `draft`, session `active`, server-defined 64 MiB parts, and a 24-hour deadline. Draft and session become durable together. Allocate one S3 multipart upload at the immutable original key, storing the returned `UploadId`; compensate an initiation failure with abort. Each successful call creates a new video/session pair; initiation idempotency keys and session replacement are outside the approved TD-11/A parameters.

**Error responses:** 400 `VALIDATION_ERROR`; 401 from the inherited guard; 404 `CHANNEL_NOT_FOUND`; 500 `VIDEO_ID_ALLOCATION_FAILED` after three public-ID insert attempts; 503 `STORAGE_UNAVAILABLE`; inherited 429 if the global throttler rejects the request.

**OpenAPI notes:** Explicit operation, JSON request model, 201 response model, documented errors, and bearer security. Describe 10 GiB as exactly `10737418240` bytes with `format: int64`; this endpoint accepts JSON, not `multipart/form-data`. Sources: TD-02, TD-07, TD-11, TD-12.

---

#### POST /videos/:publicId/upload/parts

**Request headers:** Common headers above.

**Request body:** `SignUploadPartsDto` = `{ part_numbers: number(integer)[] }`, non-empty and unique; every number must be within `1..total_parts`, with no more than 160 entries. `publicId` is the immutable 12-character base64url path parameter.

**Response 200:** `SignUploadPartsResponseDto` = `{ parts: Array<{ part_number: number(integer), url: string(uri), expires_at: string(date-time) }> }`. Sign `UploadPartCommand` against the public storage endpoint only after owner and active-session/deadline checks. Each URL lasts at most 900 seconds, bounded by the remaining session window. Re-sign missing parts while the same session is active. Client PUT bodies go directly to storage; retain returned ETags for completion.

**Error responses:** 400 `VALIDATION_ERROR`; 401; 404 `VIDEO_NOT_FOUND`; 409 `UPLOAD_NOT_ACTIVE` or `UPLOAD_PARTS_INVALID`; 503 `STORAGE_UNAVAILABLE`; inherited 429.

**OpenAPI notes:** Explicit path schema, body array item/min/max/uniqueness constraints, nested response DTO, and 200 override for Nest's POST default. Document direct PUT, expiry, and required signed headers if any; never rewrite a signed hostname. Sources: TD-02, TD-08, TD-11, TD-12.

---

#### GET /videos/:publicId/upload/parts

**Request headers:** `Authorization` as above. **Request body/query parameters:** None.

**Response 200:** `ListUploadedPartsResponseDto` = `{ upload_session: UploadSessionResponseDto, parts: UploadedPartDto[] }`. For an active, unexpired owner session, exhaust all S3 `ListParts` pages and return uploaded parts ordered by part number, including their actual ETags and sizes. At most 160 expected parts makes the response bounded. Clients derive missing numbers from `total_parts`; no client-supplied bucket/key/upload ID or S3 continuation token is accepted.

**Error responses:** 400 `VALIDATION_ERROR` for malformed `publicId`; 401; 404 `VIDEO_NOT_FOUND`; 409 `UPLOAD_NOT_ACTIVE`; 503 `STORAGE_UNAVAILABLE`; inherited 429. After completion, use video retrieval to inspect processing status rather than treating S3 `NoSuchUpload` as an empty resumable upload.

**OpenAPI notes:** Describe the aggregate response and resumption procedure; this is one API response even when S3 pagination requires several calls. Sources: TD-02, TD-11, TD-12.

---

#### POST /videos/:publicId/upload/complete

**Request headers:** Common headers above.

**Request body:** `CompleteVideoUploadDto` = `{ parts: Array<{ part_number: number(integer), etag: string }> }`; required non-empty array of unique part numbers, at most 160 entries. Require all expected numbers and cross-check their ETags and exact expected sizes against paginated S3 `ListParts`; completion uses the verified sorted inventory, not unchecked client assertions.

**Response 202:** `VideoResponseDto`. Resolve the owner and serialize on the session row. For active, unexpired uploads, validate parts, call `CompleteMultipartUpload`, then verify `HeadObject.ContentLength = declared_size`. Commit session `completed` and video `processing` atomically; enqueue only after commit. An existing completed session returns its current video representation without creating another job or regressing a terminal state. A lost S3 response is recovered through `HeadObject` on the known key before assuming the upload is absent. Queue unavailability after the durable commit leaves recoverable `processing` intent; it does not roll back S3/DB completion (TD-10/B). Per review R4, the producer fails promptly when Redis is down, completion still returns 202, and a bounded log line records deferred enqueue for the reconciler.

If the active session deadline has passed, apply the same HeadObject-based decision as the reconciler: a matching completed object is recovered; a mismatching object is deleted and the session expires; no object triggers abort and expiry. Do not complete an unfinished multipart upload after the deadline. Storage verification/cleanup failures leave the transition pending for retry rather than acknowledging cleanup that did not happen. These rules implement the latest TD-10/TD-11 Revisions.

**Error responses:** 400 `VALIDATION_ERROR`; 401; 404 `VIDEO_NOT_FOUND`; 409 `UPLOAD_NOT_ACTIVE`, `UPLOAD_PARTS_INVALID`, or `UPLOAD_SIZE_MISMATCH`; 503 `STORAGE_UNAVAILABLE`; inherited 429. A final-size mismatch rejects processing and performs the TD-12 abort/delete and error transition. The safe persisted reason is `processing_failed` for a pre-expiry validation failure, or `upload_expired` for the Revision's expiry decision; detailed size diagnostics stay internal (TD-09's three-code allowlist).

**OpenAPI notes:** Explicit 202 override, asynchronous processing description, complete response DTO and repeated-completion behavior; 202 confirms durable processing intent, not readiness. Sources: TD-02, TD-09, TD-10/B Revision, TD-11/A Revision, TD-12.

---

#### POST /videos/:publicId/upload/abort

**Request headers:** Common headers above. **Request body/query parameters:** None.

**Response 204:** No content. For an active owner session, serialize with completion/expiry, abort the known multipart upload, and mark the session `aborted`; `NoSuchUpload` alone is not proof that completion failed, so inspect the known object before deciding. Already-aborted/expired sessions are idempotent no-ops. A verified completed object follows the common completion/recovery path and cannot be discarded by abort. A completed session returns 409.

The draft identity is retained for owner retrieval; voluntary abort closes its only session and does not create a new failure-reason value. The video remains `draft`, without a resumable active upload. This is the minimal abort projection of TD-11/A's single-session boundary and TD-09's safe failure-code allowlist; automatic expiry continues to use `error` / `upload_expired` as explicitly revised.

**Error responses:** 400 `VALIDATION_ERROR` for malformed `publicId`; 401; 404 `VIDEO_NOT_FOUND`; 409 `UPLOAD_NOT_ACTIVE` if completion already won; 503 `STORAGE_UNAVAILABLE`; inherited 429.

**OpenAPI notes:** Explicit 204 override with no response schema/body; describe idempotent abort and the completion race. Sources: TD-11 ownership/abort, TD-10/TD-11 completion serialization, TD-12 cleanup.

---

#### GET /videos/:publicId

**Request headers:** `Authorization` as above. **Request body/query parameters:** None.

**Response 200:** `OwnVideoResponseDto` = `{ video: VideoResponseDto, upload_session: UploadSessionResponseDto }`, found by public ID and the caller's channel ownership. All four lifecycle states are readable by their owner; processing results remain nullable until ready. Session state/deadline make resumption and voluntary abort distinguishable.

**Error responses:** 400 `VALIDATION_ERROR` for malformed `publicId`; 401; 404 `VIDEO_NOT_FOUND`; inherited 429.

**OpenAPI notes:** Document nullable metadata/duration/failure fields, enum values, and the immutable public ID separately from the internal UUID. Sources: TD-07, TD-09, TD-11.

---

#### GET /videos

**Request headers:** `Authorization` as above. **Request body/query parameters:** None.

**Response 200:** `VideoResponseDto[]`, containing only videos whose channel has `user_id = user.sub`, ordered by `created_at DESC, id DESC`; `[]` when none exist. A private owner listing is the retrieval projection of TD-11; public discovery, publishing, filtering, and editing are outside this phase's scope.

**Error responses:** 401; inherited 429.

**OpenAPI notes:** Explicit response array schema and owner-only description. No pagination parameters or limits were selected by the supplied decisions, so this contract does not invent them. Sources: TD-11 and `context.md` Scope/boundary with Phase 04.

---

#### GET /videos/:publicId/playback-url

**Request headers:** `Authorization` as above. **Request body/query parameters:** None.

**Response 200:** `SignedUrlResponseDto`, only after owner and `ready` checks. Sign `GetObjectCommand` for the original key against the public endpoint with inline `ResponseContentDisposition` and the configured playback TTL. The storage serves byte ranges and seeking without an API proxy or fixed signed Range. Renew through the same authorized endpoint. Browser codec support depends on the original format; detected container/codec metadata is available from video retrieval.

**Error responses:** 400 `VALIDATION_ERROR`; 401; 404 `VIDEO_NOT_FOUND`; 409 `VIDEO_NOT_READY`; 503 `STORAGE_UNAVAILABLE`; inherited 429.

**OpenAPI notes:** JSON response, not a redirect or binary body; describe URL bearer semantics, configurable expiry, and storage Range support. Sources: TD-03, TD-06/D, TD-08.

---

#### GET /videos/:publicId/download-url

**Request headers:** `Authorization` as above. **Request body/query parameters:** None.

**Response 200:** `SignedUrlResponseDto`, only after owner and `ready` checks. Sign the original object's GET with the configured download TTL and `ResponseContentDisposition` = attachment using the sanitized `original_filename`. Strip path components/control characters and escape the header filename; never interpolate raw input into a response header or object key.

**Error responses:** 400 `VALIDATION_ERROR`; 401; 404 `VIDEO_NOT_FOUND`; 409 `VIDEO_NOT_READY`; 503 `STORAGE_UNAVAILABLE`; inherited 429.

**OpenAPI notes:** JSON URL response with explicit expiry, attachment behavior, and original-file delivery; no normalized derivative is promised. Source: TD-08 and TD-06/D.

#### Validation Rules — Video Control Plane

- Use the inherited global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`. Body/query DTOs use the existing class-validator/class-transformer stack; bind a validated path DTO for the public-ID pattern so malformed parameters also use the inherited 400 envelope (`src/main.ts`, `phase-02-auth/TD-06`).
- A non-empty title, original filename, and declared content type are control metadata, not media validity checks. The accepted byte limit, part count, and exact expected part sizes come from TD-12: every non-final part is 64 MiB and the final part is the positive remainder (64 MiB for an exact multiple). Do not impose a new container/codec/MIME allowlist; validate at least one video stream and a finite positive duration through ffprobe under TD-06/D.
- Signing/completion checks combine syntactic validation with server-derived session rules. Complete only a contiguous expected inventory; reject duplicate/out-of-range parts, missing ETags, unexpected sizes, and mismatched client ETags. Never trust a declared MIME/size in place of `ListParts`/`HeadObject` verification (TD-11/TD-12).
- Enrich generated OpenAPI with explicit `@ApiOperation`, status-specific `@ApiResponse`, body/path schemas, examples, nested DTOs/extra models, and `@ApiBearerAuth('access-token')`. The CLI plugin's `classValidatorShim` infers DTO properties, not complete endpoint contracts. Reuse `ApiErrorEnvelope` for domain and validation responses; document the guard's actual 401 shape separately. Preserve opt-in Swagger UI and committed offline export through `npm run openapi:export` (`openapi-docs-nestjs/TD-01` Revision, `TD-02`, `TD-03`; existing controller/export code).

---

### Authorization Matrix

| Endpoint | Anonymous | Authenticated non-owner | Owner | Additional condition |
|----------|-----------|-------------------------|-------|----------------------|
| POST /videos/uploads | ✗ 401 | Cannot nominate another channel | ✓ | Resolve own channel by `channel.user_id = user.sub` |
| POST /videos/:publicId/upload/parts | ✗ 401 | ✗ 404 | ✓ | Session active and unexpired; requested parts valid |
| GET /videos/:publicId/upload/parts | ✗ 401 | ✗ 404 | ✓ | Session active and unexpired |
| POST /videos/:publicId/upload/complete | ✗ 401 | ✗ 404 | ✓ | Active session or idempotent completed-session result; deadline recovery as specified |
| POST /videos/:publicId/upload/abort | ✗ 401 | ✗ 404 | ✓ | Active session; repeated aborted/expired request is a no-op; completed is a conflict |
| GET /videos/:publicId | ✗ 401 | ✗ 404 | ✓ | All lifecycle states, scoped by channel ownership |
| GET /videos | ✗ 401 | Only own rows | Only own rows | Query always joins/restricts to `channel.user_id = user.sub` |
| GET /videos/:publicId/playback-url | ✗ 401 | ✗ 404 | ✓ | Video `ready` |
| GET /videos/:publicId/download-url | ✗ 401 | ✗ 404 | ✓ | Video `ready` |

**Source:** `phase-03-videos/TD-08` and `TD-11/A`; authentication from the actual global custom guard (`src/auth/auth.module.ts`, `src/auth/guards/jwt-auth.guard.ts`), as clarified by the inherited `phase-02-auth/TD-02` Note. Apply ownership in domain services through a video/channel lookup scoped to `user.sub`; 404 is the derived result of that lookup for both a missing video and a video outside the caller's scope. Controllers delegate authorization and business rules to services. A 12-character public ID, session ID, S3 ETag, key, or upload ID is never an authorization grant. The worker uses server-side database/storage references, not client-supplied authority.

Possession of a previously issued signed URL authorizes direct storage access until expiry; the storage cannot consult a subsequent JWT state change. JWT/owner checks apply when obtaining or renewing that URL. `ready` does not make a draft publicly accessible (TD-08).

---

### Error Catalog

**Inherited domain response format:** `{ statusCode: number, error: string, message: string }`. New service exceptions extend the existing `DomainException(errorCode, httpStatus, message)`; the unchanged `DomainExceptionFilter` maps those properties directly. Class names and uppercase codes below are the HTTP projection of the cited failure conditions, not new processing-status values (`phase-02-auth/TD-07`; existing `src/common/exceptions/domain.exception.ts` and `src/common/filters/domain-exception.filter.ts`).

**Validation response:** `{ statusCode: 400, error: 'VALIDATION_ERROR', message: string[] }`, through the existing `ValidationExceptionFilter`.

**Authentication response:** The existing custom JWT guard throws native `UnauthorizedException()`, whose installed NestJS response is `{ message: 'Unauthorized', statusCode: 401 }`. It is not caught by `DomainExceptionFilter`; do not document a fabricated `INVALID_TOKEN` domain code or change authentication in this phase. The existing global throttler can likewise return a native 429 response. `ApiErrorEnvelope.code` is optional schema compatibility, not a field emitted by the domain filter.

| Exception / origin | Code | HTTP | Safe message | Trigger / source |
|--------------------|------|------|--------------|------------------|
| ValidationPipe / ValidationExceptionFilter | VALIDATION_ERROR | 400 | Array of field validation messages | Invalid control DTO/path, unknown fields, declared size outside allowed range; inherited validation + TD-12 |
| JwtAuthGuard | Native Unauthorized response | 401 | Unauthorized | Missing, invalid, or expired access token; existing guard |
| ChannelNotFoundException | CHANNEL_NOT_FOUND | 404 | Channel not found | No channel for authenticated upload initiator; TD-11 channel ownership |
| VideoNotFoundException | VIDEO_NOT_FOUND | 404 | Video not found | Owner-scoped video lookup has no result; TD-08/TD-11 |
| UploadNotActiveException | UPLOAD_NOT_ACTIVE | 409 | Upload session is not active | Signing/resume after completion/abort/expiry, completion of an aborted/expired session, or abort after completion; TD-11/TD-12; completed-session completion is idempotent |
| UploadPartsInvalidException | UPLOAD_PARTS_INVALID | 409 | Uploaded parts do not match the expected upload | Syntactically valid part manifest disagrees with server part count, S3 ETags/sizes, or contiguous inventory; TD-11/TD-12 |
| UploadSizeMismatchException | UPLOAD_SIZE_MISMATCH | 409 | Uploaded size does not match the declared size | Completed object's HeadObject length mismatch; cleanup and terminal error follow TD-12 / TD-10 Revision |
| VideoNotReadyException | VIDEO_NOT_READY | 409 | Video is not ready | Playback/download requested before `ready`, including `error`; TD-08/TD-09 |
| VideoIdAllocationFailedException | VIDEO_ID_ALLOCATION_FAILED | 500 | Video identifier could not be allocated | Three total insert attempts fail specifically on public-ID UNIQUE violations; TD-07 |
| StorageUnavailableException | STORAGE_UNAVAILABLE | 503 | Storage is temporarily unavailable | Transient S3 control/signing failure before durable acknowledgment; TD-02/TD-11 failure recovery; preserve cause internally |
| Existing ThrottlerGuard | Native throttler response | 429 | Existing throttler message | Existing global guard limit; no new video rate-limit policy |

Do not map arbitrary database/programming errors to a fabricated domain success or a storage error. Unexpected failures propagate to the existing Nest error handling. A failure to enqueue after the completion commit is a recoverable durable intent, not an HTTP claim that the upload was rolled back (TD-10/B).

**Persisted processing failure reasons are distinct from HTTP codes:**

| `failure_reason` | Lifecycle effect | Retry / recovery policy | Source |
|------------------|------------------|-------------------------|--------|
| `invalid_media` | `processing` → `error` | Terminal `UnrecoverableError`: ffprobe cannot validate a video stream and finite positive duration; incompatible/unsupported media under the accepted probe policy. Browser codec incompatibility alone does not qualify | TD-06/D, TD-09 |
| `processing_failed` | `processing` → `error` after retry exhaustion; draft validation failure → `error` when TD-12 rejects a completed wrong-size object before expiry | Three total processing attempts for transient failures; terminal repair if the queue failed without updating the row. No processing job for a rejected upload | TD-09 allowlist, TD-10/B, TD-12 |
| `upload_expired` | Active session → `expired`, video `draft` → `error` | At the expiry decision, no completed matching object exists: abort the incomplete upload or delete the mismatching object. A matching completed object instead becomes `processing` | TD-10/TD-11 Revisions, TD-12 |

Worker failures do not produce a delayed HTTP error response to a completed request. Owners observe these safe codes through retrieval; bounded internal diagnostics must omit credentials, presigned query strings, and unbounded FFmpeg output (TD-05 controlled URLs and TD-09 diagnostics policy).

---

### Events/Messages

#### `process-video`

**Queue names:** `video-processing` in development/normal operation; `video-processing-test` in tests, selected through the queue configuration. These identifiers materialize TD-01's one pipeline and the isolated test queue specified in `context.md`'s resolved parameters; the runtime contract comes from Backend TD-01/TD-04/TD-10.

**Job name:** `process-video`. **Payload schema:**

```json
{ "videoId": "uuid" }
```

`videoId` is the internal `videos.id`, required and validated. The `{ videoId }` shape is already captured in `library-refs.md` under BullMQ. Resolve channel, status, original key, and other processing data from the database; do not carry user-controlled URLs, credentials, bucket/key overrides, source generations, or binary video data in a job (TD-03/TD-05/TD-10/TD-11).

**jobId:** `video-${videoId}`; for example, `video-550e8400-e29b-41d4-a716-446655440000`. It is deterministic per video and contains no `:`. Development and test isolation is by queue name. This is the concrete spelling of TD-10/B's deterministic-per-video requirement and the BullMQ delimiter constraint recorded in `library-refs.md`.

**Producer:** The completion application service, after the transaction committing session `completed` and video `processing`; the reconciler may publish the same job for recovered or missing intent (TD-10/B and Revisions).

**Consumer:** Worker-only processor registered with `@Processor(queueName, { concurrency: 1 })`, extending `WorkerHost`. The standalone worker imports only required domain/storage/database/queue modules, starts through `NestFactory.createApplicationContext`, and opens no HTTP listener. The API registers a producer, not a processing consumer (TD-01/TD-04).

**Delivery semantics:** At least once. Queue deduplication is not sufficient after removal or Redis loss; the database row and conditional writes are authoritative. Load the row before media work; a non-`processing` row is an idempotent no-op. Deterministic thumbnail writes and a final `UPDATE … WHERE status = 'processing'` prevent a redelivery from regressing a ready/error row. Inspect affected rows (TD-03/TD-09/TD-10/B).

**Attempts/backoff:** Three total executions: one initial execution and at most two retries. For a new intent use `attempts: 3` and `backoff: { type: 'exponential', delay: configuredDelayMs }`. The base delay is required configuration with no decision-backed numeric default; the two retry waits are `D` and `2D`. Persist `processing_attempts` as executions begin and preserve it across recovered jobs; a missing job is recreated with only its remaining budget, never three fresh attempts. Retain terminal job evidence until the row's terminal update is durable; do not auto-remove failed work before reconciliation. These rules implement TD-09's finite attempts and TD-10's repair after missed callbacks. The Context7 example's prose about three retry waits is inapplicable to three total attempts, as already recorded in the cache.

Reserve an execution through an atomic conditional increment with `status = 'processing' AND processing_attempts < 3`, checking affected rows before spawning media tools. A crash does not reset the durable counter, and a late callback cannot overwrite a terminal row. This enforces the existing finite budget across redelivery without introducing the lease/generation machinery excluded by the resolved TD-10/B parameters.

**UnrecoverableError cases:** Media that ffprobe cannot parse into at least one video stream and a finite positive duration, including unsupported/invalid input under TD-06/D; media requiring prohibited external/protocol references under TD-05's controlled-access policy also cannot be processed by the approved pipeline. Persist `error` / `invalid_media` and throw `UnrecoverableError('invalid_media')`, bypassing remaining retries. Browser playback codec support alone is not an unrecoverable worker failure. Transient storage/network/subprocess failures use ordinary errors and the remaining retry budget, ultimately persisting `processing_failed` (TD-05, TD-06/D, TD-09).

**Processing sequence:** Obtain an internal presigned GET only for the known original object; run asynchronous, shell-free ffprobe with JSON output; validate duration and detected container/video codec metadata; choose an in-duration frame with a start-frame fallback for short clips; extract one JPEG with input seeking; write `videos/{videoId}/thumbnail.jpg`; verify the original and persist duration/metadata/thumbnail plus `ready` conditionally. Use HTTP Range access rather than full local staging. Restrict subprocess protocols and embedded references to the controlled storage access; apply configured timeouts and terminate children during shutdown. No transcoding, remuxing, normalized playback derivative, wrapper package, or generation-based reprocessing is selected (TD-03/TD-04/TD-05/TD-06/D and resolved parameters).

#### Reconciler schedule and state transitions

**Schedule:** A periodic service in the standalone worker runs every configured positive `VIDEO_RECONCILE_INTERVAL_MS`. The decisions require periodic reconciliation but specify no interval or cron expression; the env contract therefore requires an explicit value with no invented default. Use a lifecycle-owned native timer, prevent overlapping ticks in one process, and clear it during shutdown; no scheduler package was selected. Short row locks and conditional transitions resolve races with API completion/abort (TD-04, TD-10/B, TD-10/TD-11 Revisions).

| Observed state | Verification / action | Durable transition and queue effect | Source |
|----------------|-----------------------|-------------------------------------|--------|
| Session `active`, deadline still in the future | Leave available for part uploads, resumption, and API completion | No transition | TD-11/TD-12 |
| Session `active`, `expires_at` passed, known object exists with matching `ContentLength` | Lock/re-check session, verify known object under the short completion transaction | Session `completed` + video `processing` in one commit; then enqueue deterministic job | TD-10/TD-11 Revisions: recovery even without a client retry |
| Session `active`, deadline passed, known object has wrong length | Delete the known object; re-check/serialize session state | Session `expired` + video `error` / `upload_expired`; no job | TD-10/TD-11 Revisions |
| Session `active`, deadline passed, no completed object | Abort the known multipart upload; `NoSuchUpload` means already aborted after object reconciliation | Session `expired` + video `error` / `upload_expired`; no job | TD-10/TD-11 Revisions |
| Session already `completed`, `aborted`, or `expired` | Do not re-decide it | No session transition | Revision's transition-only-from-`active` rule |
| Video `processing`, deterministic job waiting/active/delayed (or another live BullMQ state) | Preserve live work and its retry delay | No duplicate enqueue or terminal update | TD-10/B; cached `getJob` / `getState` guidance |
| Video `processing`, no live job, remaining durable attempt budget | Inspect/remove a retained completed job if necessary before adding the same ID; never remove an active job | Re-enqueue the missing intent with remaining attempts; video stays `processing` | TD-10/B, TD-09 |
| Video `processing`, retained job failed permanently | Read allowlisted terminal reason; repair a missing DB failure update | Video `error`, safe `invalid_media` or `processing_failed`; no retry | TD-09/TD-10/B |
| Video `processing`, no live job and three durable attempts consumed | Treat the budget as exhausted even if Redis lost job history | Video `error` / `processing_failed`; no fresh budget | TD-09/TD-10/B |
| Video `ready` or `error`, stale/delivered job exists | Processor/status predicate declines a new result | No regression or new processing generation | TD-09/TD-10/B |
| S3/Redis inspection fails transiently | Log bounded diagnostics and retry a later tick; do not interpret an unavailable dependency as an absent object/job | Preserve the undecided state | TD-09 transient policy and TD-10 consistency recovery |

Both API completion and expiry recovery use the upload-session `SELECT … FOR UPDATE` lock, check `active` again, and commit the session/video pair exactly once. S3 control calls are re-checked under that lock, with bounded timeouts; no database lock spans the actual upload or a full video transfer. A crash after S3 completion but before DB commit is repaired by the expired-active-session branch; a crash after the DB commit but before enqueue is repaired by the processing-intent branch. Permanently failed jobs are classified before considering reenqueuing; adding a job with the ID of a retained terminal job is not assumed to create new work. These are separate failure windows addressed by TD-10/B and its Revision.

---

### Infrastructure

#### Configuration and environment contract

The keys below normalize the storage, queue, upload, and worker settings required by Backend TD-01/TD-03/TD-04/TD-05/TD-08/TD-09/TD-10/TD-12 into the existing configuration pattern. They are new configuration names derived in this plan, not existing environment variables. Use namespaced `registerAs()` factories in `src/config/`, inject `ConfigType<typeof factory>` by its key, and extend the central Joi schema. Share the factories between API and standalone worker; retain the existing database namespace and `DB_HOST=db` (`phase-01-configuracao-base/TD-01`–`TD-04`; `src/app.module.ts`, `src/config/env.validation.ts`, `src/database/data-source.ts`).

| Env key | Type / validation | Value or requirement | Source |
|---------|-------------------|----------------------|--------|
| S3_INTERNAL_ENDPOINT | Required HTTP(S) URI | Compose `http://minio:9000`; S3 control calls and worker media reads use this endpoint | TD-03/TD-05/TD-08 |
| S3_PUBLIC_ENDPOINT | Required HTTP(S) URI reachable by URL consumers | Client-facing upload/playback/download signer endpoint; tests set `http://minio:9000` for both endpoints. No hostname replacement after signing | TD-08 Note |
| S3_REGION | Required non-empty string | Deployment supplies the region used in signatures; no selected default | TD-03 and SDK configuration in library cache |
| S3_BUCKET | Required non-empty string | One private bucket per environment; tests supply a separate bucket from development. Same API/worker bucket for one environment | TD-03; context resolved parameters |
| S3_ACCESS_KEY_ID | Required non-empty secret string | Injected storage credential; production credentials are never committed. Review R2 supplies labelled local example credentials | TD-03 and inherited env pattern; review R2 |
| S3_SECRET_ACCESS_KEY | Required non-empty secret string | Credential paired with the access key | TD-03 and inherited env pattern |
| S3_FORCE_PATH_STYLE | Boolean | `true` for MinIO; configurable for production S3 | TD-03 Note |
| S3_CORS_ALLOWED_ORIGINS | Required non-empty origin list for bucket initialization | Deployment supplies actual client origins; no approved wildcard/default | TD-02 direct client PUTs; context storage initialization |
| MINIO_ROOT_USER | Required local-infrastructure secret string | MinIO initialization credential, supplied by the local environment; client configuration must use compatible credentials | Context storage infrastructure and TD-03 |
| MINIO_ROOT_PASSWORD | Required local-infrastructure secret string | Paired initialization credential; no embedded example password | Context storage infrastructure and TD-03 |
| REDIS_HOST | Required hostname | `redis` in Compose | TD-01 and Docker networking convention |
| REDIS_PORT | Integer, valid TCP port | `6379` for the selected Redis service | TD-01; BullMQ connection options in library cache |
| REDIS_USERNAME | Optional string | Only if configured by the deployment | TD-01 connection configuration |
| REDIS_PASSWORD | Optional secret string | Only if configured by the deployment | TD-01 connection configuration |
| REDIS_DB | Non-negative integer | Explicit logical database selection shared by producer/consumer | TD-01 connection configuration |
| VIDEO_PROCESSING_QUEUE | Required non-empty string without `:` | `video-processing`; tests override with `video-processing-test` | Events/Messages; TD-01 and context test isolation |
| VIDEO_PROCESSING_BACKOFF_MS | Required positive integer | Base exponential delay `D`; no approved numeric default | TD-09; library cache explicitly leaves delay configurable |
| VIDEO_RECONCILE_INTERVAL_MS | Required positive integer | Periodic worker timer; no approved numeric default/cron | TD-10/B |
| VIDEO_PLAYBACK_URL_TTL_SECONDS | Required positive integer, within S3 signing limits | Deployment-supplied expiry; no approved numeric default | TD-08 |
| VIDEO_DOWNLOAD_URL_TTL_SECONDS | Required positive integer, within S3 signing limits | Deployment-supplied expiry; no approved numeric default | TD-08 |
| VIDEO_MEDIA_READ_URL_TTL_SECONDS | Required positive integer, within S3 signing limits | Internal worker read expiry; compatible with the configured media operation timeout | TD-05 |
| VIDEO_MEDIA_TIMEOUT_MS | Required positive integer | Bounded ffprobe/ffmpeg execution; no approved numeric default | TD-04/TD-05 |
| VIDEO_WORKER_CPUS | Positive Compose CPU limit | Deployment-supplied; no approved numeric default | TD-04 resource isolation |
| VIDEO_WORKER_MEMORY | Valid Compose memory limit | Deployment-supplied; no approved numeric default | TD-04 resource isolation |

**Fixed videos-domain constants (review R1):** Define `UPLOAD_MAX_BYTES = 10737418240`, `UPLOAD_PART_SIZE_BYTES = 67108864`, `UPLOAD_SESSION_TTL_SECONDS = 86400`, and `UPLOAD_PART_URL_TTL_SECONDS = 900` once in `src/videos/videos.constants.ts`. They are code constants, not env keys. DTO validation and services reference this module; the migration's declared-size CHECK takes its approved range from these constants, while its part-size CHECK is only `part_size > 0`. Keep the generated migration's historical range stable; a future policy change requires a new migration rather than altering an applied migration. The constants are the authority for new sessions and signatures (TD-12 Note; review R1).

The upper limit for presigning also depends on credential expiry; avoid claiming that a configured URL can outlive its signing credentials. Only the part URL lifetime is fixed by the decisions; playback, download, and internal read TTLs must be supplied explicitly. Never use an implicit SDK TTL as an approved product default. Required Joi keys have no schema defaults; the local examples below are usable development values, not schema defaults (review R2).

Use separate S3 clients for internal operations and public signing, sharing the configured bucket/region/credentials. Only the worker receives an internal GET URL; public signing uses the endpoint the client will actually request. All service-to-service hosts use Compose names (`db`, `minio`, `redis`), not loopback. Startup validation must fail on missing required values in the relevant process/test configuration (TD-03/TD-08 and inherited typed configuration).

Configure BullMQ worker Redis connections with `maxRetriesPerRequest: null`; the API producer uses a separate connection with `enableOfflineQueue: false` and bounded request retries so a Redis outage cannot queue a control request indefinitely. Catch the post-commit enqueue failure in the completion application service, emit a bounded safe log line, and return 202 with the durable `processing` intent; the reconciler enqueues later (review R4; TD-10/B). This refines the bounded-producer requirement in `library-refs.md` using the official BullMQ [failing-fast pattern](https://docs.bullmq.io/patterns/failing-fast-when-redis-is-down) and the cached production-settings reference. The documented pattern requires Redis to be available when the queue is instantiated; Compose readiness provides that startup condition, and outage verification must disconnect an established producer. Do not copy the pattern's example 503 response over this plan's post-commit 202 contract. Persist Redis data with AOF and `maxmemory-policy noeviction`. Three total attempts and concurrency 1 are fixed processing parameters, not new deployment tuning choices. Positive delay/interval/timeouts and resource caps above remain required deployment inputs without Joi defaults; review R2 supplies the following local examples.

**Local development values for `nestjs-project/.env.example` (review R2):** Ship this block labelled as local development values, following the existing DB/JWT example convention. The public loopback endpoint is intentionally for host clients; container-to-container operations still use `minio`. Local MinIO example credentials are not production credentials.

```dotenv
# Storage, queue, and worker: local development values (not Joi schema defaults)
S3_INTERNAL_ENDPOINT=http://minio:9000
S3_PUBLIC_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=streamtube-videos
S3_FORCE_PATH_STYLE=true
S3_CORS_ALLOWED_ORIGINS=http://localhost:3001
MINIO_ROOT_USER=streamtube
MINIO_ROOT_PASSWORD=streamtube-minio
S3_ACCESS_KEY_ID=streamtube
S3_SECRET_ACCESS_KEY=streamtube-minio
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_DB=0
VIDEO_PROCESSING_QUEUE=video-processing
VIDEO_PROCESSING_BACKOFF_MS=30000
VIDEO_RECONCILE_INTERVAL_MS=60000
VIDEO_PLAYBACK_URL_TTL_SECONDS=3600
VIDEO_DOWNLOAD_URL_TTL_SECONDS=300
VIDEO_MEDIA_READ_URL_TTL_SECONDS=3600
VIDEO_MEDIA_TIMEOUT_MS=600000
VIDEO_WORKER_CPUS=2
VIDEO_WORKER_MEMORY=2g
```

**Container test configuration (review R3):** Retain `setupFiles: ["dotenv/config"]` in `package.json` and `test/jest-e2e.json`. A shared test helper applies `S3_BUCKET=streamtube-videos-test`, `VIDEO_PROCESSING_QUEUE=video-processing-test`, and `S3_PUBLIC_ENDPOINT=process.env.S3_INTERNAL_ENDPOINT` after dotenv has loaded and before constructing testing modules, evaluating configuration factories, or opening external clients. Restore prior values during teardown. Follow the existing `Test.createTestingModule` and `createTestDataSource` patterns; do not add a separate assumed `.env.test` loading path. `minio-init` creates both named buckets. Tests execute inside `nestjs-api`, so that shared image must contain FFmpeg/ffprobe.

#### Docker Compose and shared image

This tooling contract materializes `phase-03-videos/TD-13` and the existing `nestjs-project/compose.yaml` / `Dockerfile.dev`. Repo-wide TD-13 supplies infrastructure and verification, not an additional runtime API/message contract. Extend the backend Compose project; `next-frontend/` stays deferred.

| Service / image | Configuration and dependency contract | Source |
|-----------------|---------------------------------------|--------|
| `minio` | Pin `pgsty/minio:RELEASE.2026-08-04T00-00-00Z@sha256:b6bfe7239bfc83fb90d31612d9704d86039dd714f7904b3f1ad68f211e602372`; independent PGSTY community fork, not an upstream MinIO, Inc. image. Persist object data; publish host ports `9000:9000` (S3 API for presigned URL clients) and `9001:9001` (console) | Context TD-13 resolved parameters; library cache verified image/provenance; review R2 |
| `minio-init` | One-shot bucket/CORS initializer using the same pinned image's embedded `/usr/bin/mcli`; wait for MinIO readiness, create private `streamtube-videos` and `streamtube-videos-test` buckets idempotently with the configured CORS, and finish successfully before API/worker storage use. No extra unverified mc image | TD-13 and cached init verification; reviews R2/R3 |
| `redis` | Pin `redis:8.2.3-bookworm@sha256:0908d9af26bf9b985e984a40a5eb82eed229b07a3317eee6843832c3cc3a9619`; enable AOF, `noeviction`, persistent data, and a Redis readiness check; do not publish a Redis host port | TD-01 Note; TD-13 and library cache; review R2 |
| `video-worker` | Same backend image/build as API, separate command invoking the standalone worker entrypoint; no HTTP port. Wait for healthy `db`/`redis` and successful `minio-init`. Apply CPU/memory limits, bounded temporary thumbnail/output handling, shutdown hooks, and child-process termination | Backend TD-04/TD-05; TD-13 tooling |
| `nestjs-api` | Preserve existing service and mounts; add storage/Redis config and corresponding infrastructure readiness dependencies. Producer only. Keep the repository's explicit opt-in app-server startup convention | Existing Compose and backend AGENTS.md; TD-01/TD-04/TD-13 |
| Shared API/worker build | Existing `node:25.6.0-slim` base was verified as Debian bookworm. Install `ffmpeg=7:5.1.9-0+deb12u1` (supplies ffmpeg and ffprobe) without recommended packages before returning to the non-root user | TD-04 Note; TD-13 and library cache |

Bucket policy remains private. CORS must permit the configured client's direct upload and Range/GET flow and expose `ETag`/range response information needed by the multipart/streaming contract. Allowed origins are deployment inputs, not a new frontend deployment or a selected wildcard policy. API/worker storage calls use the Compose endpoint, and test URL consumers run inside containers with both endpoints set to that endpoint (TD-02/TD-08/TD-13).

**Dependencies and documentation boundary:** Newly selected exact pins are `@nestjs/bullmq@12.0.0`, `bullmq@5.81.5`, `@aws-sdk/client-s3@3.1156.0`, and `@aws-sdk/s3-request-presigner@3.1156.0`; they are not installed by this planning phase. The checked manifest/lockfile has Nest core `11.1.16`, config `4.0.3`, TypeORM `0.3.28`, Joi `18.1.2`, and pg `8.20.0`. Preserve these installed-library conventions. Context7 offers AWS `v3.1153.0` and TypeORM `0.3.27` rather than the selected/installed patches; BullMQ docs include v6. The cache records these discrepancies and selected-version source cross-checks. Use only the documented shared APIs; no direct ioredis, FFmpeg wrapper, or scheduler dependency was selected (context resolved parameters and `library-refs.md`).

#### Infrastructure and boundary verification

Implementation must test constraints/transactions against real PostgreSQL; multipart/signing/HeadObject/Range/attachment/CORS behavior against the pinned MinIO build; and producer/worker/reconciler behavior against real Redis and FFmpeg. Use a separate bucket and queue, generate small valid/invalid media at test time, and run the processing test consumer independently of the development worker. Unit tests cover branching and deterministic failure injection; configured-module tests verify DI; controller/DTO/guard contracts use HTTP e2e tests, including actual global filters/pipes. Serialize suites sharing the database and close contexts, clients, queues, timers, and child processes (context Testing Requirements; TD-13 and the activated backend testing guide).

Recovery scenarios include lost completion responses; API death between S3 completion and DB commit with no client retry; DB commit followed by enqueue failure; missing Redis jobs; missed terminal row updates; completed/expired/aborted races; invalid media without retries; finite retry exhaustion; and redelivered jobs unable to regress terminal states. A synthetic size declaration alone is insufficient to verify the upper limit. TD-12's acceptance criterion requires a controlled real 10 GiB multipart rehearsal, recording environment, API memory observations, concurrent control requests, and outcome in `progress.md` during implementation. Verify that bytes bypass the API, memory is independent of video size, and control endpoints respond during upload; no unapproved latency SLA is added.

---

## Dependency Map

```text
SI-03.1 (root: pinned dependencies and infrastructure)
SI-03.1                                      -> SI-03.2
SI-03.1 + SI-03.2                            -> SI-03.3
SI-03.2 + SI-03.3                            -> SI-03.4
SI-03.2 + SI-03.3                            -> SI-03.5
SI-03.5                                      -> SI-03.6
SI-03.1 + SI-03.2 + SI-03.3                  -> SI-03.7
SI-03.4 + SI-03.6                            -> SI-03.8
SI-03.8                                      -> SI-03.9
SI-03.4 + SI-03.6                            -> SI-03.10
SI-03.9 + SI-03.10                           -> SI-03.11
SI-03.10 + SI-03.11                          -> SI-03.12
SI-03.4 + SI-03.6 + SI-03.7                  -> SI-03.13
SI-03.11 + SI-03.13                          -> SI-03.14
SI-03.13                                     -> SI-03.15
SI-03.11 + SI-03.15                          -> SI-03.16
SI-03.3 + SI-03.4                            -> SI-03.17
SI-03.6 + SI-03.7 + SI-03.17                 -> SI-03.18
SI-03.13 + SI-03.15 + SI-03.18               -> SI-03.19
SI-03.6                                      -> SI-03.20
SI-03.11 + SI-03.20                          -> SI-03.21
SI-03.9 + SI-03.20                           -> SI-03.22
SI-03.4 + SI-03.20                           -> SI-03.23
SI-03.11 + SI-03.23                          -> SI-03.24
SI-03.11 + SI-03.23                          -> SI-03.25
SI-03.9 + SI-03.11 + SI-03.12 + SI-03.14 +
SI-03.16 + SI-03.19 + SI-03.21 + SI-03.22 +
SI-03.24 + SI-03.25                          -> SI-03.26
SI-03.19 + SI-03.26                          -> SI-03.27
```

---

## Deliverables

- [ ] SI-03.1 — Install Dependencies and Prepare the Shared Infrastructure
- [ ] SI-03.2 — Define Video Constants and Validated Runtime Configuration
- [ ] SI-03.3 — Establish Isolated Video Test Helpers
- [ ] SI-03.4 — Implement Internal and Public S3 Storage Clients
- [ ] SI-03.5 — Create Video and Upload Session Persistence
- [ ] SI-03.6 — Add Owner-Scoped Persistence Services and Domain Errors
- [ ] SI-03.7 — Implement the Queue Producer with Bounded Failure
- [ ] SI-03.8 — Implement Upload Initiation and Public-ID Reservation
- [ ] SI-03.9 — Expose Upload Initiation
- [ ] SI-03.10 — Implement Part Signing and Resumption
- [ ] SI-03.11 — Expose Part URL Signing
- [ ] SI-03.12 — Expose Uploaded-Part Resumption
- [ ] SI-03.13 — Implement Serialized Upload Completion
- [ ] SI-03.14 — Expose Upload Completion
- [ ] SI-03.15 — Implement Abort and Deadline Resolution
- [ ] SI-03.16 — Expose Upload Abort
- [ ] SI-03.17 — Implement Remote Media Inspection and Thumbnail Extraction
- [ ] SI-03.18 — Run the Standalone Video Worker and Processor
- [ ] SI-03.19 — Reconcile Uploads and Processing Intent
- [ ] SI-03.20 — Implement Own-Video Detail and Listing Queries
- [ ] SI-03.21 — Expose Own-Video Detail
- [ ] SI-03.22 — Expose the Own-Video Listing
- [ ] SI-03.23 — Implement Playback and Download URL Authorization
- [ ] SI-03.24 — Expose the Playback URL
- [ ] SI-03.25 — Expose the Download URL
- [ ] SI-03.26 — Regenerate OpenAPI and Document Backend Conventions
- [ ] SI-03.27 — Verify the Full Pipeline and Rehearse a Real 10 GiB Upload

**Full test suites:**

Run backend commands from `nestjs-project/`; all Node/npm execution remains inside `nestjs-api`.

- [ ] Unit and integration suites pass: `docker compose exec -T nestjs-api npm test -- --runInBand`.
- [ ] Full HTTP e2e suite passes: `docker compose exec -T nestjs-api npm run test:e2e -- --runInBand`.
- [ ] TypeScript compiles cleanly: `docker compose exec -T nestjs-api npx tsc --noEmit`.
- [ ] Lint exits successfully with zero errors: `docker compose exec -T nestjs-api npm run lint`.
- [ ] The project builds successfully: `docker compose exec -T nestjs-api npm run build`.
- [ ] The tracked OpenAPI export is regenerated and included in implementation changes: `docker compose exec -T nestjs-api npm run openapi:export`.
- [ ] Canonical documentation and generated AGENTS.md files agree; from the repository root, `node scripts/port-ai-foundation-to-codex.mjs --check` exits successfully after regeneration.
- [ ] The nine endpoint SIs have external HTTP scenarios authored by `/plan-test-specs phase-03-videos` before implementation.
- [ ] The controlled real 10 GiB multipart rehearsal is complete, with environment, API memory observations, concurrent control requests, transferred size, processing result, and outcome recorded in `docs/phases/phase-03-videos/progress.md`.
- [ ] Storage, queue, native media, retry/expiry recovery, and owner-only playback/download contracts pass against the real isolated dependencies; `next-frontend/` remains deferred.
