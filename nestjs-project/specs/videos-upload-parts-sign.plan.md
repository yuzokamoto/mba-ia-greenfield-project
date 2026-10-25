---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.11
target_file: nestjs-project/test/videos-upload-parts-sign.e2e-spec.ts
---

# POST /videos/:publicId/upload/parts Test Plan

## Application Overview

Issues renewable direct-storage part PUT URLs to the upload owner while the original session remains active and unexpired. The API accepts JSON part numbers and leaves byte transfer to storage.

Source: `docs/phases/phase-03-videos/phase-03-videos.md` — SI-03.11 acceptance criteria, API Contracts, Authorization Matrix and Error Catalog. AC numbers refer to the acceptance-criteria bullet order within SI-03.11.

## Test Scenarios

### 1. POST /videos/:publicId/upload/parts

**Setup:** Bootstrap the real AppModule once with Test.createTestingModule(), reproduce main.ts global ValidationPipe, exception filters and other global HTTP configuration, and use Supertest against the initialized Nest application. Before each scenario, truncate only the dedicated test database and seed independent authenticated users/channels and the required video/session fixtures. Use real PostgreSQL (db), MinIO (minio) and isolated Redis (redis) resources; configure all service connections through Compose service names. Isolate storage objects and queue jobs per scenario; keep worker consumption controlled when asserting processing intent. Close the application and owned resources after the suite. These are future test setup instructions; generating this spec does not start services or execute tests.

#### 1.1. sign-only-requested-parts-with-bounded-expiry

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Seed an owner upload with three expected parts and an active, unexpired session. POST /videos/:publicId/upload/parts with { part_numbers: [3, 1] } using its owner's token.
     - expect: HTTP 200, overriding the POST default, with exactly { parts: [{ part_number, url, expires_at }] }.
     - expect: the returned part-number set is exactly { 1, 3 }, with no duplicates or unsolicited part.
     - expect: each url is a URI signed for direct UploadPart against the configured public storage endpoint; each expires_at is a date-time no later than 900 seconds from signing or the session deadline.
  2. PUT the correctly sized bytes for a returned part directly to its storage URL, supplying any signed headers.
     - expect: storage accepts the upload and returns an ETag for later completion; the API did not receive the bytes.

#### 1.2. renew-missing-part-without-replacing-session

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. For an active owner session whose remaining lifetime is shorter than 900 seconds, request a URL for a missing part, then request it again while the session remains active.
     - expect: each request returns HTTP 200 with the requested part and an expiry bounded by the unchanged original session deadline.
     - expect: the same video identity, session id and storage multipart upload are retained; no replacement session is created.

#### 1.3. reject-malformed-part-requests-and-public-id

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. POST with duplicate part numbers in an otherwise valid request.
     - expect: HTTP 400 with { statusCode: 400, error: "VALIDATION_ERROR", message: string[] }.
  2. Independently send a syntactically malformed part_numbers value, an unknown storage/ownership body field, or a publicId outside the 12-character base64url pattern.
     - expect: HTTP 400 with the same validation envelope and no signed URL.

#### 1.4. reject-parts-outside-server-derived-inventory

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Seed a session whose total_parts is 2. POST a syntactically valid { part_numbers: [3] }.
     - expect: HTTP 409 with { statusCode: 409, error: "UPLOAD_PARTS_INVALID", message: "Uploaded parts do not match the expected upload" }; no URL is returned.

#### 1.5. enforce-token-and-owner-scope

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Request signing without a token and separately with invalid/expired tokens.
     - expect: HTTP 401 with { message: "Unauthorized", statusCode: 401 }.
  2. Request the same valid publicId using another authenticated user's token, and independently request a well-formed missing publicId.
     - expect: HTTP 404 with { statusCode: 404, error: "VIDEO_NOT_FOUND", message: "Video not found" }; no URL or foreign upload details are returned.

#### 1.6. reject-closed-or-deadline-passed-session

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. As the owner, request signing separately for completed, aborted and expired sessions, and for an active session whose deadline has passed.
     - expect: HTTP 409 with { statusCode: 409, error: "UPLOAD_NOT_ACTIVE", message: "Upload session is not active" }; no URL or renewed session is returned.

#### 1.7. report-signing-storage-failure

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Arrange a transient storage/signing boundary failure for an otherwise eligible owner request.
     - expect: HTTP 503 with { statusCode: 503, error: "STORAGE_UNAVAILABLE", message: "Storage is temporarily unavailable" }; no usable URL or internal diagnostics are returned.

#### 1.8. retain-inherited-throttler-response

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Reach the configured existing global throttler limit with otherwise eligible signing requests.
     - expect: HTTP 429 with the inherited native throttler response.
