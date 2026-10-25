# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 15/27 completed

### SI-03.1 — Install Dependencies and Prepare the Shared Infrastructure
- **Status:** completed
- **Tests:** No automated tests (infrastructure SI). Infrastructure acceptance passed: exact dependencies load on Node 25.6.0 / Nest 11.1.16, non-root FFmpeg/ffprobe 5.1.9, private buckets and repeat initialization, allowed/unlisted CORS origins, Redis AOF/noeviction and readiness. Static checks and full suites are recorded with SI-03.3 below.
- **Observations:**
  - Applied the reviewer's Implementation revision 1: retain the exact MinIO image; configure server-wide `MINIO_API_CORS_ALLOW_ORIGIN` from `S3_CORS_ALLOWED_ORIGINS`; remove bucket CORS XML, `mcli cors set`, and the initializer's unused origins variable. This resolves the original 501 blocker without changing pins.
  - `curl -si -X OPTIONS http://localhost:9000/streamtube-videos/cors-check -H 'Origin: http://localhost:3001' -H 'Access-Control-Request-Method: PUT' -H 'Access-Control-Request-Headers: content-type'` returned HTTP 204 with `Access-Control-Allow-Origin: http://localhost:3001`, allowed PUT and content-type. Repeating with `Origin: http://unlisted.example` returned HTTP 204 without any Access-Control-Allow-Origin header, so the browser cannot authorize that origin. `curl -sD - -o /dev/null http://localhost:9000/streamtube-videos/cors-check -H 'Origin: http://localhost:3001'` returned private-object HTTP 403 while exposing Etag, Accept-Ranges, Content-Range, Content-Length and Content-Disposition through Access-Control-Expose-Headers.
  - `docker compose --env-file /tmp/phase-03-videos-infra.env run --rm --no-deps minio-init` succeeded after initial startup. Embedded mcli `anonymous get` confirmed both streamtube-videos and streamtube-videos-test private. Redis `CONFIG GET appendonly maxmemory-policy` returned yes/noeviction, with no Redis host port; PostgreSQL readiness passed. API process inspection showed tail only, and the worker profile stayed inactive.
  - Installed all four exact dependency pins inside nestjs-api; package metadata and CommonJS loading confirm compatibility with Nest 11.1.16 / Node 25.6.0. Context7 version differences match the existing library cache (BullMQ v6 and AWS SDK v3.1153.0); selected-version metadata was checked locally.
  - Docker Buildx requires `BUILDX_CONFIG=/tmp/phase-03-videos-buildx` for writable metadata. `BUILDX_CONFIG=/tmp/phase-03-videos-buildx docker compose --env-file /tmp/phase-03-videos-infra.env up -d --build nestjs-api minio minio-init redis` passed. Temporary interpolation uses the approved local block until SI-03.2 appends it to .env. compose.override.yaml is untouched.
  - npm install reported 43 pre-existing/transitive audit findings (1 low, 15 moderate, 24 high, 3 critical), as confirmed by the reviewer. Remediation is an out-of-scope follow-up; no npm audit fix was run.
  - TaskCreate/TaskUpdate tools are unavailable in this runtime. This progress file provides the persistent checklist for all 27 SIs.

### SI-03.2 — Define Video Constants and Validated Runtime Configuration
- **Status:** completed
- **Tests:** `docker compose exec -T nestjs-api npm test -- --runInBand --forceExit --runTestsByPath src/config/env.validation.integration-spec.ts src/config/video.config.spec.ts` — 57/57 passing (2 suites). Initial run: 56 passing / 1 failing because the cross-field validation error omitted setting names; fix attempt 1 added a specific diagnostic, and the same command passed. `docker compose exec -T nestjs-api npx tsc --noEmit` passed; final static checks/full suites recorded under SI-03.3.
- **Observations:**
  - Added fixed upload policy constants, typed storage/queue/video namespaces, required Joi settings without defaults, exact HTTP(S) origin validation, TCP/resource/signing limits, and media-read TTL versus operation timeout validation. Shared runtimeConfigOptions initializes API and forthcoming worker without importing the API module.
  - Appended the plan's exact labelled local block to both .env.example and local .env, preserving all existing local values. README documents safe copying and lifetime constraints. Compose override remains untouched.
  - Context7's rolling Nest docs describe newer Standard Schema options; kept the installed @nestjs/config 4.0.3 / Joi 18.1.2 API as required by the library cache. No new dependencies or plan deviations.

