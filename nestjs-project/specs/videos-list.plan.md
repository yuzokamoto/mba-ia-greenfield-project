---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.22
target_file: nestjs-project/test/videos-list.e2e-spec.ts
---

# GET /videos Test Plan

## Application Overview

Lists only the authenticated user's own videos as a safe VideoResponseDto array, ordered deterministically by creation time and UUID. This private collection does not depend on a client-provided owner selector.

Source: `docs/phases/phase-03-videos/phase-03-videos.md` — SI-03.22 acceptance criteria, API Contracts, Authorization Matrix and Error Catalog. AC numbers refer to the acceptance-criteria bullet order within SI-03.22.

## Test Scenarios

### 1. GET /videos

**Setup:** Bootstrap the real AppModule once with Test.createTestingModule(), reproduce main.ts global ValidationPipe, exception filters and other global HTTP configuration, and use Supertest against the initialized Nest application. Before each scenario, truncate only the dedicated test database and seed independent authenticated users/channels and the required video/session fixtures. Use real PostgreSQL (db), MinIO (minio) and isolated Redis (redis) resources; configure all service connections through Compose service names. Isolate storage objects and queue jobs per scenario; keep worker consumption controlled when asserting processing intent. Close the application and owned resources after the suite. These are future test setup instructions; generating this spec does not start services or execute tests.

#### 1.1. list-only-own-videos-in-deterministic-order

**Covers AC:** #1, #3
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Seed two users and channels, several caller-owned videos across lifecycle states, and foreign-owned videos interleaved by created_at. Include caller videos with tied created_at values and distinct UUIDs.
  2. GET /videos with the caller's token and no body/query.
     - expect: HTTP 200 returns a bare VideoResponseDto[] containing exactly that caller's videos, with no wrapper.
     - expect: rows are ordered by created_at DESC, then id DESC for tied timestamps.
     - expect: no row from another channel owner appears; the ownership scope comes from channel.user_id = token sub.

#### 1.2. return-empty-collection-for-caller-without-videos

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Seed an authenticated user without any videos while foreign-owned videos exist. GET /videos as that user.
     - expect: HTTP 200 with exactly []; foreign rows are not used as a fallback.

#### 1.3. reject-missing-invalid-and-expired-token

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. GET /videos without a token and separately with invalid/expired tokens.
     - expect: HTTP 401 with { message: "Unauthorized", statusCode: 401 }; no collection is disclosed.

#### 1.4. serialize-safe-collection-and-preserve-owner-authority

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Seed own and foreign videos, including an own error fixture with internal diagnostics. GET /videos using the caller's token.
     - expect: every row has exactly id, public_id, channel_id, title, status, failure_reason, original_filename, content_type, declared_size, duration, metadata, created_at and updated_at with the documented types/nullability.
     - expect: failure_reason is null or invalid_media, processing_failed or upload_expired; no bucket/key, S3 UploadId, credentials, internal URLs, diagnostics, attempt bookkeeping or signed URL field appears.
  2. Attempt to nominate the foreign owner through request owner/channel/user data while keeping the caller's token.
     - expect: request data cannot grant access to foreign rows or change any persisted owner; token-derived scope remains authoritative.

#### 1.5. retain-inherited-throttler-response

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T21:35:32Z

**Steps:**
  1. Reach the configured existing global throttler limit with otherwise eligible listing requests.
     - expect: HTTP 429 with the inherited native throttler response.
