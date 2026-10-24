---
scope_type: phase
related_phases: [3]
status: pending
date: 2026-10-24
scope_description: "Phase 03 backend: queue, resumable S3 multipart uploads up to 10GB, FFmpeg worker, storage, unique URLs, streaming, downloads, and failure recovery in Docker Compose."
---

# Technical Decisions — Phase 03: Video Upload and Processing

_Subprojects in scope:_

- `nestjs-project/` — API, persistence, new video worker, S3/MinIO integration, and queue; TD-01 through TD-12 cover runtime concerns, and TD-13 covers infrastructure and tests in Compose.
- `next-frontend/` — deferred, outside the scope by the user's instruction; no frontend TD in this document. Upload UI, resumable client, player, and contract consumption will be planned separately.

---

## Research context and inherited constraints

The scope boundary is [Phase 03 and the Points of Attention](../project-plan.md). S3-compatible storage is a user constraint: local MinIO and production S3, using the same API. The worker filesystem may provide temporary storage but does not replace object storage. Publication, public/unlisted visibility, editing, and custom thumbnails belong to Phase 04; the watch page/player and anonymous access belong to Phase 05. Preparing the backend for playback neither implements those screens nor brings publication forward.

Inherited decisions, without reopening them:

- [phase-01-configuracao-base/TD-01 through TD-04](technical-decisions-phase-01-configuracao-base.md): `@nestjs/config`, Joi, `registerAs` namespaces, and configuration shared with the TypeORM CLI. The API and worker must follow these patterns.
- [phase-02-auth/TD-02, TD-03, TD-06, TD-07, and TD-09](technical-decisions-phase-02-auth.md): custom guards with `@nestjs/jwt`, refresh-token rotation, DTOs using class-validator/class-transformer, and `{ statusCode, error, message }` errors. Actual choices take precedence over conflicting earlier recommendations. Videos belong to the channel already created for each user.
- [openapi-docs-nestjs/TD-01 and TD-02](technical-decisions-openapi-docs-nestjs.md): `@nestjs/swagger` with its plugin and export of `nestjs-project/openapi.json`; new backend contracts follow this foundation, without another codegen TD.
- [next-frontend-config-base/TD-03](technical-decisions-next-frontend-config-base.md): API calls pass through the BFF; that TD already anticipates file transfers using object-storage URLs. The alternatives below describe the contract the backend provides to any client, without redesigning the BFF or implementing Next.js code.
- Root/subproject `AGENTS.md`: Docker execution, internal hosts addressed by service name, and serialized tests against the shared database. The testing guide requires a real broker in Docker; its earlier filesystem-storage guidance is superseded, within this scope, by the user's explicit instruction to test real S3-compatible storage in Compose. This research does not modify any guide.

### Installed versions and documentation lookup

Checked `nestjs-project/package.json`, `package-lock.json`, `tsconfig.json`, `Dockerfile.dev`, and `compose.yaml`. The repository does not yet have a video module, S3 client, queue, or FFmpeg configured.

| Component | Manifest / configuration | Lockfile-resolved version |
|------------|--------------------------|------------------------------|
| NestJS common/core/platform-express | `^11.0.1` | `11.1.16` |
| `@nestjs/config` | `^4.0.3` | `4.0.3` |
| `@nestjs/typeorm` / `typeorm` | `^11.0.1` / `^0.3.28` | `11.0.1` / `0.3.28` |
| `pg` / PostgreSQL | `^8.20.0` / image `postgres:17` | `8.20.0` / major 17 |
| TypeScript | `^5.7.3` | `5.9.3` |
| Jest / ts-jest / Supertest | `^30.0.0` / `^29.2.5` / `^7.0.0` | `30.3.0` / `29.4.6` / `7.2.2` |
| `@nestjs/swagger` | `^11.4.2` | `11.4.2` |
| Node.js | `node:25.6.0-slim` in `Dockerfile.dev` | Runtime defined by the image |

Library lookups were rerun through the project's Context7 MCP tools, discovered in the `exec` tool catalog with `ALL_TOOLS.filter(t => /context7/i.test(t.name))`: `mcp__context7__resolve_library_id` and `mcp__context7__query_docs`. The table records the returned IDs, versions offered, query results, and discrepancies against the installed or candidate versions. BullMQ, the Nest adapter, and both AWS packages remain uninstalled; their versions below are research candidates.