### SI-03.3 — Establish Isolated Video Test Helpers
- **Status:** completed
- **Tests:** Focused: `docker compose exec -T nestjs-api npm test -- --runInBand --forceExit --runTestsByPath src/test/video-test-environment.spec.ts src/test/video-test-environment.integration-spec.ts` — 15/15 passing, 2/2 suites. Full unit/integration: `docker compose exec -T nestjs-api npm test -- --runInBand --forceExit` — 212/212 passing, 26/26 suites. Full HTTP: `docker compose exec -T nestjs-api npm run test:e2e -- --runInBand --forceExit` — 52/52 passing, 3/3 suites. All test processes ran sequentially on the resumed working tree. `docker compose exec -T nestjs-api npx tsc --noEmit` passed; `docker compose exec -T nestjs-api npm run lint` passed with 0 errors and 1 existing warning; `docker compose exec -T nestjs-api npm run build` passed. `git diff --check` passed.
- **Observations:**
  - Resumed from reviewer commit a7ee9dd with SI-03.1 and SI-03.2 complete. Re-read and reviewed the partial SI-03.3 source and tests; retained the correct implementation. The committed environment validator already contains its named media-lifetime diagnostic and was not changed. No plan deviations.
  - Added the exact three environment overrides with restoration of both prior values and absent keys. Extensible cleanup hooks run in reverse order, attempt every registered cleanup, restore configuration even on failure, and preserve cleanup errors. Client constructors refuse a non-isolated test environment.
  - Both Jest runners preserve setupFiles=[dotenv/config]. setupFilesAfterEnv applies overrides before app imports and factory evaluation, then restores them at teardown. Existing app-booting suites therefore receive the test bucket, test queue, and internal signed endpoint before constructing modules or clients.
  - Integration tests exercise native FFmpeg/ffprobe valid/invalid fixtures, both existing buckets, two-part signed PUTs with ETags and byte equality, incomplete-upload/object cleanup, development sentinel preservation, isolated queue cleanup and development-queue rejection, and existing createTestDataSource connection disposal through cleanup hooks. Tests sharing the database run with --runInBand. Temporary development sentinels are removed individually; no development bucket or queue is cleared.
  - Created nestjs-project/src/test/video-test-environment.ts, nestjs-project/src/test/video-test-setup.ts, nestjs-project/src/test/video-test-media.ts, nestjs-project/src/test/video-test-queue.ts, nestjs-project/src/test/video-test-storage.ts, nestjs-project/src/test/video-test-environment.spec.ts, and nestjs-project/src/test/video-test-environment.integration-spec.ts. Updated nestjs-project/package.json, nestjs-project/test/jest-e2e.json, and this progress file. Local .env, compose.override.yaml, and version control state were not changed during this resume.
  - Follow-up: existing createTestDataSource reads DB_DATABASE while .env.example defines DB_NAME; its fallback matches the current local database. Kept this existing helper unchanged in this SI.
  - Existing lint warning remains at src/auth/auth.service.integration-spec.ts:468 (@typescript-eslint/no-unsafe-argument). Full suites also emit the Node --localstorage-file warning, pg client.query() concurrency deprecation, and the conventional --forceExit open-handles advisory. These produced no test failures and remain out-of-scope follow-ups. Pre-existing/transitive npm audit findings remain recorded under SI-03.1; no npm audit fix was run.

### SI-03.4 — Implement Internal and Public S3 Storage Clients
- **Status:** completed
- **Tests:** `docker compose exec -T nestjs-api npm test -- --runInBand --forceExit --runTestsByPath src/storage/storage.service.integration-spec.ts src/storage/storage-signing.integration-spec.ts src/storage/storage.module.spec.ts` — 10/10 passing, 3/3 suites. Initial run: 8 passing / 2 failing; fix attempt 1 aligned repeated abort acknowledgement with real MinIO HTTP 204 and classified the installed Smithy retry wrapper's cross-realm transport errors without hiding permission/programming failures. TypeScript and targeted eslint passed before that focused runtime correction; batch static checks are recorded under SI-03.7.
- **Observations:**
  - Added StorageModule/StorageService with separate typed internal/public S3 clients, multipart pagination and ETags, explicit absence results, bounded JPEG uploads, safe transient exceptions with internal causes, signed expiration/headers, internal media GETs, Range-compatible public reads and sanitized inline/attachment dispositions, plus client teardown.
  - Optional checksum calculation uses WHEN_REQUIRED so part signatures do not bind an empty-body checksum. Real MinIO verifies signed PUT/GET compatibility, public/internal host selection, expired/tampered signatures, and credential-limited URL expiry. Bounded JPEG uploads accept at most 5 MiB as an adapter memory guard, without changing source-video limits.
  - Pinned MinIO acknowledges repeated abort with HTTP 204; ListParts still distinguishes NoSuchUpload from an active upload with zero parts. The adapter accepts either acknowledged abort or an explicit NoSuchUpload response. Installed Smithy retry code can erase properties of cross-realm Node errors; only its specific known network-code wrapper form maps to STORAGE_UNAVAILABLE, retaining the cause.
  - Created src/storage/storage.constants.ts, storage.types.ts, storage.module.ts, storage.service.ts, storage.module.spec.ts, storage.service.integration-spec.ts, storage-signing.integration-spec.ts; src/test/create-storage-test-context.ts; and src/common/exceptions/storage-unavailable.exception.ts (all under nestjs-project/). The storage exception is introduced here because this SI requires it; SI-03.6 adds the remaining catalog errors. No new dependency or plan contract change.

