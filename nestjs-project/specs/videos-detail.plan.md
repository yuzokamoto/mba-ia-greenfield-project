---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.21
target_file: nestjs-project/test/videos-detail.e2e-spec.ts
---

# GET /videos/:publicId Test Plan

## Application Overview

Retrieves a video by its immutable 12-character public ID for its owner in every lifecycle state. It exposes safe processing/session state while keeping storage authority and operational diagnostics private.

Source: `docs/phases/phase-03-videos/phase-03-videos.md` — SI-03.21 acceptance criteria, API Contracts, Authorization Matrix and Error Catalog. AC numbers refer to the acceptance-criteria bullet order within SI-03.21.

## Test Scenarios

### 1. GET /videos/:publicId

**Setup:** Bootstrap the real AppModule once with Test.createTestingModule(), reproduce main.ts global ValidationPipe, exception filters and other global HTTP configuration, and use Supertest against the initialized Nest application. Before each scenario, truncate only the dedicated test database and seed independent authenticated users/channels and the required video/session fixtures. Use real PostgreSQL (db), MinIO (minio) and isolated Redis (redis) resources; configure all service connections through Compose service names. Isolate storage objects and queue jobs per scenario; keep worker consumption controlled when asserting processing intent. Close the application and owned resources after the suite. These are future test setup instructions; generating this spec does not start services or execute tests.

#### 1.1. retrieve-each-lifecycle-state-with-exact-projection

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Independently seed owner videos in draft, processing, ready and error states with their associated session fixtures. GET /videos/:publicId for each using the owner's token.
     - expect: HTTP 200 with exactly { video, upload_session }.
     - expect: video has exactly id, public_id, channel_id, title, status, failure_reason, original_filename, content_type, declared_size, duration, metadata, created_at and updated_at, matching the VideoResponseDto types and seeded state.
     - expect: internal id and channel_id are UUIDs, public_id is the requested immutable base64url identity, declared_size is an integer, and created_at/updated_at are date-times.
     - expect: duration/metadata remain nullable until processing supplies results; ready fixtures expose their stored duration/metadata.
     - expect: upload_session contains exactly id, status, part_size, total_parts and expires_at, including closed-session status/deadline so active resumption and voluntary abort are distinguishable.
     - expect: no bucket/key, S3 UploadId, credential, internal URL, processing diagnostic or attempt bookkeeping is serialized.

#### 1.2. expose-only-safe-processing-failure-reasons

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Independently retrieve owner error fixtures with failure_reason invalid_media, processing_failed and upload_expired, each with private internal diagnostic context.
     - expect: HTTP 200 exposes the corresponding safe allowlisted failure_reason and lifecycle state through the documented DTO.
     - expect: internal causes, FFmpeg output, credentials, presigned query strings and attempt bookkeeping are absent; an error state remains owner-readable.

#### 1.3. enforce-token-and-owner-scope

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. GET an otherwise valid publicId without a token and separately with invalid/expired tokens.
     - expect: HTTP 401 with { message: "Unauthorized", statusCode: 401 }.
  2. GET a foreign owner's video using a valid token, and independently GET a well-formed missing publicId.
     - expect: both return HTTP 404 with { statusCode: 404, error: "VIDEO_NOT_FOUND", message: "Video not found" }; knowledge of the publicId does not grant access.

#### 1.4. reject-malformed-public-id

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. GET a malformed publicId with a valid owner token, including using the internal UUID in place of the required public ID.
     - expect: HTTP 400 with { statusCode: 400, error: "VALIDATION_ERROR", message: string[] }.

#### 1.5. keep-repeated-retrieval-read-only

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Snapshot an owner's video identity/state, session id/deadline and processing job inventory; GET the same publicId repeatedly while external worker/reconciler activity is controlled.
     - expect: each request returns HTTP 200 for the same id/public_id and current persisted projection.
     - expect: GET does not renew or replace the session, restart processing, create new jobs or change the video identity.
  2. Repeat with an aborted session fixture.
     - expect: retrieval still exposes the retained draft and aborted session rather than creating a new resumable upload.

#### 1.6. retain-inherited-throttler-response

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Reach the configured existing global throttler limit with otherwise eligible detail requests.
     - expect: HTTP 429 with the inherited native throttler response.
