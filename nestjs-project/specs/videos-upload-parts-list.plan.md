---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.12
target_file: nestjs-project/test/videos-upload-parts-list.e2e-spec.ts
---

# GET /videos/:publicId/upload/parts Test Plan

## Application Overview

Returns the verified storage inventory for the owner's existing active upload session so a client can resume only its missing parts. Storage pagination is aggregated into one bounded API response.

Source: `docs/phases/phase-03-videos/phase-03-videos.md` — SI-03.12 acceptance criteria, API Contracts, Authorization Matrix and Error Catalog. AC numbers refer to the acceptance-criteria bullet order within SI-03.12.

## Test Scenarios

### 1. GET /videos/:publicId/upload/parts

**Setup:** Bootstrap the real AppModule once with Test.createTestingModule(), reproduce main.ts global ValidationPipe, exception filters and other global HTTP configuration, and use Supertest against the initialized Nest application. Before each scenario, truncate only the dedicated test database and seed independent authenticated users/channels and the required video/session fixtures. Use real PostgreSQL (db), MinIO (minio) and isolated Redis (redis) resources; configure all service connections through Compose service names. Isolate storage objects and queue jobs per scenario; keep worker consumption controlled when asserting processing intent. Close the application and owned resources after the suite. These are future test setup instructions; generating this spec does not start services or execute tests.

#### 1.1. resume-from-real-storage-etags-and-sizes

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Seed an active owner session, upload a subset of its expected parts directly to MinIO with the correct part sizes, and retain the storage ETags.
  2. GET /videos/:publicId/upload/parts with the owner's token and no request body/query.
     - expect: HTTP 200 with exactly { upload_session, parts }; upload_session contains exactly id, status, part_size, total_parts and expires_at for the existing session.
     - expect: parts contains exactly { part_number, etag, size } entries for the uploaded subset, ordered by part_number, with the actual storage ETags and byte sizes.
     - expect: the original session id and deadline are unchanged; missing numbers can be derived from total_parts without inventing a new upload.
  3. For a distinct active session with no uploaded parts, GET its inventory.
     - expect: HTTP 200 with the existing active session and parts: []; this empty inventory is distinct from a closed session.

#### 1.2. aggregate-every-storage-page

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Arrange a valid active upload whose real storage ListParts inventory spans multiple pages, using a test-only small storage page size if needed while keeping at most 160 expected parts.
  2. GET the inventory once as its owner, without supplying an S3 continuation token.
     - expect: HTTP 200 contains every uploaded part exactly once in part-number order, including parts from later storage pages.
     - expect: the response is one { upload_session, parts } aggregate with actual ETags/sizes and does not expose an S3 continuation token.

#### 1.3. keep-storage-references-server-owned

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Seed two distinct uploads with distinct storage inventories. Retrieve the first upload as its owner without client storage references.
     - expect: its own persisted session and storage inventory are returned.
  2. Attempt to nominate the second upload through client bucket, key, UploadId or continuation-token data while retaining the first publicId.
     - expect: client data is not accepted as authority to select a storage inventory; no foreign inventory or internal storage reference is disclosed, and neither upload is modified.

#### 1.4. reject-closed-or-deadline-passed-session

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. As the owner, GET inventory separately for completed, aborted and expired sessions, and for an active session whose deadline has passed.
     - expect: HTTP 409 with { statusCode: 409, error: "UPLOAD_NOT_ACTIVE", message: "Upload session is not active" }.
     - expect: a completed upload's S3 NoSuchUpload is not presented as HTTP 200 with an empty active inventory.

#### 1.5. enforce-token-and-owner-scope

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. GET inventory without a token and separately with invalid/expired tokens.
     - expect: HTTP 401 with { message: "Unauthorized", statusCode: 401 }.
  2. GET a foreign owner's upload with a valid token, and independently GET a well-formed missing publicId.
     - expect: HTTP 404 with { statusCode: 404, error: "VIDEO_NOT_FOUND", message: "Video not found" }; no foreign session is returned.

#### 1.6. reject-malformed-public-id

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. GET inventory with the owner's token and a malformed publicId.
     - expect: HTTP 400 with { statusCode: 400, error: "VALIDATION_ERROR", message: string[] }, proving path validation is wired.

#### 1.7. report-storage-inventory-unavailability

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Arrange transient unavailability of real storage inventory retrieval for an otherwise eligible owner request.
     - expect: HTTP 503 with { statusCode: 503, error: "STORAGE_UNAVAILABLE", message: "Storage is temporarily unavailable" }; unavailable inventory is not reported as an empty successful response.

#### 1.8. retain-inherited-throttler-response

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Reach the configured existing global throttler limit with otherwise eligible inventory requests.
     - expect: HTTP 429 with the inherited native throttler response.