### SI-03.5 — Create Video and Upload Session Persistence
- **Status:** completed
- **Tests:** `docker compose exec -T nestjs-api npm test -- --runInBand --forceExit --runTestsByPath src/videos/entities/video.entity.integration-spec.ts src/videos/entities/upload-session.entity.integration-spec.ts src/database/migrations.integration-spec.ts src/videos/video-persistence.module.integration-spec.ts` — 27/27 passing, 4/4 suites. `docker compose exec -T nestjs-api npx tsc --noEmit` passed. CLI generation: `docker compose exec -T nestjs-api npm run migration:generate -- src/database/migrations/CreateVideosAndUploadSessions`; final migration 1792893518686. `docker compose exec -T nestjs-api npm run migration:run`, `docker compose exec -T nestjs-api npm run migration:revert`, and the same migration:run command passed sequentially; the final schema remains migrated. Integration migration runner also verifies an empty schema, rollback with preserved auth rows, enum teardown, and reapplication.
- **Observations:**
  - Added reviewed Video/UploadSession entities with explicit relations, named public-ID uniqueness, enum lifecycle states, immutable ORM public-ID updates, bigint string mapping, finite-duration/size/attempt/readiness/failure checks, reconciliation/retrieval indexes, and positive part_size without a policy equality constraint. VideoPersistenceModule registers and exports the domain entity repositories and is registered in AppModule.
  - Final migration src/database/migrations/1792893518686-CreateVideosAndUploadSessions.ts was generated by the TypeORM CLI inside nestjs-api with its real timestamp. The declared-size SQL range is frozen from UPLOAD_MAX_BYTES at generation time, with no live policy import in historical SQL. Draft generation was reviewed to avoid duplicate session UNIQUE constraints and to preserve child-before-parent rollback; discarded local draft applications were reverted before replacement. Existing committed migrations were not altered.
  - Added src/videos/entities/video.entity.integration-spec.ts, upload-session.entity.integration-spec.ts, src/videos/video-persistence.module.integration-spec.ts, and src/test/video-test-data.ts; extended src/database/migrations.integration-spec.ts and shared child-before-parent cleanup. All paths are under nestjs-project/.
  - Updated the Channel inverse relation and the ten existing auth/user/channel isolated test entity closures to include Video and UploadSession, as required by the relation graph. Their existing test suffixes and synchronization conventions were preserved; API/CLI and new persistence suites use synchronize=false. No unrelated database helper configuration change or new dependency.
  - Context7 provides TypeORM 0.3.27 rather than installed 0.3.28, matching the documented cache discrepancy; the installed CLI and actual PostgreSQL constraints/runner validate the shared APIs. Existing pg concurrency deprecation during CLI metadata inspection remains an out-of-scope observation.

### SI-03.6 — Add Owner-Scoped Persistence Services and Domain Errors
- **Status:** completed
- **Tests:** Initial focused command `docker compose exec -T nestjs-api npm test -- --runInBand --forceExit --runTestsByPath src/videos/video-records.service.spec.ts src/videos/video-records.service.integration-spec.ts src/videos/uploads/upload-sessions.service.integration-spec.ts src/channels/channels.service.integration-spec.ts src/common/filters/domain-exception.filter.spec.ts` — 39 passed / 5 setup failures in the existing channel suite due to TypeORM enum introspection. Fix attempt 1 was revalidated with `docker compose exec -T nestjs-api npm test -- --runInBand --forceExit --runTestsByPath src/videos/entities/video.entity.integration-spec.ts src/videos/entities/upload-session.entity.integration-spec.ts src/database/migrations.integration-spec.ts src/videos/video-persistence.module.integration-spec.ts src/videos/video-records.service.spec.ts src/videos/video-records.service.integration-spec.ts src/videos/uploads/upload-sessions.service.integration-spec.ts src/channels/channels.service.integration-spec.ts src/common/filters/domain-exception.filter.spec.ts` — 71/71 passing, 9/9 suites (SI-03.5: 27; SI-03.6: 44). TypeScript and targeted eslint without --fix passed.
- **Observations:**
  - Added ChannelsService.findOwnedByUserId, owner-scoped VideoRecordsService, transactional UploadSessionsService, public response DTOs, safe bigint/date mapping, and the remaining catalog exceptions. Missing and foreign-owned video lookups share VIDEO_NOT_FOUND; absent initiating channels use CHANNEL_NOT_FOUND. Empty identities are rejected before TypeORM could omit undefined/empty ownership predicates.
  - Video/session creation and conditional state writes honor the same supplied EntityManager. Real PostgreSQL tests verify rollback of both rows, transaction visibility, 100 ms lock-timeout contention on two connections, active-only transitions, and terminal-state protection. JSON metadata updates bind one SQL parameter to avoid TypeORM's recursive QueryDeepPartialEntity<unknown> typing limitation.
  - The existing channel suite exposed a metadata defect in SI-03.5's redundant explicit default enumName values. The installed TypeORM driver introspects default enum names as undefined and otherwise tries to recreate the enum under a CHECK constraint. Surfaced the correction before proceeding, removed those two redundant metadata declarations, and re-ran all SI-03.5 tests alongside this SI. Database enum names and migration SQL are unchanged; `docker compose exec -T nestjs-api npm run typeorm -- schema:log -d src/database/data-source.ts` reports the schema is up to date with no synchronization queries.
  - Created src/channels/exceptions/channel-not-found.exception.ts; src/videos/exceptions/video.exceptions.ts, dto/video-response.dto.ts, dto/upload-session-response.dto.ts, videos.mapping.ts, video-records.service.ts, video-records.service.spec.ts, video-records.service.integration-spec.ts, uploads/upload-sessions.service.ts, uploads/upload-sessions.service.integration-spec.ts. Updated ChannelsService and its integration tests, VideoPersistenceModule exports, and the existing domain filter tests. All paths are under nestjs-project/. Filter/guard runtime behavior is unchanged, and no schema migration or dependency was added in this SI.
  - Follow-up: existing ChannelsService.createChannel retries a concurrent nickname UNIQUE violation inside the same transaction without a savepoint; that pre-existing race path can leave the transaction aborted. The new ownership lookup does not change that path; track its correction separately.

