---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.14
target_file: nestjs-project/test/videos-upload-complete.e2e-spec.ts
---

# POST /videos/:publicId/upload/complete Test Plan

## Application Overview

Finalizes the owner's verified multipart upload and acknowledges durable asynchronous processing intent with HTTP 202. Repeated completion preserves the current video state, and queue outages after commit remain recoverable.

Source: `docs/phases/phase-03-videos/phase-03-videos.md` — SI-03.14 acceptance criteria, API Contracts, Authorization Matrix and Error Catalog. AC numbers refer to the acceptance-criteria bullet order within SI-03.14.

## Test Scenarios

### 1. POST /videos/:publicId/upload/complete

**Setup:** Bootstrap the real AppModule once with Test.createTestingModule(), reproduce main.ts global ValidationPipe, exception filters and other global HTTP configuration, and use Supertest against the initialized Nest application. Before each scenario, truncate only the dedicated test database and seed independent authenticated users/channels and the required video/session fixtures. Use real PostgreSQL (db), MinIO (minio) and isolated Redis (redis) resources; configure all service connections through Compose service names. Isolate storage objects and queue jobs per scenario; keep worker consumption controlled when asserting processing intent. Close the application and owned resources after the suite. These are future test setup instructions; generating this spec does not start services or execute tests.

#### 1.1. complete-verified-upload-and-commit-processing-intent

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Seed an active unexpired owner upload, PUT every expected part directly to MinIO with exact expected sizes, and retain actual ETags. Submit the complete manifest in non-sorted order to POST /videos/:publicId/upload/complete.
     - expect: HTTP 202 with the VideoResponseDto itself, not a { video, upload_session } wrapper.
     - expect: the response contains exactly id, public_id, channel_id, title, status, failure_reason, original_filename, content_type, declared_size, duration, metadata, created_at and updated_at with the documented types/nullability; status is processing while worker consumption is controlled.
     - expect: storage HeadObject confirms the original object's ContentLength equals declared_size; the completed session and processing video are durably committed together before enqueue.
     - expect: the immutable video identity is retained, a processing job is published only after commit, and the API response contains no keys, credentials, UploadId, internal URLs, diagnostics or attempt bookkeeping.

#### 1.2. reject-malformed-manifest-and-path

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. POST an empty parts array as the owner; independently submit a manifest with a missing etag, duplicate part numbers, or an unknown storage/ownership field, and separately use a malformed publicId.
     - expect: HTTP 400 with { statusCode: 400, error: "VALIDATION_ERROR", message: string[] }; malformed requests do not finalize the upload or publish processing work.

#### 1.3. reject-inventory-conflicts

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. For independent active owner fixtures, POST syntactically valid manifests that omit an expected part, include a part beyond total_parts, or use an ETag differing from actual storage.
  2. For another fixture, upload a part whose size differs from the server-derived expected size and submit its actual ETag.
     - expect: each request returns HTTP 409 with { statusCode: 409, error: "UPLOAD_PARTS_INVALID", message: "Uploaded parts do not match the expected upload" }.
     - expect: unchecked client assertions do not finalize the upload or create a processing job; verification covers the complete paginated inventory.

#### 1.4. reject-final-object-size-mismatch

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Arrange a pre-expiry completion whose verified multipart inventory passes but whose completed object HeadObject length differs from declared_size, using a controlled storage boundary fault.
  2. POST the otherwise valid owner completion manifest.
     - expect: HTTP 409 with { statusCode: 409, error: "UPLOAD_SIZE_MISMATCH", message: "Uploaded size does not match the declared size" }.
     - expect: the mismatching object is deleted and multipart cleanup is performed as applicable; the video becomes error with failure_reason processing_failed, without publishing processing work.
     - expect: detailed size diagnostics do not appear in the API or safe persisted failure reason.

#### 1.5. acknowledge-durable-intent-after-established-redis-outage

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Establish readiness of an isolated real Redis producer connection; prepare all upload parts in real MinIO and retain real PostgreSQL.
  2. Disconnect that Redis connection after readiness, then POST a valid completion manifest as the owner while Redis remains unavailable.
     - expect: HTTP 202 returns promptly within the configured producer failure bound without waiting for Redis reconnection.
     - expect: the completed storage object and committed completed-session/processing-video state remain durable and recoverable; queue failure does not roll them back.
     - expect: deferred enqueue is recorded in a bounded log without credentials or presigned query strings; the request does not claim processing is already ready.

#### 1.6. repeat-completion-without-regressing-current-state

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Independently arrange already-completed sessions whose videos are processing, ready and error. For each, POST a syntactically valid completion request as the owner.
     - expect: HTTP 202 returns that same video's current VideoResponseDto, preserving id, public_id and current status.
     - expect: ready/error processing results are not cleared or regressed, the session stays completed, and no additional processing job is created.

#### 1.7. recover-matching-object-at-passed-deadline

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Arrange an active owner session past its deadline with an already-completed object at the known original key whose length matches declared_size.
  2. POST a syntactically valid completion request.
     - expect: HTTP 202 recovers the completed session and durable processing intent for the existing video, rather than treating the object as absent or allocating another identity.
     - expect: an unfinished multipart upload is not completed after its deadline.

#### 1.8. reject-aborted-and-expired-session

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. As the owner, POST a syntactically valid completion request separately for an already-aborted and an already-expired session.
     - expect: HTTP 409 with { statusCode: 409, error: "UPLOAD_NOT_ACTIVE", message: "Upload session is not active" }; no replacement upload or processing job is created.

#### 1.9. enforce-token-and-owner-scope

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. POST an otherwise valid manifest without a token and separately with invalid/expired tokens.
     - expect: HTTP 401 with { message: "Unauthorized", statusCode: 401 }.
  2. POST against a foreign owner's upload with a valid token, and independently against a well-formed missing publicId.
     - expect: HTTP 404 with { statusCode: 404, error: "VIDEO_NOT_FOUND", message: "Video not found" }; the foreign upload is unchanged.

#### 1.10. recover-lost-storage-completion-response

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Prepare a valid owner upload; arrange loss of the S3 completion response after storage has actually completed the object.
  2. POST its valid completion manifest.
     - expect: HeadObject on the persisted original key recovers the matching object and HTTP 202 acknowledges the same video's durable processing intent.
     - expect: recovery does not treat S3 NoSuchUpload as definitive absence, allocate a replacement session or duplicate the object.

#### 1.11. report-storage-failure-before-durable-acknowledgment

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Arrange a transient S3 completion/verification failure for which no successful completed object can yet be verified, then POST a valid owner request.
     - expect: HTTP 503 with { statusCode: 503, error: "STORAGE_UNAVAILABLE", message: "Storage is temporarily unavailable" }.
     - expect: the endpoint does not acknowledge completed processing intent without object verification; the unresolved transition remains recoverable.

#### 1.12. retain-inherited-throttler-response

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Reach the configured existing global throttler limit with otherwise eligible completion requests.
     - expect: HTTP 429 with the inherited native throttler response.
