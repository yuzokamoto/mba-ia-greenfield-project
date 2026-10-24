---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.24
target_file: nestjs-project/test/videos-playback-url.e2e-spec.ts
---

# GET /videos/:publicId/playback-url Test Plan

## Application Overview

Issues an expiring JSON URL to the original stored object after authenticating the ready video's owner. Storage handles Range requests and seeking, while URL issuance/renewal keeps the video's identity and private visibility unchanged.

Source: `docs/phases/phase-03-videos/phase-03-videos.md` — SI-03.24 acceptance criteria, API Contracts, Authorization Matrix and Error Catalog. AC numbers refer to the acceptance-criteria bullet order within SI-03.24.

## Test Scenarios

### 1. GET /videos/:publicId/playback-url

**Setup:** Bootstrap the real AppModule once with Test.createTestingModule(), reproduce main.ts global ValidationPipe, exception filters and other global HTTP configuration, and use Supertest against the initialized Nest application. Before each scenario, truncate only the dedicated test database and seed independent authenticated users/channels and the required video/session fixtures. Use real PostgreSQL (db), MinIO (minio) and isolated Redis (redis) resources; configure all service connections through Compose service names. Isolate storage objects and queue jobs per scenario; keep worker consumption controlled when asserting processing intent. Close the application and owned resources after the suite. These are future test setup instructions; generating this spec does not start services or execute tests.

#### 1.1. issue-inline-url-and-stream-original-byte-ranges

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Seed a ready owner video with a known original object and bytes. GET /videos/:publicId/playback-url using the owner's token.
     - expect: HTTP 200 JSON with exactly { url, expires_at }; url is a URI using the configured public storage endpoint and expires_at is a date-time consistent with the configured playback lifetime.
     - expect: the API returns neither a redirect nor binary video content.
  2. GET the returned URL directly from storage, without API Authorization, with Range: bytes=0-15.
     - expect: storage returns HTTP 206 with the corresponding Content-Range and exactly the first 16 original bytes.
     - expect: Content-Disposition is inline.
  3. Reuse the same signed URL with a different valid byte range.
     - expect: storage returns that original byte range; a fixed signed Range does not prevent seeking.

#### 1.2. renew-access-without-publishing-or-changing-identity

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Snapshot a ready video's id/public_id and private owner scope. Obtain a playback URL, then request another through the same authorized endpoint.
     - expect: both requests return HTTP 200 with the documented URL/expiry response and lifetimes computed from their issue times.
     - expect: issuing/renewing access does not change identity, lifecycle state or owner scope, persist signed URLs as video identity, or publish the video.
  2. Request the endpoint anonymously and as a foreign user after renewal.
     - expect: HTTP 401 and HTTP 404 respectively; ready/renewal does not confer public API access.

#### 1.3. retain-bearer-access-until-expiry-and-authorize-renewal

**Covers AC:** #1, #3
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Obtain a ready owner's playback URL and read the original directly from storage without an API JWT while the URL remains valid.
     - expect: the issued URL itself authorizes storage access.
  2. Expire/change the issuing API JWT while keeping the previously signed URL within its storage lifetime; retry the direct storage GET and attempt API renewal with that JWT.
     - expect: the existing storage URL still grants access until its own expiry, while renewal returns the inherited HTTP 401.
  3. After the signed URL expires, GET it directly from storage.
     - expect: storage denies access; a fresh valid owner JWT can obtain renewed access through the endpoint.

#### 1.4. reject-every-non-ready-state

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Independently request playback as the owner for draft, processing and error videos.
     - expect: HTTP 409 with { statusCode: 409, error: "VIDEO_NOT_READY", message: "Video is not ready" }; no URL is issued.

#### 1.5. enforce-token-and-owner-scope

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. GET an otherwise eligible ready video's playback endpoint without a token and separately with invalid/expired tokens.
     - expect: HTTP 401 with { message: "Unauthorized", statusCode: 401 }.
  2. Request a foreign ready video's URL with a valid token, and independently request a well-formed missing publicId.
     - expect: HTTP 404 with { statusCode: 404, error: "VIDEO_NOT_FOUND", message: "Video not found" }; no storage access is disclosed.

#### 1.6. reject-malformed-public-id

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Request playback with a valid owner token and malformed publicId.
     - expect: HTTP 400 with { statusCode: 400, error: "VALIDATION_ERROR", message: string[] }.

#### 1.7. report-storage-signing-unavailability

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Arrange a transient storage/signing boundary failure for a ready owner video and GET its playback URL.
     - expect: HTTP 503 with { statusCode: 503, error: "STORAGE_UNAVAILABLE", message: "Storage is temporarily unavailable" }; no URL or internal diagnostic is disclosed.

#### 1.8. retain-inherited-throttler-response

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Reach the configured existing global throttler limit with otherwise eligible playback requests.
     - expect: HTTP 429 with the inherited native throttler response.