### SI-03.7 — Implement the Queue Producer with Bounded Failure
- **Status:** completed
- **Tests:** Focused: `docker compose exec -T nestjs-api npm test -- --runInBand --forceExit --runTestsByPath src/videos/queue/video-processing-producer.integration-spec.ts src/videos/queue/video-queue.module.integration-spec.ts` — 12/12 passing, 2/2 suites. Final full unit/integration after static cleanup: `docker compose exec -T nestjs-api npm test -- --runInBand --forceExit` — 294/294 passing, 37/37 suites. Final full e2e: `docker compose exec -T nestjs-api npm run test:e2e -- --runInBand --forceExit` — 52/52 passing, 3/3 suites. Both full runs also passed before the final static cleanup; all database test processes ran sequentially. `docker compose exec -T nestjs-api npx tsc --noEmit` passed; `docker compose exec -T nestjs-api npx eslint "{src,apps,libs,test}/**/*.ts"` passed with 0 errors and 1 existing warning; `docker compose exec -T nestjs-api npm run build` passed. ESLint was run without --fix. `git diff --check` passed.
- **Observations:**
  - Added a producer-only VideoQueueModule using typed named BullModule configuration, a stable injection token with the runtime-configured queue name, and a dedicated bounded API connection: redis host, enableOfflineQueue=false, maxRetriesPerRequest=1, and 2000 ms connect/command timeouts. No API consumer or direct ioredis dependency was introduced.
  - VideoProcessingProducer publishes process-video with only { videoId }, deterministic colon-free video-UUID IDs, three total attempts by default, configured exponential backoff, and an explicit remaining-attempt budget. Completed and failed evidence is retained. Recoverable transport errors become VideoQueueUnavailableError with an internal cause; unrelated Redis command failures propagate. Error listeners log a fixed credential-free diagnostic, and module shutdown closes the queue and removes the owned listener.
  - Real Redis integration verifies exact payload/options, duplicate publication, remaining budgets, retained terminal evidence, readiness without API workers, orderly closure, unrelated WRONGTYPE errors, and enqueue failure within 3000 ms after an established producer connection is disconnected. Test-only workers use separate worker connection settings and are closed before queue cleanup.
  - Created src/videos/queue/video-queue.constants.ts, video-queue-unavailable.error.ts, video-queue.module.ts, video-processing-producer.service.ts, video-processing-producer.integration-spec.ts, video-queue.module.integration-spec.ts, and src/test/create-video-queue-test-context.ts. Updated package.json and test/jest-e2e.json with a narrow ts-jest JavaScript transform allowlist for the pinned @nestjs/bullmq and @nestjs/bull-shared ESM packages, preserving dotenv/config and the existing test-environment setup. All paths are under nestjs-project/.
  - Implementation compatibility adjustments preserve the plan contracts: the installed Nest BullMQ provider supports a stable registration token while its factory supplies the configured queue name; Jest requires the narrow ESM transformation although Node 25 loads the same pinned packages directly. Context7's BullMQ documentation is v6 while the installed pin remains 5.81.5; local package APIs and real integration tests verified these settings. No dependency, policy, or scope changes were made.
  - Final lint initially reported nine errors: fixture formatting, an async test processor without await, and an implicit-any catch variable. Formatted only the affected fixture, returned explicit processor Promises, and narrowed the caught value from unknown. Final TypeScript, lint, build, and both full suites passed afterward.
  - The existing auth integration warning is now at src/auth/auth.service.integration-spec.ts:477 (@typescript-eslint/no-unsafe-argument). Node's localstorage-file warning, the pg client.query() concurrency deprecation, and the conventional forceExit open-handles advisory remain out of scope. The pre-existing/transitive audit findings recorded under SI-03.1 were not remediated; no npm audit fix was run. The pre-existing channel transaction race noted under SI-03.6 remains a separate follow-up.
  - Completed the authorized SI-03.4 through SI-03.7 batch and stopped before SI-03.8. The migration generation/run/revert/re-run evidence is under SI-03.5; the final schema remains migrated. Local .env and compose.override.yaml were untouched in this batch. No Git command changed version control state.

