---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.16
target_file: nestjs-project/test/videos-upload-abort.e2e-spec.ts
---

# POST /videos/:publicId/upload/abort Test Plan

## Application Overview

Cancels the owner's active upload with an empty HTTP 204 response while retaining the draft identity. Abort is idempotent for already-aborted/expired sessions and cannot discard a verified completed object.

Source: `docs/phases/phase-03-videos/phase-03-videos.md` — SI-03.16 acceptance criteria, API Contracts, Authorization Matrix and Error Catalog. AC numbers refer to the acceptance-criteria bullet order within SI-03.16.

## Test Scenarios

### 1. POST /videos/:publicId/upload/abort

**Setup:** Bootstrap the real AppModule once with Test.createTestingModule(), reproduce main.ts global ValidationPipe, exception filters and other global HTTP configuration, and use Supertest against the initialized Nest application. Before each scenario, truncate only the dedicated test database and seed independent authenticated users/channels and the required video/session fixtures. Use real PostgreSQL (db), MinIO (minio) and isolated Redis (redis) resources; configure all service connections through Compose service names. Isolate storage objects and queue jobs per scenario; keep worker consumption controlled when asserting processing intent. Close the application and owned resources after the suite. These are future test setup instructions; generating this spec does not start services or execute tests.

#### 1.1. abort-active-session-and-retain-draft

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Seed an active unexpired owner upload and its real multipart upload, optionally with uploaded parts. POST /videos/:publicId/upload/abort using its owner's token and no body/query.
     - expect: HTTP 204 with an empty response body.
     - expect: storage multipart upload is aborted and the persisted session becomes aborted.
  2. GET /videos/:publicId using the same token.
     - expect: HTTP 200 retains the same video id/public_id in draft state with no new failure reason, and exposes the aborted original session.
     - expect: abort did not delete the draft, renew its deadline or create a replacement resumable session.

#### 1.2. repeat-abort-for-aborted-and-expired-sessions

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Independently seed already-aborted and already-expired owner sessions. POST abort for each, then repeat.
     - expect: every request returns HTTP 204 with no body; the existing terminal session, video identity and prior failure state are unchanged.
     - expect: no replacement session or new processing job is created.

#### 1.3. reject-abort-after-completion

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Seed a completed owner session and its original completed object. POST abort as the owner.
     - expect: HTTP 409 with { statusCode: 409, error: "UPLOAD_NOT_ACTIVE", message: "Upload session is not active" }.
     - expect: the completed object and session are retained and the current video status is not regressed.

#### 1.4. preserve-completed-object-when-abort-observes-no-such-upload

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Arrange an active session for which storage has already completed the original object with the matching declared size, so aborting multipart observes NoSuchUpload.
  2. POST abort as the owner.
     - expect: the endpoint verifies the persisted original key and follows completion/recovery; HTTP 409 UPLOAD_NOT_ACTIVE reports the resulting completed-session conflict.
     - expect: the verified completed object is retained, the session is recovered as completed with processing intent, and abort does not claim HTTP 204 cancellation.

#### 1.5. enforce-token-and-owner-scope

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. POST abort without a token and separately with invalid/expired tokens.
     - expect: HTTP 401 with { message: "Unauthorized", statusCode: 401 }.
  2. POST abort against a foreign owner's upload with a valid token, and independently against a well-formed missing publicId.
     - expect: HTTP 404 with { statusCode: 404, error: "VIDEO_NOT_FOUND", message: "Video not found" }.
     - expect: the foreign upload's session and storage parts remain intact.

#### 1.6. reject-malformed-public-id

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. POST abort with a valid owner token and a malformed publicId.
     - expect: HTTP 400 with { statusCode: 400, error: "VALIDATION_ERROR", message: string[] }; no upload is aborted.

#### 1.7. report-storage-abort-unavailability

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Arrange a transient S3 abort/verification failure for an active owner upload, then POST abort.
     - expect: HTTP 503 with { statusCode: 503, error: "STORAGE_UNAVAILABLE", message: "Storage is temporarily unavailable" }.
     - expect: the endpoint does not acknowledge HTTP 204 cleanup or mark the upload successfully aborted while required storage work remains unresolved.

#### 1.8. retain-inherited-throttler-response

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Reach the configured existing global throttler limit with otherwise eligible abort requests.
     - expect: HTTP 429 with the inherited native throttler response.
