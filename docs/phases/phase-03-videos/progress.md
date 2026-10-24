# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 2/27 completed

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
- **Status:** pending
- **Tests:** not run
- **Observations:** none

### SI-03.4 — Implement Internal and Public S3 Storage Clients
- **Status:** pending
- **Tests:** not run
- **Observations:** none

### SI-03.5 — Create Video and Upload Session Persistence
- **Status:** pending
- **Tests:** not run
- **Observations:** none

### SI-03.6 — Add Owner-Scoped Persistence Services and Domain Errors
- **Status:** pending
- **Tests:** not run
- **Observations:** none

### SI-03.7 — Implement the Queue Producer with Bounded Failure
- **Status:** pending
- **Tests:** not run
- **Observations:** none

### SI-03.8 — Implement Upload Initiation and Public-ID Reservation
- **Status:** pending
- **Tests:** not run
- **Observations:** none

### SI-03.9 — Expose Upload Initiation
- **Status:** pending
- **Tests:** not run
- **Observations:** none

### SI-03.10 — Implement Part Signing and Resumption
- **Status:** pending
- **Tests:** not run
- **Observations:** none

### SI-03.11 — Expose Part URL Signing
- **Status:** pending
- **Tests:** not run
- **Observations:** none

### SI-03.12 — Expose Uploaded-Part Resumption
- **Status:** pending
- **Tests:** not run
- **Observations:** none

### SI-03.13 — Implement Serialized Upload Completion
- **Status:** pending
- **Tests:** not run
- **Observations:** none

### SI-03.14 — Expose Upload Completion
- **Status:** pending
- **Tests:** not run
- **Observations:** none

### SI-03.15 — Implement Abort and Deadline Resolution
- **Status:** pending
- **Tests:** not run
- **Observations:** none

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