### SI-03.8 — Implement Upload Initiation and Public-ID Reservation
- **Status:** completed
- **Tests:** `docker compose exec -T nestjs-api npm test -- --runInBand --forceExit --runTestsByPath src/videos/public-id.spec.ts src/videos/uploads/start-video-upload.service.spec.ts src/videos/uploads/start-video-upload.service.integration-spec.ts src/videos/videos.module.integration-spec.ts` — 18/18 passing, 4/4 suites. `docker compose exec -T nestjs-api npx tsc --noEmit` passed. Batch static and regression checks follow SI-03.12.
- **Observations:**
  - Added native 9-byte base64url PublicIdGenerator and exact named-constraint retry classification. Each of at most three insert attempts owns a fresh DataSource transaction; failed PostgreSQL transactions never leak into the next retry. Real concurrent collision tests verify this boundary.
  - StartVideoUploadService resolves the caller's channel, allocates one server-owned UUID/key multipart upload, and creates the draft/session atomically through their owning services. Failed persistence aborts the allocation; a failed abort preserves both errors in AggregateError. Each acknowledged call creates a new pair.
  - Created src/videos/public-id.ts, public-id.spec.ts, dto/start-video-upload-response.dto.ts, uploads/start-video-upload.service.ts, uploads/start-video-upload.service.spec.ts, uploads/start-video-upload.service.integration-spec.ts, videos.module.ts, videos.module.integration-spec.ts, and src/test/create-video-test-context.ts (all under nestjs-project/).
  - Clean feature branch and 7/27 committed progress confirmed before resuming. Modern Test Specs preflight passed: all referenced files exist, no pending markers, and plan/spec age differences are within the 600-second grace window. Context7 offers TypeORM 0.3.27 versus installed 0.3.28; transaction APIs were cross-checked against local types and PostgreSQL. Nest 11.1.16 source docs did not match the validation query, so the official rolling Nest docs supplied the established ValidationPipe options without adopting newer APIs. Task tools remain unavailable; this progress file is the persistent checklist. No plan-contract change or new dependency.

### SI-03.9 — Expose Upload Initiation
- **Status:** completed
- **Tests:** `docker compose exec -T nestjs-api npm run test:e2e -- --runInBand --forceExit --runTestsByPath test/videos-uploads.e2e-spec.ts` — 8/8 passing, 1/1 suite. TypeScript passed; final static/regression checks follow SI-03.12.
- **Observations:**
  - Read the complete videos-uploads.plan.md at JIT authoring time and implemented its exact target file with one describe and eight named scenario tests. Scenarios verify exact projections, durable non-idempotent creation, native JWT failures, unknown-reference/form-data rejection, exact 10 GiB boundary, missing own channel, controlled storage failure, three real public-ID conflicts with compensation, and inherited native throttling.
  - Created src/videos/dto/start-video-upload.dto.ts, src/videos/videos.controller.ts, test/helpers/video-e2e-context.ts, and test/videos-uploads.e2e-spec.ts. Updated src/videos/videos.module.ts and src/app.module.ts to register the authenticated JSON endpoint. Shared response DTOs introduced in SI-03.8 are reused. All paths are under nestjs-project/.
  - Controller delegates using CurrentUser.sub and documents JSON request metadata, exact-byte int64 limit, nested 201 response, catalog errors, native 401, 429 and bearer security. HTTP fixtures reproduce main.ts pipes/filters, seed confirmed independent users and real signed JWTs, clean database/test storage per scenario, clear inherited throttler state, and close owned resources. No source bytes are accepted by the API. No new auth/rate-limit policy or plan deviation.