| Candidate library | Context7 resolution / documentation queried | Returned results and primary-source check / caveat |
|-----------------------|---------------------|-----------------------------------------|
| NestJS | `/nestjs/nest/v11.1.16`, `/nestjs/docs.nestjs.com` | The resolver offered `v11_1_6`, `v10_4_15`, `v10_4_6`, `v11.1.16`, `v12.0.1`, `v12.1.2`, and `v12.0.3`. The query against installed `v11.1.16` returned no matching documentation; the documentation index returned `createApplicationContext`, `app.close()`, and shutdown hooks. Retain the check against the [installed version's code](https://github.com/nestjs/nest/blob/v11.1.16/packages/core/nest-factory.ts); do not adopt Nest 12-only APIs. |
| BullMQ | Resolved `/taskforcesh/bullmq`; queried `/taskforcesh/bullmq/v6.3.11`; `/websites/bullmq_io` also offered | The only version offered was `v6.3.11`, versus candidate `6.4.2`. Results included Queue/Worker connection configuration and worker `maxRetriesPerRequest: null`, alongside legacy Bull and other-language examples that must not be applied as BullMQ TypeScript APIs. Retain the Redis-configuration check against the [6.4.2 tag](https://github.com/taskforcesh/bullmq/blob/v6.4.2/docs/gitbook/guide/connections.md). |
| `@nestjs/bullmq` | Resolved and queried `/nestjs/bull` | No version list was offered for this ID; results are from the repository's master documentation, not a pinned 12.0.0 snapshot. They declare Nest common/core `^10 || ^11 || ^12` and BullMQ `^3 || ^4 || ^5 || ^6`, and describe `WorkerHost`/`Processor` registration and worker shutdown. This agrees with the [official manifest for candidate 12.0.0](https://github.com/nestjs/bull/blob/master/packages/bullmq/package.json): the adapter major does not require migrating installed Nest 11.1.16. |
| PostgreSQL queue | Resolver returned `/websites/deepwiki_timgit_pg-boss` | No version list was offered, and the refreshed resolution did not return `/timgit/pg-boss`. Keep the analysis grounded in the project's own [official documentation](https://github.com/timgit/pg-boss/tree/master/docs) and [manifest](https://github.com/timgit/pg-boss/blob/master/package.json), rather than treating the DeepWiki result as a versioned primary source. |
| RabbitMQ | Resolved and queried `/amqp-node/amqplib` | No version list was offered; results describe confirm-channel `waitForConfirms()` behavior. Confirmation/ack APIs remain cross-checked with the [broker documentation](https://www.rabbitmq.com/docs/confirms). |
| AWS SDK JavaScript v3 — `client-s3` | Resolved `/aws/aws-sdk-js-v3`; queried `/aws/aws-sdk-js-v3/v3.1153.0` | Resolving the literal package name initially returned unrelated clients/mocks and the S3 service index; resolving AWS SDK for JavaScript v3 returned the official SDK repository and offered only `v3.1153.0`. Results cover custom `S3Client` endpoints, client/command imports, and the multipart upload helper. **Discrepancy:** indexed `3.1153.0` versus candidate `3.1156.0`; keep the v3 API and check the implementation's pinned patch, without adopting SDK v2 methods. |
| AWS SDK JavaScript v3 — `s3-request-presigner` | Queried the same SDK ID, `/aws/aws-sdk-js-v3/v3.1153.0`, specifically for the presigner | Results from `packages/s3-request-presigner/README.md` show `getSignedUrl` with `S3Client`/`GetObjectCommand`, `expiresIn`, and signed-header controls. The same `3.1153.0` versus candidate `3.1156.0` discrepancy applies; keep both AWS packages on the same pinned patch. |
| tus | Resolved and queried `/tus/tus-node-server` | No version list was offered; results describe the S3 store's multipart writes, offset recovery, expiration cleanup, and termination. Retain the [official protocol](https://tus.io/protocols/resumable-upload) and S3-store implementation as references. |
| Short IDs | Resolved and queried `/ai/nanoid` | No version list was offered. Current results describe Nano ID 6 as ESM-only and return Node engines `^22 || ^24 || >=26`; this excludes the project's Node 25. The [manifest](https://github.com/ai/nanoid/blob/main/package.json) remains the compatibility reference; do not recommend installing latest in the current runtime. |
| TypeORM | Resolved `/typeorm/typeorm`; queried `/typeorm/typeorm/0.3.27` | Versions offered: `0.2.45`, `1.1.1`, and `0.3.27`. Results show `DataSource.transaction` and require all transaction operations to use its provided EntityManager. **Discrepancy:** installed `0.3.28` is not offered; retain the transaction check against the [0.3.28 tag's documentation](https://github.com/typeorm/typeorm/blob/0.3.28/docs/docs/advanced-topics/2-transactions.md). |
| FFmpeg | Resolved and queried `/websites/ffmpeg_documentation` | No version list was offered for this documentation ID; separate Doxygen 8.0 and 4.4 IDs were also returned. Query results cover thumbnail filtering and limited-frame extraction. Official ffprobe, format, and filter documentation remains the reference; the repository has no pinned worker binary/image yet. Pin the binary version and capabilities during planning/implementation. |

Candidate versions checked in the npm registry during the initial research on 2026-10-24: `@nestjs/bullmq` 12.0.0, `bullmq` 6.4.2, `ioredis` 6.0.0, `pg-boss` 12.38.0, `amqplib` 2.2.0, `@tus/server` 2.4.6, `@tus/s3-store` 2.0.9, and `@aws-sdk/client-s3`/`@aws-sdk/s3-request-presigner` 3.1156.0. These are candidates, not installed dependencies, and are not versions inferred from the refreshed Context7 results. Their Node requirements are compatible with 25.6.0; pg-boss requires Node >=22.12 and PostgreSQL >=13. Declared compatibility does not replace compilation and adapter testing in the project.

The operational numbers suggested below are **proposals for a decision**, not additional requirements discovered in the plan. Their identifiable sources are the 10GB limit, resumability, storage cost, and heavy processing in the Points of Attention. All `Decision` fields remain pending; `Libraries` identifies only dependencies of the recommendation or the specified alternative.

---

## TD-01: Processing Queue Technology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The queue remains TBD in the plan and C4 diagram; no earlier TD selected it. Processing jobs must survive restarts, have bounded attempts, and support consumption separately from the API. PostgreSQL already exists; Redis or RabbitMQ would add a service. The NestJS guide's BullMQ recommendation is an input, not an inherited decision.

**Options:**

### Option A: BullMQ with Redis and the NestJS adapter

The API publishes small jobs containing identifiers, and the worker consumes them through Redis. `@nestjs/bullmq` provides DI and lifecycle integration; the [NestJS documentation](https://docs.nestjs.com/techniques/queues) distinguishes actively developed BullMQ from maintenance-mode Bull.

- **Pros:** Official integration, retries/backoff, and concurrency support; separates queue traffic from the business database.
- **Cons:** Another service and its persistence to operate; the database and queue do not share a transaction, requiring TD-10.

### Option B: pg-boss on PostgreSQL

Jobs live in a dedicated schema in the existing PostgreSQL database. The library supports [publishing within an external transaction](https://github.com/timgit/pg-boss/blob/master/docs/api/adapters.md), through an adapter that uses the same transactional connection.

- **Pros:** No additional broker; can make saving the video and creating its job atomic in the database.
- **Cons:** Shares connections, maintenance, and I/O with business data; Nest/TypeORM integration requires a custom adapter. SQL atomicity does not make S3/FFmpeg operations exactly once.

### Option C: RabbitMQ with amqplib

Uses a durable queue, persistent messages, publisher confirms, and manual acknowledgements. [Confirms and consumer acknowledgements](https://www.rabbitmq.com/docs/confirms) address different delivery stages; delayed retries and discarding require an explicit policy.

- **Pros:** Independent broker, AMQP routing, and consumers in other languages; controls prefetch and processing acknowledgements.
- **Cons:** More assembly for a single job type: reconnection, backoff, dead-letter handling, and DI integration; also requires TD-10.

### Option D: BullMQ 6 with the PostgreSQL backend

Retains the BullMQ Queue/Worker API and selects `createPostgresBackend`. The [official backend](https://docs.bullmq.io/guide/postgresql) supports PostgreSQL >=13 and describes Redis as the more established option.

- **Pros:** Avoids Redis while preserving the BullMQ API; PostgreSQL 17 meets the requirements.
- **Cons:** Shares database resources; integration of the factory with the Nest adapter must be proven. Using the same SQL server does not guarantee participation in the TypeORM transaction.

**Recommendation:** **Option A (BullMQ + Redis)** — Nest integration and isolation of queue load favor this phase's worker, accepting an additional service and dual-write recovery in TD-10; B is a strong alternative if reducing services is the priority, with no scale evidence making Redis mandatory.

**Decision:** _[pending]_

**Libraries:** Proposed: `@nestjs/bullmq` 12.0.0, `bullmq` 6.4.2, `ioredis` 6.0.0; Redis with a pinned, compatible version/image. Alternatives: `pg-boss` 12.38.0 or `amqplib` 2.2.0; D uses BullMQ and the existing `pg`.

---

## TD-02: Large, Resumable Upload Protocol

**Scope:** Backend

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** The Points of Attention require resuming after a connection failure. The bytes must not occupy a long-running API request; the backend controls authorization and sessions. A single PUT cannot resume completed parts and is not a suitable alternative for the requirement.

**Options:**

### Option A: Direct S3 multipart with presigned URLs per part

The API starts a session and signs parts; the client transfers directly to storage and asks the API to complete the upload. [S3 multipart](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html) supports retrying failed parts, pausing, and resuming without resending completed parts.

- **Pros:** Large transfers stay outside the API; native S3/MinIO protocol; parallelism and per-part resumption.
- **Cons:** The backend must persist the session, check the manifest, and recover ambiguous completion; the future client must retain the session reference and provide the same file again.

### Option B: Separate tus gateway with an S3 store

A dedicated upload service receives PATCH/HEAD requests using the [tus](https://tus.io/protocols/resumable-upload) protocol and writes to S3; the API only authorizes and receives completion. The [official Node server](https://github.com/tus/tus-node-server) has an S3 store.

- **Pros:** Offset-based resumption and a standardized protocol with existing clients; the API also stays outside the bytes' path.
- **Cons:** A new gateway transfers the entire video before it reaches storage; adds delegated authentication, hooks, and session/lock coordination.

**Recommendation:** **Option A (presigned S3 multipart)** — uses the mandatory storage and eliminates a transfer gateway, keeping persisted sessions, renewed signatures for missing parts, authorized completion/abort, and `ListParts` reconciliation in the backend as described in TD-11.

**Decision:** _[pending]_

**Libraries:** Proposed: `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` v3, on the same patch; alternative B: `@tus/server` and `@tus/s3-store`. No frontend library is selected.

---

## TD-03: S3 Bucket and Key Organization

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** The S3-compatible provider is already fixed. The decision is how to separate originals, derivatives, and thumbnails without exposing drafts or depending on user-supplied names. The API, worker, cleanup, and signing must interpret the same references.

**Options:**

### Option A: One private bucket per environment, with video and session prefixes

A proposed layout is `videos/{videoId}/sources/{sessionId}/original`, `videos/{videoId}/outputs/{generation}/playback.mp4` when TD-06 selects a derived MP4, and `videos/{videoId}/outputs/{generation}/thumbnail.jpg`. With TD-06/D, the original key is also the playback source, without a duplicate object. The database stores bucket/key and the original filename separately; URLs are generated at access time.

- **Pros:** Simple provisioning; keys independent of title/name; generations isolate reprocessing and prevent overwrites by old jobs.
- **Cons:** Permission and cleanup policies must distinguish prefixes; one bucket holds all artifact types.

### Option B: Separate private buckets for sources and derivatives

Originals live in one bucket and playback/thumbnails in another, retaining keys with immutable identifiers. Permissions and retention are configured separately.

- **Pros:** More explicit access and retention boundaries; simplifies operational evolution by file class.
- **Cons:** More buckets, CORS configuration, and policies to maintain; no current requirement for distinct retention or regions imposes this split.

**Recommendation:** **Option A (private bucket + immutable prefixes)** — covers videos and thumbnails with less configuration, using AWS SDK v3 against both providers and granting individual access through signed URLs; bucket names are configurable per environment, and no expired URL is persisted as the video's identity.

**Decision:** _[pending]_

**Libraries:** Proposed: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` v3; inherited `@nestjs/config` and Joi. Configure `endpoint`/`forcePathStyle` for MinIO according to the [SDK v3 API](https://github.com/aws/aws-sdk-js-v3/blob/v3.1153.0/UPGRADING.md), without introducing a filesystem driver for development.

---

## TD-04: Video Worker Execution and Boundary

**Scope:** Backend

**Capability:** Transversal — covers: "Serviço de processamento em segundo plano (filas)", "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** The C4 already specifies a separate FFmpeg Video Worker. Both paths below use a process and container independent of the API; the choice is whether to share the Nest application or maintain another service. FFmpeg/ffprobe are native binaries in the worker image.

**Options:**

### Option A: Nest standalone entrypoint inside nestjs-project

A dedicated bootstrap uses `createApplicationContext` and imports only modules needed for consumption, storage, and the video domain. It shares domain code with the API, without an HTTP listener or importing the entire AppModule; FFmpeg/ffprobe run as asynchronous subprocesses.

- **Pros:** Reuses DI, configuration, and domain rules; coordinated build and testing with the current stack; the API does not register consumers.
- **Cons:** The API and worker share a code release; the worker image must include its own binaries and temporary space.

### Option B: Independent Node service, still under nestjs-project

Maintains its own bootstrap, dependency composition, and build, consuming the queue protocol and persisted data. Communicates with the same storage and database without loading the Nest context.

- **Pros:** Smaller dependency and execution footprint; permits independent evolution and deployment.
- **Cons:** Must share/version job contracts and video-update rules; duplicating domain access violates the project's single-responsibility requirement.

**Recommendation:** **Option A (Nest standalone in a video-worker container)** — preserves existing domain services and configuration with resource isolation from the API; start with concurrency 1 per worker, CPU/memory/disk limits, timeouts, and subprocess termination on shutdown, increasing only after measurement.

**Decision:** _[pending]_

**Libraries:** NestJS 11.1.16 and TD-01 dependencies; `node:child_process` for asynchronous `spawn`/`execFile`, without passing user data through a shell. Sources: [standalone context](https://github.com/nestjs/docs.nestjs.com/blob/master/content/application-context.md), [Node 25.6.0 API](https://nodejs.org/download/release/v25.6.0/docs/api/child_process.html). `fluent-ffmpeg` is not a candidate: its [repository announces discontinuation](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg).

---

## TD-05: Media Access for Metadata and Thumbnail Extraction

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** Extraction needs duration, streams/codecs, dimensions, and a valid frame. [ffprobe](https://ffmpeg.org/ffprobe.html) provides structured format/stream output; FFmpeg can extract a frame with frame-count and scaling limits. The strategic decision is where seekable reading happens, not which wrapper to call. This depends on TD-06: A/B/C create playback derivatives and may benefit from a shared local input, whereas D leaves the original unchanged and requires only probing and thumbnail extraction, removing playback preparation as a reason to stage the full source.

**Options:**

### Option A: Staging on the worker's temporary disk

The worker downloads the original through a stream with backpressure into a file isolated per job. It runs ffprobe with JSON output and FFmpeg against the local file, uploads results, and removes temporary files; [thumbnail filtering/extraction](https://ffmpeg.org/ffmpeg-filters.html#thumbnail) avoids keeping the entire video in memory.

- **Pros:** Predictable local seeking, including metadata at the end; one copy can serve probing, frame extraction, and playback preparation if TD-06 selects A/B/C, or help when remote demuxer access is inefficient.
- **Cons:** Requires space for input and any outputs and adds a complete transfer before extraction; with TD-06/D, this full local copy is paid for solely to probe and extract one thumbnail, without reuse for playback preparation.

### Option B: Seekable remote reading through HTTP Range

FFmpeg/ffprobe read a restricted URL generated by the backend/worker for the known object, with remote seek support. The [FFmpeg HTTP protocol](https://ffmpeg.org/ffmpeg-protocols.html#http) documents seekability detection and ranged-read controls; a simple pipe is not a universal substitute for a seekable file.

- **Pros:** Can reduce bytes read for probing/thumbnails and avoid full-input disk space; especially suitable with TD-06/D, since only metadata and a thumbnail are generated and no playback file needs preparation.
- **Cons:** Repeated Range requests, signature/timeout behavior, and demuxer support make costs less predictable; some inputs still require substantial reads, so savings are not guaranteed. If TD-06 selects A/B/C, derivative generation adds its own I/O and output-storage needs, which this option does not remove.

**Recommendation:** **Option B (seekable remote reading)** with the recommended TD-06/D — avoids making a full 10GB local transfer a prerequisite for probe + thumbnail, accepting variable Range traffic and validating bounded reads/timeouts against the chosen storage and worker image; reconsider A if derivative generation is selected or measured remote access is inefficient, while retaining an in-duration frame with a start-frame fallback for short clips as an extraction heuristic rather than a product requirement.

**Decision:** _[pending]_

**Libraries:** Native FFmpeg and ffprobe, `node:stream`, `node:fs`, `node:child_process`, S3 SDK v3. Relevant JSON is validated before persisting finite/positive duration and metadata; allow only the protocols needed for controlled local files or backend-generated HTTP(S) storage URLs, never arbitrary user URLs or external media references embedded in uploaded files.

---

## TD-06: Playable Format and Processing Scope

**Scope:** Backend

**Capability:** Reprodução via streaming (sem necessidade de download completo)

**Context:** Range delivers bytes but does not convert codecs; an index at the end can require additional seek requests rather than a mandatory full download when the client and storage support Range. The plan does not require accepting every format, universal transcoding, adaptive bitrate, or normalized startup behavior. The processing and compatibility contract must be explicit: `ready` requires successful metadata/thumbnail processing and an available playback source, but does not imply that every browser can decode an unchanged original.

**Options:**

### Option A: Limited input profile and progressive MP4 prepared by remuxing

Initially propose MP4 with H.264 8-bit/yuv420p and AAC audio when present; ffprobe validates the actual profile rather than only extension/MIME. Prepare an MP4 artifact with its index at the beginning using stream copy/`faststart`, without re-encoding; [FFmpeg documents moving the moov](https://ffmpeg.org/ffmpeg-formats.html#mov_002c-mp4_002c-ismv).

- **Pros:** Less processing and no re-encoding quality loss; supports progressive playback of the supported profile.
- **Cons:** Other containers/codecs are rejected with an explicit error; the prepared copy can double the original's storage footprint.

### Option B: Normalize accepted formats to one MP4 representation

Accepts a broader input allowlist and converts in the worker to H.264/AAC/MP4 prepared for playback. Retains the original for download and a derivative for playback, without generating a quality ladder.

- **Pros:** More files become playable in a consistent format; separates original fidelity from playback compatibility.
- **Cons:** CPU, time, space, and potential re-encoding loss; requires a quality policy and input matrix the plan has not specified.

### Option C: HLS packaging

Produces a manifest and segments in the worker, starting with one representation. Reading becomes segment-based; multiple qualities would be a later extension, not an implicit phase requirement.

- **Pros:** Natural path to segmented delivery and future bitrate adaptation.
- **Cons:** More objects, manifest/segment access rules, and client contract; downloading still depends on the original or another artifact.

### Option D: Stream the original object as uploaded

Use the uploaded original as the playback source, without a derived playback artifact, remuxing, or transcoding; the worker only probes metadata and generates the thumbnail. A seek-capable browser/player can fetch a trailing MP4 `moov` index through additional Range requests before reading media samples instead of waiting for the entire object; this follows [HTTP byte-range semantics](https://www.rfc-editor.org/rfc/rfc9110.html#section-14.1.2) and the [WebKit media-engine discussion of seeking and trailing moov](https://bugs.webkit.org/show_bug.cgi?id=221622#c1), and is not a guarantee for every client.

- **Pros:** No extra storage copy, addressing the Points of Attention's storage-cost concern; no remux/transcode CPU work or full-file output pass to create a second 10GB object. Playback and download reuse the original; the worker's remaining work is probe + thumbnail.
- **Cons:** Additional Range requests can increase startup latency, and client/server seek support is essential. [Container/codec support varies by browser](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Containers#mpeg-4_mp4), so playability becomes a client concern rather than a server-normalization guarantee; probe/frame reads still consume I/O and decoding work, and incompatible clients may not play an otherwise valid original.

**Recommendation:** **Option D (stream the unchanged original)** — best fits this phase's 10GB and storage-cost concerns without adding a normalized-playback requirement, avoiding an additional full-file preparation pass and copy while accepting client-dependent codec support and extra index-seek requests; expose detected container/codec metadata and verify startup/seeking on representative compatible clients, retaining A when predictable index placement and a restricted profile justify the extra copy, or B when broader normalized compatibility is required.

**Decision:** _[pending]_

**Libraries:** Native FFmpeg/ffprobe. Choice A requires a prepared playback artifact; B would require compatible encoders in the image; C would require the HLS muxer; D needs only probe + thumbnail processing and TD-08's Range-capable delivery of the original. The API must document the selected processing/compatibility policy and detected formats without selecting a player or frontend library.

---

## TD-07: Short, Stable, Conflict-Free URL

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** The Points of Attention call for a short URL that never conflicts. The logical URL must survive changes to title, bucket, or signature. Randomness reduces collisions, but the guarantee against assigning the same identifier to two videos comes from database uniqueness and concurrent insert handling.

**Options:**

### Option A: Random public identifier separate from the internal UUID

Proposes 12 base64url characters derived from 9 CSPRNG bytes, reserved with a UNIQUE constraint and retried on collision. The API resolves this identifier to the video; [Node provides randomBytes](https://nodejs.org/download/release/v25.6.0/docs/api/crypto.html#cryptorandombytessize-callback) and [PostgreSQL enforces uniqueness](https://www.postgresql.org/docs/17/ddl-constraints.html#DDL-CONSTRAINTS-UNIQUE-CONSTRAINTS).

- **Pros:** Short and independent of storage/title; uses a native library and retains existing internal UUIDs.
- **Cons:** Collisions remain possible during generation; requires bounded insert retries and permanent reservation to prevent future reuse.

### Option B: PostgreSQL sequence encoded in base62

A global sequence generates distinct numbers, encoded without truncation into a short form. Reservation stays in the same database and values are never reused.

- **Pros:** Deterministic uniqueness and small identifiers, without random collisions.
- **Cons:** Easy enumeration and approximate volume/order disclosure; makes the central sequence part of the public contract.

### Option C: Full UUID in the URL

Reuses the persisted UUID as the logical identifier. The PK constraint prevents accepting duplicates; it does not depend on title or S3 path.

- **Pros:** Less state and generation already familiar in the project; avoids a second identification index.
- **Cons:** Longer than the explicit short-URL goal; subsequently shortening/truncating a UUID reintroduces collisions.

**Recommendation:** **Option A (12-character random public ID + UNIQUE)** — balances a short URL with generation without external coordination, bounded retries without overwriting, an immutable ID, and reservation retained even after future deletion; reservation failure returns an error instead of publishing a conflict.

**Decision:** _[pending]_

**Libraries:** `node:crypto`, TypeORM 0.3.28, and PostgreSQL 17; no new dependency. Nano ID was researched but is unnecessary, and its latest 6.0.2 does not declare support for the current Node 25.

---

## TD-08: Streaming and Download Delivery

**Scope:** Backend

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** The C4 specifies consumers reading from storage. A stable logical URL (TD-07) and a byte-delivery URL serve different roles. [S3 GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html) accepts Range and signed Content-Disposition overrides; [HTTP 206/Content-Range](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.7) supports delivering portions without downloading everything.

**Options:**

### Option A: Backend authorizes; storage delivers through presigned GET

The API returns a temporary playback URL and another URL to download the original with `attachment` and a safe filename. The client sends Range to storage; a valid range receives 206 and a range outside the object receives 416, while a complete GET can receive 200.

- **Pros:** Streaming/download bytes stay outside the API; uses storage's native mechanism and preserves the original file for downloading.
- **Cons:** The link acts as a credential until it expires; new seeks/reconnections may require another signature, and consumers must be able to reach the signed endpoint.

### Option B: Backend proxies reads with Range

The API authorizes and forwards Range to GetObject, streaming the result with backpressure and corresponding headers/status. Playback and downloads use stable backend endpoints.

- **Pros:** Access control on every request and a hidden storage address; supports immediate revocation between reads.
- **Cons:** The API and network carry long sessions and video bandwidth; increases cost and requires custom handling of cancellation, 206, 416, and conditionals.

**Recommendation:** **Option A (direct presigned GET)** — follows the C4 and keeps bandwidth outside the API, issuing links only after access-policy and readiness checks, with configurable duration, authorized renewal, and download headers set in the signature; technical access in this phase belongs to the owner, without making a draft public because it is `ready`.

**Decision:** _[pending]_

**Libraries:** S3 SDK v3 and presigner; B's proxy would use existing Node/Express streams. [Presigned URLs are reusable until expiration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html); the public ID is not a credential, and authorization does not depend on keeping the object name secret.

---

## TD-09: Processing Lifecycle and Failure Policy

**Scope:** Backend

**Capability:** Transversal — covers: "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload", "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** The phase creates a draft before the bytes arrive and must explain asynchronous failures. Phase 04 publication is a separate axis: `ready` proves technical readiness, not public visibility. The database must retain business truth even after queue history is cleaned up.

**Options:**

### Option A: Compact technical state with separate session and attempts

Uses `draft → processing → ready | error`; `processing` includes queue wait and backoff. The session tracks upload progress/completion, and the processing record tracks generation, attempts, and error; `ready` is reached only after valid duration/metadata and thumbnail are persisted and the selected playback source is available (the original in TD-06/D, a derivative where required).

- **Pros:** Small, stable contract; separates upload resumption, technical execution, and future publication.
- **Cons:** Detailed diagnosis requires consulting the session/attempts; `processing` alone does not distinguish waiting from execution.

### Option B: Detailed technical state machine on the video

Exposes `draft`, `uploading`, `uploaded`, `queued`, `probing`, `thumbnailing`, `preparing_playback`, `ready`, and `error`, still independent of publication. Attempts and the final result remain persisted in the database.

- **Pros:** Explicit stage visibility without an additional query; can guide operational monitoring.
- **Cons:** Couples the contract to internal stages and multiplies transitions to recover across crashes, retries, and pipeline changes.

**Recommendation:** **Option A (four persisted technical states)** — meets the requested lifecycle without bringing publication forward, proposing three total attempts with exponential backoff for transient failures, an immediate terminal error for invalid media or media incompatible with the selected processing policy, and `error` after exhaustion; authorized reprocessing opens a new generation, without infinite retries or regression of a generation already ready. Under TD-06/D, lack of codec support in a particular client alone is not a processing failure.

**Decision:** _[pending]_

**Libraries:** TypeORM 0.3.28 and the TD-01 queue; BullMQ provides [attempts/backoff](https://docs.bullmq.io/guide/retrying-failing-jobs). Persist a safe failure code and bounded internal diagnostics; dead/stalled worker reconciliation belongs to TD-10, without relying exclusively on an event callback to persist the final error.

---

## TD-10: Consistency Across S3 Completion, Database, and Queue

**Scope:** Backend

**Capability:** Transversal — covers: "Serviço de processamento em segundo plano (filas)", "Processamento automático do vídeo após upload (extração de duração e metadados)"

**Context:** TD-01's Redis recommendation creates two independent writes: state in PostgreSQL and a job in the broker. S3 may also complete even if its response is lost; there is no distributed transaction across all three. A video must not be forgotten because one of these steps failed.

**Options:**

### Option A: Transactional outbox and idempotent reconciliation

After verifying the completed object, the API writes `processing` and an outbox event in the same transaction; a dispatcher publishes with a deterministic ID per video/generation. A reconciler recovers ambiguous S3 completion, pending outbox entries, and processing without a valid lease/heartbeat; [outbox requires an idempotent consumer because delivery can be duplicated](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html).

- **Pros:** Processing intent is durable and auditable; a broker outage neither loses work nor holds the request waiting indefinitely for reconnection.
- **Cons:** Adds an outbox, dispatcher, and reconciliation policy; more expensive than publishing directly after saving.

### Option B: Video as durable intent, without an outbox table

Records a pending generation on the video, attempts enqueueing, and has a scanner resend generations without a valid job/execution. The scanner is a mandatory part of the path, not an occasional manual repair.

- **Pros:** Fewer entities and one source of truth; sufficient for a single pipeline if the scanner and its tests are complete.
- **Cons:** Overloads the video record with delivery control; publishing, concurrency, and detection of lost work become less explicit.

### Option C: Enqueue in the same PostgreSQL transaction

If TD-01 selects pg-boss, an adapter uses the TypeORM transactional connection to insert the video and job together. S3 recovery and artifact idempotency remain necessary because they do not participate in the SQL commit.

- **Pros:** Removes the PostgreSQL/broker gap without an outbox dispatcher.
- **Cons:** Depends on TD-01 and proving that the adapter uses the same connection; merely replacing Redis with the BullMQ PostgreSQL backend does not achieve this.

**Recommendation:** **Option A (outbox + reconciliation)** for TD-01/A — makes processing intent explicit, combining queue deduplication with conditional writes per generation and a database lease; redelivered or old jobs cannot overwrite current results, and reconciliation must also recover jobs lost after dispatcher confirmation.

**Decision:** _[pending]_

**Libraries:** TypeORM 0.3.28, PostgreSQL 17, and the selected queue; no additional outbox library. `jobId` does not replace permanent idempotency: BullMQ stops deduplicating an ID whose job was removed, as explained in the [job-ID documentation](https://docs.bullmq.io/guide/jobs/job-ids); the durable generation guard remains in the database.

---

## TD-11: Draft Persistence, Resumable Session, and Ownership

**Scope:** Backend

**Capability:** Transversal — covers: "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload", "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance"

**Context:** The video must exist when upload starts, including if the client disconnects. Resumption must survive API restarts and know the owner, key, expected size, and uploadId; process memory is insufficient. Authentication and the user/channel relationship are already decided, and there is no requirement for teams or a generic ACL.

**Options:**

### Option A: Separate Video and UploadSession records in PostgreSQL

The video holds identity, channel, and readiness; the session holds the S3 uploadId, immutable key, expected size, expiration, and completion stage. An idempotent start intent avoids duplicate drafts when the same request is repeated; new sessions do not reuse old keys.

- **Pros:** Resumes after restart and preserves the same video when a session must be replaced; separates technical transfer states from durable identity.
- **Cons:** Another entity and coordination to allow only the active session; multipart creation can leave an orphan if the API crashes before persisting the response.

### Option B: A single Video table with upload fields

The draft also holds uploadId, expiration, and current-attempt details. Replacing the session updates these fields while maintaining a generation that invalidates old jobs/signatures.

- **Pros:** Fewer joins and entities; viable if only the current attempt needs to be retained.
- **Cons:** Mixes temporary and permanent fields; recovery of replaced sessions and orphan cleanup have less history available.

**Recommendation:** **Option A (Video + UploadSession)** — keeps identity and ownership in the video domain and resumption in the upload domain, with short transactions and `channel.user_id` checks on initiation, retrieval, signing, completion, abort, and reprocessing; no endpoint treats arbitrary bucket/key/uploadId values as authority, and drafts remain restricted to their owner.

**Decision:** _[pending]_

**Libraries:** TypeORM 0.3.28/PostgreSQL 17; S3 SDK v3. Resumption cross-checks the received manifest against [ListParts](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListParts.html), including pagination; completion uses verified numbers/ETags and checks size/metadata through [HeadObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html). Repeated completion requests are serialized per session and reconciled using the known key: [CompleteMultipartUpload may return an error even after starting a 200 response](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CompleteMultipartUpload.html). Do not keep an SQL transaction open during byte transfer.

---

## TD-12: Operational Limits, Expiration, and Upload Cleanup

**Scope:** Backend

**Capability:** Transversal — covers: "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance", "Serviço de armazenamento de arquivos (vídeos e thumbnails)"

**Context:** The Points of Attention require resumption and storage-cost planning. This requires distinguishing a recoverable disconnection from abandonment and bounding resource use. The plan has no channel quota, maximum duration, or daily limit: none is added here.

**Options:**

### Option A: Short session window with automatic cleanup

Proposes a session lasting up to 24 hours from creation, 15-minute part signatures renewable within that window, and reconciliation cleanup, with incomplete-multipart lifecycle cleanup after 2 days as an additional safeguard. Abort expires the session and releases parts; the draft/ID remains reserved and can start another session.

- **Pros:** Resumes common failures with bounded abandonment costs; the table and storage have predictable closure.
- **Cons:** A very slow transfer may require a new session; lifecycle cleanup is not immediate and does not replace cleanup of completed/orphaned objects.

### Option B: Extended window for intermittent connections

Proposes a 7-day session and incomplete-multipart lifecycle cleanup after 8 days, retaining short, renewable signatures. The same authorization and cleanup controls apply.

- **Pros:** Greater tolerance for long pauses; reduces transfer restarts on slow connections.
- **Cons:** More abandoned parts occupying space and a longer session-tracking period; no explicit requirement for resumption across several days.

**Recommendation:** **Option A (24h, with an explicit limit and measurement-based review)** — proposes interpreting 10GB as `10_000_000_000` bytes, 64MiB parts, and suggested consumer concurrency of four parts, validating expected size and actual size of every part before completion and final size before processing; oversized files are aborted/rejected without trusting client-declared MIME or size, and suggested concurrency is not a storage-enforced quota.

**Decision:** _[pending]_

**Libraries:** S3 SDK v3, inherited ConfigModule/Joi, and TD-10's reconciliation mechanism. The [S3 multipart limits](https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html) accommodate this proposal (5MiB minimum for nonfinal parts, up to 10,000 parts); [multipart lifecycle cleanup](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-abort-incomplete-mpu-lifecycle-config.html) removes incomplete parts, not complete objects. Validate this operation against the chosen MinIO image: current documentation redirects to AIStor and does not automatically prove parity for a community image. Valid originals do not expire automatically; temporary files and unreferenced derivatives have separate cleanup protected against active jobs.

---

## TD-13: Compose Infrastructure and Real Upload/Processing Tests

**Scope:** Repo-wide

**Capability:** Transversal — covers: "Serviço de armazenamento de arquivos (vídeos e thumbnails)", "Serviço de processamento em segundo plano (filas)", "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance", "Reprodução via streaming (sem necessidade de download completo)"

**Context:** The new infrastructure must be reproducible with the API, worker, storage, and broker. The project already uses `nestjs-project/compose.yaml` for the backend; the independent frontend stack will not be unified with it. A real database and broker are inherited; real S3-compatible storage is an explicit constraint of this scope, without replacing integration contracts with mocks.

**Options:**

### Option A: Extend backend Compose and isolate test resources

Add MinIO, bucket/policy initialization, the chosen queue, and `video-worker` to the existing Compose file. Tests retain the current test database and serial execution, with an exclusive test bucket/prefix and queue; consumers explicitly target these resources.

- **Pros:** One backend environment reproduces production locally; reuses the current test workflow and reduces the number of topologies to maintain.
- **Cons:** The worker and cleanup tasks also need isolation; a development consumer must not compete for the test queue or clean its objects.

### Option B: Dedicated ephemeral Compose project per test execution

Start an isolated project with equivalent services, its own volumes and networks, and an override to avoid port conflicts. Suites remain serialized within each project, preserving the shared-database restriction.

- **Pros:** Isolation between executions and restart testing without affecting development.
- **Cons:** More expensive startup and teardown; requires port/configuration adjustments and another composition to verify, without a current need for parallel test executions.

**Recommendation:** **Option A (existing backend Compose + isolated test resources)** — fits the adopted Docker environment without changing the frontend, with real PostgreSQL/MinIO/queue integration and real FFmpeg in the worker path; use unit tests for branches and deterministic failures, and integration/e2e tests for external contracts and recovery.

**Decision:** _[pending]_

**Libraries:** Existing Docker Compose, Jest 30.3.0, ts-jest 29.4.6, and Supertest 7.2.2; S3 SDK and the queue from preceding decisions. The recommendation requires neither Testcontainers nor a new runner.

---

## Validation implications and deferred work

These are contracts to prove during implementation, not a suite executed by this research:

- Real multipart: interrupt after one part, restart the API, and resume the same session by sending only missing parts; expire/renew signatures; repeat initiation/completion; abort and clean up. Confirm rejection of another owner's session and actual sizes inconsistent with declarations. A multipart ETag must not be treated as the entire file's MD5.
- Real worker: verifiable duration/metadata and JPEG from a small clip; invalid media or incompatibility with the selected processing policy becomes a terminal error; transient failures obey attempt limits; a missing thumbnail or selected playback source prevents `ready`. Under TD-06/D, confirm that playback references the original, no derived playback copy is generated, and client-only codec incompatibility does not become a processing failure. Terminate the worker during a job and demonstrate recovery without writing an old result over a new generation.
- Durability: broker unavailable after completion, crash after outbox commit, S3 completion with a lost response, and duplicate publishing; prove that work ends in `ready`/`error`, with persisted error information, rather than becoming invisible or stuck indefinitely.
- Real delivery: complete signed GetObject, initial Range and intermediate seek with 206/Content-Range, invalid range with 416, and download with Content-Disposition attachment. For TD-06/D, include compatible MP4s with `moov` before and after media data, and verify startup and seeking without full download in representative clients; measure request/byte counts rather than assuming identical behavior. Test signatures against the hostname actually used by the consumer, not only internal SDK access.
- Limit: automated byte-boundary tests, real small parts for the multipart flow, and a controlled trial with an **actual 10GB file**, observed API/worker memory, and a responsive control endpoint during transfer. A small file proves the protocol, not 10GB capacity/performance; the latter requires measurement in the defined environment, without inventing a latency SLA.
- Isolation: database cases in `*.integration-spec.ts` and HTTP cases in `test/*.e2e-spec.ts`, `--runInBand` execution, exclusive queues/objects, and closing connections/consumers before cleanup. Module tests check API and worker DI; final technical verification of the implementation includes the full suite, `tsc --noEmit`, and lint inside the container.

For the Redis recommendation, enable AOF persistence and `noeviction`, following the [BullMQ operational guidance](https://docs.bullmq.io/guide/going-to-production); this does not replace TD-10 reconciliation. Messages carry references/generation, never video bytes, credentials, or long-lived signed URLs.

Internal connections use service names (`db`, `minio`, `redis`, `video-worker`), according to [Compose networking](https://docs.docker.com/compose/how-tos/networking/). The signing endpoint for consumers needs a hostname they can reach that is consistent with the signature; do not rewrite host/path after signing. Use a DNS name/domain routed to the storage service, also resolvable inside test containers, without configuring service hosts as `localhost`/`127.0.0.1`. Concrete DNS/ingress adjustments will be detailed in the backend plan.

Configure storage CORS for permitted origins and operations actually used, exposing ETag and required Range headers, according to the [S3 documentation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html); CORS does not grant authorization. The future client implementation must request links/renewal through API/BFF control and transfer bytes to storage without exposing access keys.

Still deferred: frontend, player, upload-progress/resumption UI; Phase 04 publication and public/unlisted visibility; Phase 05 anonymous access and download button; Phase 07 CDN/production deployment. The streaming/download backend is delivered in this phase with owner authorization. Any other access policy desired before publication needs an explicit requirement; `ready` does not automatically publish. No commercial quotas, DRM, multiple resolutions, or processing notifications are selected without a source in scope.

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Queue technology | A — BullMQ + Redis | _[pending]_ |
| TD-02 | Backend | Resumable upload outside the API | A — Presigned S3 multipart | _[pending]_ |
| TD-03 | Backend | Buckets and keys | A — Private bucket with immutable prefixes | _[pending]_ |
| TD-04 | Backend | Worker execution | A — Nest standalone in a separate container | _[pending]_ |
| TD-05 | Backend | Reading for probe/thumbnail | B — Seekable remote reads with TD-06/D | _[pending]_ |
| TD-06 | Backend | Playback format | D — Stream the original object unchanged | _[pending]_ |
| TD-07 | Backend | Short URL without conflicts | A — Random 12-character ID + UNIQUE | _[pending]_ |
| TD-08 | Backend | Streaming and downloads | A — Direct presigned GET from storage | _[pending]_ |
| TD-09 | Backend | State and failures | A — draft/processing/ready/error + separate attempts | _[pending]_ |
| TD-10 | Backend | Completion, queue, and recovery | A — Outbox and idempotent reconciliation | _[pending]_ |
| TD-11 | Backend | Draft, resumption, and ownership | A — Video + UploadSession | _[pending]_ |
| TD-12 | Backend | Limits and abandonment | A — 24h session, short signatures, and cleanup | _[pending]_ |
| TD-13 | Repo-wide | Compose and real tests | A — Extend backend Compose with test isolation | _[pending]_ |
