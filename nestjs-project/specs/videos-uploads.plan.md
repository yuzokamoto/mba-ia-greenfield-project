---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.9
target_file: nestjs-project/test/videos-uploads.e2e-spec.ts
---

# POST /videos/uploads Test Plan

## Application Overview

Initiates a JSON-only resumable upload for the authenticated user's own channel. The endpoint reserves an immutable public identity and durably creates a draft video and its single active upload session before any source bytes are uploaded.

Source: `docs/phases/phase-03-videos/phase-03-videos.md` — SI-03.9 acceptance criteria, API Contracts, Authorization Matrix and Error Catalog. AC numbers refer to the acceptance-criteria bullet order within SI-03.9.

## Test Scenarios

### 1. POST /videos/uploads

**Setup:** Bootstrap the real AppModule once with Test.createTestingModule(), reproduce main.ts global ValidationPipe, exception filters and other global HTTP configuration, and use Supertest against the initialized Nest application. Before each scenario, truncate only the dedicated test database and seed independent authenticated users/channels and the required video/session fixtures. Use real PostgreSQL (db), MinIO (minio) and isolated Redis (redis) resources; configure all service connections through Compose service names. Isolate storage objects and queue jobs per scenario; keep worker consumption controlled when asserting processing intent. Close the application and owned resources after the suite. These are future test setup instructions; generating this spec does not start services or execute tests.

#### 1.1. create-draft-and-active-session

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. As an authenticated user with a channel, POST /videos/uploads with JSON { title: "Example", original_filename: "example.mp4", content_type: "video/mp4", declared_size: 67108865 }.
     - expect: HTTP 201 with exactly { video, upload_session }, matching VideoResponseDto and UploadSessionResponseDto from the source API Contracts.
     - expect: video contains id, public_id, channel_id, title, status, failure_reason, original_filename, content_type, declared_size, duration, metadata, created_at and updated_at; id/channel_id are UUIDs, public_id matches the 12-character base64url pattern, status is draft, and processing result fields are null.
     - expect: upload_session contains exactly id, status, part_size, total_parts and expires_at; status is active, part_size is 67108864, total_parts is 2, and the deadline is 24 hours after initiation within clock tolerance.
     - expect: the draft and session are durable together and belong to the caller's channel; one storage multipart upload exists without any source bytes having traversed the API.
     - expect: neither response projection exposes object keys, credentials, S3 UploadId, internal URLs, processing diagnostics or attempt bookkeeping.
  2. Repeat the same valid initiation request.
     - expect: HTTP 201 creates a distinct video/session pair; the first pair retains its identity and session.

#### 1.2. reject-missing-invalid-and-expired-token

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. POST /videos/uploads with otherwise valid metadata, separately omitting the token, supplying an invalid token and supplying an expired token.
     - expect: each request returns HTTP 401 with the inherited native { message: "Unauthorized", statusCode: 401 } response.
     - expect: no draft, session or multipart upload is created.

#### 1.3. reject-invalid-metadata-and-client-owned-references

**Covers AC:** #2, #3
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. POST /videos/uploads with a missing required title to demonstrate the global validation pipe.
     - expect: HTTP 400 with { statusCode: 400, error: "VALIDATION_ERROR", message: string[] } and no upload side effects.
  2. Independently add unknown ownership/storage fields to an otherwise valid JSON body, including channel_id for a foreign channel, user_id, public_id, bucket, key and UploadId.
     - expect: each request returns the same 400 validation envelope; request data cannot select another owner or any storage reference.
  3. Submit source bytes as multipart/form-data instead of the required JSON metadata body.
     - expect: the request does not create an upload and returns the contract's 400 validation response.

#### 1.4. enforce-exact-declared-byte-limit

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. POST valid JSON metadata with declared_size equal to 10737418240.
     - expect: HTTP 201; the session uses 67108864-byte parts and total_parts is 160; initiation requires no 10 GiB body transfer.
  2. Independently POST with declared_size equal to 10737418241.
     - expect: HTTP 400 VALIDATION_ERROR before any S3 multipart initiation; no video/session is created by the rejected request.

#### 1.5. reject-initiator-without-own-channel

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Authenticate a user without a channel while another user's channel exists, and POST valid metadata.
     - expect: HTTP 404 with { statusCode: 404, error: "CHANNEL_NOT_FOUND", message: "Channel not found" }.
     - expect: the foreign channel receives no video/session and no storage upload is initiated.

#### 1.6. report-storage-initiation-unavailability

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Arrange a transient failure at the S3 initiation boundary and POST valid metadata as a channel owner.
     - expect: HTTP 503 with { statusCode: 503, error: "STORAGE_UNAVAILABLE", message: "Storage is temporarily unavailable" }.
     - expect: no successful draft/session pair is acknowledged; initiation failure does not leave a durable partial pair, and any allocated multipart upload is compensated by abort.
     - expect: the response does not disclose credentials or storage diagnostics.

#### 1.7. report-public-id-allocation-exhaustion

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Arrange fixtures so the three allowed public-ID insert attempts encounter the existing public-ID UNIQUE constraint, and POST valid metadata as a channel owner.
     - expect: HTTP 500 with { statusCode: 500, error: "VIDEO_ID_ALLOCATION_FAILED", message: "Video identifier could not be allocated" }.
     - expect: existing video identities remain unchanged, and the failed request does not acknowledge a new durable pair.

#### 1.8. retain-inherited-throttler-response

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. With a valid token and body, reach the existing global throttler limit for POST /videos/uploads using its configured test limits.
     - expect: HTTP 429 with the inherited native throttler response; no new video-specific rate policy or domain error code is introduced.