### SI-03.10 — Implement Part Signing and Resumption
- **Status:** completed
- **Tests:** `docker compose exec -T nestjs-api npm test -- --runInBand --forceExit --runTestsByPath src/videos/uploads/upload-parts.service.spec.ts src/videos/uploads/upload-parts.service.integration-spec.ts` — 25/25 passing, 2/2 suites. Batch static and regression checks follow SI-03.12.
- **Observations:**
  - UploadPartsService authorizes through the owner-scoped video lookup, rejects missing/closed/elapsed sessions, validates unique integer part numbers against the server-derived count, and signs only server-owned references. TTL is at most 900 seconds and the remaining session window; a result extending past the deadline is rejected.
  - Resumption aggregates the adapter's paginated inventory, sorts part numbers, and exposes exact ETags/byte sizes with the public session projection. Empty active inventory differs from S3 NoSuchUpload; a missing S3 upload returns UPLOAD_NOT_ACTIVE for signing and listing. Missing-part renewal preserves the same video/session identity.
  - Created src/videos/uploads/upload-parts.service.ts, upload-parts.service.spec.ts, upload-parts.service.integration-spec.ts, and src/videos/dto/sign-upload-parts-response.dto.ts, uploaded-part.dto.ts, list-uploaded-parts-response.dto.ts. Updated src/videos/videos.module.ts provider/exports. All paths are under nestjs-project/.
  - Real PostgreSQL/MinIO tests cover signed PUTs, interruption and missing-part renewal, one-part-per-page ListParts aggregation, actual ETags/sizes, persisted deadline caps, foreign-owner denial and closed database/storage uploads. Static checks identified Node Buffer/DOM BodyInit and untyped bind/Jest-call boundaries in tests; explicit Uint8Array and narrow boundary types resolve them. No plan-contract change or new dependency.

### SI-03.11 — Expose Part URL Signing
- **Status:** completed
- **Tests:** `docker compose exec -T nestjs-api npm run test:e2e -- --runInBand --forceExit --runTestsByPath test/videos-upload-parts-sign.e2e-spec.ts` — 8/8 passing, 1/1 suite. `docker compose exec -T nestjs-api npx tsc --noEmit` passed. Batch static and regression checks follow SI-03.12.
- **Observations:**
  - Read the complete videos-upload-parts-sign.plan.md at JIT authoring time and implemented its exact target file with one describe and eight named scenario tests. A correctly sized final part is PUT directly to the signed MinIO URL; tests preserve actual ETags and verify the public endpoint/signature parameters, exact response and requested number set, deadline-bounded renewal without replacement, validation versus session-relative conflicts, native auth/throttling, foreign-owner denial, closed sessions and controlled signing failure.
  - Created src/videos/dto/video-public-id-params.dto.ts, src/videos/dto/sign-upload-parts.dto.ts, and test/videos-upload-parts-sign.e2e-spec.ts. Updated src/videos/videos.controller.ts with a thin authenticated POST delegate and explicit 200, and test/helpers/video-e2e-context.ts with reusable real upload fixtures. All paths are under nestjs-project/.
  - Maximum input array length and static part-number bounds derive from UPLOAD_MAX_BYTES / UPLOAD_PART_SIZE_BYTES. DTO uniqueness/path validation uses the inherited 400 envelope; syntactically valid numbers outside a session's actual inventory use UPLOAD_PARTS_INVALID 409. OpenAPI documents the nested response, path/body constraints, bearer security, catalog errors, expiry and direct PUT procedure. No new dependency or plan deviation.

