---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.25
target_file: nestjs-project/test/videos-download-url.e2e-spec.ts
---

# GET /videos/:publicId/download-url Test Plan

## Application Overview

Issues an expiring original-file download URL to a ready video's owner. Storage serves the original bytes with a sanitized attachment filename; client filename content cannot redirect the signature to another object or inject headers.

Source: `docs/phases/phase-03-videos/phase-03-videos.md` — SI-03.25 acceptance criteria, API Contracts, Authorization Matrix and Error Catalog. AC numbers refer to the acceptance-criteria bullet order within SI-03.25.

## Test Scenarios

### 1. GET /videos/:publicId/download-url

**Setup:** Bootstrap the real AppModule once with Test.createTestingModule(), reproduce main.ts global ValidationPipe, exception filters and other global HTTP configuration, and use Supertest against the initialized Nest application. Before each scenario, truncate only the dedicated test database and seed independent authenticated users/channels and the required video/session fixtures. Use real PostgreSQL (db), MinIO (minio) and isolated Redis (redis) resources; configure all service connections through Compose service names. Isolate storage objects and queue jobs per scenario; keep worker consumption controlled when asserting processing intent. Close the application and owned resources after the suite. These are future test setup instructions; generating this spec does not start services or execute tests.

#### 1.1. download-original-through-signed-attachment-url

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Seed a ready owner video with known original bytes and original_filename example.mp4. GET /videos/:publicId/download-url with the owner's token.
     - expect: HTTP 200 JSON with exactly { url, expires_at }; url is a URI signed against the configured public storage endpoint, with expiry consistent with the independent configured download lifetime.
     - expect: the API returns neither a redirect nor binary content.
  2. GET the returned URL directly from storage without an API JWT.
     - expect: the downloaded bytes match the complete original object, rather than a normalized derivative.
     - expect: Content-Disposition is attachment with the safe original filename example.mp4.

#### 1.2. sanitize-filename-without-changing-object-or-injecting-headers

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Independently seed ready owner fixtures whose original_filename includes path components, control characters/CRLF, and quotes requiring header escaping. Keep each persisted original object's key and bytes known.
  2. Obtain each fixture's download URL as its owner and GET it directly from storage.
     - expect: HTTP 200 from the API and a successful download of that fixture's exact original object.
     - expect: the attachment filename has path components and control characters removed and header filename syntax safely escaped; raw filename data does not inject an additional response header.
     - expect: filename manipulation never changes the signed object's key or grants access to a different object; the video's immutable identity is unchanged.

#### 1.3. reject-every-non-ready-state

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Independently request a download URL as the owner for draft, processing and error videos.
     - expect: HTTP 409 with { statusCode: 409, error: "VIDEO_NOT_READY", message: "Video is not ready" }; no URL is issued.

#### 1.4. enforce-token-and-owner-scope

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Request an otherwise eligible ready video's download URL without a token and separately with invalid/expired tokens.
     - expect: HTTP 401 with { message: "Unauthorized", statusCode: 401 }.
  2. Request a foreign ready video's URL with a valid token, and independently request a well-formed missing publicId.
     - expect: HTTP 404 with { statusCode: 404, error: "VIDEO_NOT_FOUND", message: "Video not found" }; no download URL is disclosed.

#### 1.5. reject-malformed-public-id

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Request download access with a valid owner token and a malformed publicId.
     - expect: HTTP 400 with { statusCode: 400, error: "VALIDATION_ERROR", message: string[] }.

#### 1.6. report-storage-signing-unavailability

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Arrange a transient storage/signing boundary failure for a ready owner video and GET its download URL.
     - expect: HTTP 503 with { statusCode: 503, error: "STORAGE_UNAVAILABLE", message: "Storage is temporarily unavailable" }; no URL or internal diagnostic is disclosed.

#### 1.7. enforce-download-bearer-expiry-and-owner-renewal

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Obtain a ready owner's download URL and GET it directly from storage without API Authorization before expiry.
     - expect: the signed URL itself grants access to the original with attachment disposition.
  2. Expire/change the issuing API JWT while the storage URL remains valid. Retry the direct download and request API renewal with that JWT.
     - expect: the previously issued URL remains valid until its storage expiry; API renewal returns the inherited HTTP 401.
  3. After the storage URL expires, retry it, then request renewal with a fresh valid owner token.
     - expect: storage denies the expired URL; authorized renewal returns HTTP 200 with a new download lifetime and preserves the video's identity and private scope.

#### 1.8. retain-inherited-throttler-response

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Reach the configured existing global throttler limit with otherwise eligible download requests.
     - expect: HTTP 429 with the inherited native throttler response.