### SI-03.12 — Expose Uploaded-Part Resumption
- **Status:** completed
- **Tests:** Focused: `docker compose exec -T nestjs-api npm run test:e2e -- --runInBand --forceExit --runTestsByPath test/videos-upload-parts-list.e2e-spec.ts` — 8/8 passing, 1/1 suite. Final full unit/integration: `docker compose exec -T nestjs-api npm test -- --runInBand --forceExit` — 337/337 passing, 43/43 suites. Final full e2e: `docker compose exec -T nestjs-api npm run test:e2e -- --runInBand --forceExit` — 76/76 passing, 6/6 suites. Database test processes ran sequentially throughout the batch. `docker compose exec -T nestjs-api npx tsc --noEmit` passed; `docker compose exec -T nestjs-api npx eslint "{src,apps,libs,test}/**/*.ts"` passed without --fix, with 0 errors and 1 existing warning; `docker compose exec -T nestjs-api npm run build` passed. `git diff --check` passed. All focused suites in SI-03.8 through SI-03.12 passed on their first run.
- **Observations:**
  - Read the complete videos-upload-parts-list.plan.md at JIT authoring time and implemented its exact target file with one describe and eight named scenario tests. Verified all three endpoint test files against their source specs: exact scenario names/order, eight tests each, and one describe per file.
  - Created nestjs-project/test/videos-upload-parts-list.e2e-spec.ts and updated nestjs-project/src/videos/videos.controller.ts with the thin authenticated GET delegate, shared path validation, exact session/part response and status-specific OpenAPI documentation. No request storage references are forwarded to the service: query/body attempts cannot select another upload or alter either upload's inventory.
  - Real MinIO tests verify correct-size direct PUT subsets, actual ETags/sizes and missing numbers, empty active inventory, one-part-per-page aggregation with a real 64 MiB part plus a 1-byte final part, and stable session ID/deadline. Closed-upload tests actually complete an S3 upload and confirm NoSuchUpload becomes 409 rather than an empty active response. Pagination's 30-second test timeout accommodates the real transfer without adding a product latency SLA.
  - Exact native JWT failures, owner/missing-video 404 equivalence, malformed-path validation, safe inventory-unavailable 503 and inherited throttling are covered. No worker, completion/abort endpoint, new policy, dependency or schema migration was introduced in this batch; the plan contracts are unchanged.
  - Batch file manifest: 23 new files, listed under their owning SI entries above; existing tracked changes are nestjs-project/src/app.module.ts and this progress file. Existing persistence, storage, queue, authentication and migration source files were not edited. Local .env and compose.override.yaml were untouched; no Docker service/volume teardown, HTTP app server, audit fix or Git state mutation was performed. HTTP contexts ran only for the tests.
  - Existing lint warning remains src/auth/auth.service.integration-spec.ts:477 (@typescript-eslint/no-unsafe-argument). Full regressions retain the Node localstorage-file warning, pg client.query() concurrency deprecation and conventional forceExit open-handles advisory. Pre-existing/transitive audit findings and the channel nickname-transaction race recorded earlier remain out-of-scope follow-ups.
  - Completed the authorized SI-03.8 through SI-03.12 batch and stopped before SI-03.13, as requested. Phase status remains in_progress.

### SI-03.13 — Implement Serialized Upload Completion
- **Status:** completed
- **Tests:** `docker compose exec -T nestjs-api npm test -- --runInBand --forceExit --runTestsByPath src/videos/uploads/upload-finalization.service.spec.ts src/videos/uploads/upload-finalization.service.integration-spec.ts src/videos/uploads/complete-video-upload.service.spec.ts src/videos/uploads/upload-lifecycle.module.integration-spec.ts` — 37/37 passing, 4/4 suites. `docker compose exec -T nestjs-api npx tsc --noEmit` passed. Batch regression/static results follow SI-03.16.
- **Observations:**
  - UploadFinalizationService locks and rechecks the session/video, validates the complete contiguous manifest against actual paginated ETags and exact part sizes, and verifies the completed object's length. Matching objects recover lost S3 responses and the S3-before-DB-commit window. All state writes use owning services and the same manager; completed/processing commits before publication. Repeated completed sessions return current terminal results without new jobs.
  - Neutral controller-free UploadLifecycleModule exports verified-object/deadline recovery for future worker use without API/AuthModule dependencies. Expired completion never completes unfinished parts; it checks HeadObject, recovers a matching object, or completes required abort/delete cleanup before committing expiry/error. A pre-expiry size mismatch closes the session as aborted and persists processing_failed; expiry uses expired/upload_expired. Rejections are raised after cleanup transitions commit, while unavailable verification/cleanup leaves the decision pending.
  - CompleteVideoUploadService publishes only after finalization resolves. Recoverable producer unavailability preserves processing intent and emits only a fixed safe deferred-publication diagnostic; unrelated failures propagate. Real Redis disconnect after readiness returned promptly within 3000 ms. No direct ioredis dependency or API consumer was added.
  - Created src/videos/uploads/upload-finalization.service.ts, upload-finalization.service.spec.ts, upload-finalization.service.integration-spec.ts, upload-lifecycle.module.ts, upload-lifecycle.module.integration-spec.ts, complete-video-upload.service.ts, complete-video-upload.service.spec.ts; src/test/create-upload-lifecycle-test-context.ts and upload-lifecycle-test-data.ts. Updated src/videos/videos.module.ts and src/test/create-video-test-context.ts to own producer readiness/independent test-queue cleanup. All paths are under nestjs-project/.
  - Clean feature branch and 12/27 committed progress confirmed. Modern Test Specs preflight passed for every reference (no missing/pending specs; 360–361-second plan/spec deltas are within grace). Context7 versions remain TypeORM 0.3.27 versus installed 0.3.28, and AWS SDK v3.1153.0 versus pinned 3.1156.0; installed types and real PostgreSQL/MinIO/Redis verify the shared APIs. Task tools remain unavailable, so this file is the persistent SI checklist. No new dependency or plan-contract change.

### SI-03.14 — Expose Upload Completion
- **Status:** completed
- **Tests:** `docker compose exec -T nestjs-api npm run test:e2e -- --runInBand --forceExit --runTestsByPath test/videos-upload-complete.e2e-spec.ts` — 12/12 passing, 1/1 suite. `docker compose exec -T nestjs-api npx tsc --noEmit` passed; full eslint without --fix passed with 0 errors / 1 existing warning. Batch regressions follow SI-03.16.
- **Observations:**
  - Read videos-upload-complete.plan.md in full at JIT authoring time and implemented its exact target with one describe and all 12 named scenarios in order. Tests cover real correctly sized paginated multipart completion with an unsorted manifest, exact 202 projection, malformed/conflicting manifests, controlled final-length rejection/cleanup, established real producer disconnect, terminal-state idempotence, passed-deadline matching-object recovery, ownership/authentication, lost S3 response, pending storage failure and inherited throttling.
  - Created nestjs-project/src/videos/dto/complete-video-upload.dto.ts and nestjs-project/test/videos-upload-complete.e2e-spec.ts. Updated nestjs-project/src/videos/videos.controller.ts and test/helpers/video-e2e-context.ts for the thin authenticated completion delegate and independent queue cleanup/readiness. The outage scenario owns a separate application/producer so subsequent scenarios retain a ready connection.
  - Nested DTO validation checks exact part/ETag shape, unknown nested fields, part-number uniqueness and constant-derived bounds. Context7 provides class-validator v0.15.1/develop docs versus installed 0.14.4; ValidateNested/ArrayUnique signatures were checked against installed types and the real HTTP validation suite. No new API, dependency, policy or plan-contract deviation.

### SI-03.15 — Implement Abort and Deadline Resolution
- **Status:** completed
- **Tests:** `docker compose exec -T nestjs-api npm test -- --runInBand --forceExit --runTestsByPath src/videos/uploads/upload-termination.service.spec.ts src/videos/uploads/upload-termination.service.integration-spec.ts src/videos/uploads/upload-lifecycle.module.integration-spec.ts` — 27/27 passing, 3/3 suites. `docker compose exec -T nestjs-api npx tsc --noEmit` passed. Batch regression/static checks follow SI-03.16.
- **Observations:**
  - Added neutral UploadTerminationService entry points for owner-authorized voluntary abort and worker-invoked expiry resolution. Both lock and recheck the session; expiry invokes the same lower-level UploadFinalizationService.resolveDeadlineLocked policy used by completion. Dependency direction remains termination to finalizer, without a cycle or API/queue import into the lifecycle module.
  - Real PostgreSQL/MinIO tests cover matching completed-object recovery without client retry, wrong-length deletion, absent/incomplete-upload expiry, cleanup failure/retry, draft-preserving repeated abort, completed-object protection/publication and concurrent completion/abort/expiry. Exactly one active-session transition wins, preserving the same identity and a coherent session/video pair.
  - Created src/videos/uploads/upload-termination.service.ts, upload-termination.service.spec.ts, upload-termination.service.integration-spec.ts and abort-video-upload.service.ts. Updated upload-lifecycle.module.ts and its existing integration test, plus src/videos/videos.module.ts. All paths are under nestjs-project/.
  - The API-only AbortVideoUploadService publishes recovered completed-object intent after commit and then returns the required conflict; recoverable Redis unavailability preserves that durable result and emits the same bounded diagnostic. Ordinary abort leaves the draft/failure reason intact and does not publish. No replacement session, new failure reason, dependency or plan-contract change was introduced.

### SI-03.16 — Expose Upload Abort
- **Status:** pending
- **Tests:** not run
- **Observations:** none

### SI-03.17 — Implement Remote Media Inspection and Thumbnail Extraction
- **Status:** pending
- **Tests:** not run
- **Observations:** none

### SI-03.18 — Run the Standalone Video Worker and Processor
- **Status:** pending
- **Tests:** not run
- **Observations:** none

### SI-03.19 — Reconcile Uploads and Processing Intent
- **Status:** pending
- **Tests:** not run
- **Observations:** none

### SI-03.20 — Implement Own-Video Detail and Listing Queries
- **Status:** pending
- **Tests:** not run
- **Observations:** none

### SI-03.21 — Expose Own-Video Detail
- **Status:** pending
- **Tests:** not run
- **Observations:** none

### SI-03.22 — Expose the Own-Video Listing
- **Status:** pending
- **Tests:** not run
- **Observations:** none

### SI-03.23 — Implement Playback and Download URL Authorization
- **Status:** pending
- **Tests:** not run
- **Observations:** none

### SI-03.24 — Expose the Playback URL
- **Status:** pending
- **Tests:** not run
- **Observations:** none

### SI-03.25 — Expose the Download URL
- **Status:** pending
- **Tests:** not run
- **Observations:** none

### SI-03.26 — Regenerate OpenAPI and Document Backend Conventions
- **Status:** pending
- **Tests:** not run
- **Observations:** none

### SI-03.27 — Verify the Full Pipeline and Rehearse a Real 10 GiB Upload
- **Status:** pending
- **Tests:** not run
- **Observations:** none
