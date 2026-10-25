---
libs:
  "@nestjs/bullmq":
    version: "12.0.0"
    context7_id: "/nestjs/bull"
    fetched_at: "2026-10-24T20:42:53.417778+00:00"
  "bullmq":
    version: "5.81.5"
    context7_id: "/websites/bullmq_io"
    fetched_at: "2026-10-24T20:42:53.612289+00:00"
  "@aws-sdk/client-s3":
    version: "3.1156.0"
    context7_id: "/aws/aws-sdk-js-v3/v3.1153.0"
    fetched_at: "2026-10-24T20:42:53.494006+00:00"
  "@aws-sdk/s3-request-presigner":
    version: "3.1156.0"
    context7_id: "/aws/aws-sdk-js-v3/v3.1153.0"
    fetched_at: "2026-10-24T20:42:53.418286+00:00"
  "@nestjs/config":
    version: "4.0.3"
    context7_id: "/nestjs/docs.nestjs.com"
    fetched_at: "2026-10-24T20:42:53.596220+00:00"
  "joi":
    version: "18.1.2"
    context7_id: "/hapijs/joi"
    fetched_at: "2026-10-24T20:42:54.034628+00:00"
  "@nestjs/core":
    version: "11.1.16"
    context7_id: "/nestjs/docs.nestjs.com"
    fetched_at: "2026-10-24T20:42:53.688121+00:00"
  "typeorm":
    version: "0.3.28"
    context7_id: "/typeorm/typeorm/0.3.27"
    fetched_at: "2026-10-24T20:42:53.504002+00:00"
  "pg":
    version: "8.20.0"
    context7_id: "/brianc/node-postgres"
    fetched_at: "2026-10-24T20:42:53.494883+00:00"
  "jest":
    version: "30.3.0"
    context7_id: "/websites/jestjs_io_30_0"
    fetched_at: "2026-10-24T20:42:54.186493+00:00"
  "ts-jest":
    version: "29.4.6"
    context7_id: "/kulshekhar/ts-jest"
    fetched_at: "2026-10-24T20:42:54.127983+00:00"
  "supertest":
    version: "7.2.2"
    context7_id: "/forwardemail/supertest"
    fetched_at: "2026-10-24T20:42:54.401513+00:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-24T17:59:18.968343732-03:00"
---

# Library References

Verified on 2026-10-24. These are exact planning pins, without `^` or `~`; this resolve run does not install project dependencies or edit manifests. Existing-library versions come from `nestjs-project/package-lock.json`.

## Verification and documentation boundaries

The session's `ALL_TOOLS.filter(t => /context7/i.test(t.name))` returned no tools. Documentation was nevertheless fetched through the configured Context7 MCP server: `docker compose exec -T nestjs-api npx -y @upstash/context7-mcp`, using MCP JSON-RPC `initialize`, `tools/list`, and `tools/call` for `resolve-library-id` and `query-docs`. Each of the twelve libraries below was resolved and queried. This was the configured MCP transport, rather than raw HTTP as a substitute for Context7.

Registry checks ran inside the Node 25.6.0 container with `npm view <package> version engines peerDependencies dependencies --json`, followed by exact-version checks for the selected BullMQ 5 release. A temporary, external-to-repository manifest containing the four new pins together with Nest common/core 11.1.16, `@nestjs/typeorm` 11.0.1, TypeORM 0.3.28, and pg 8.20.0 passed `npm install --dry-run --ignore-scripts --package-lock=false --engine-strict`. This verifies registry dependency/engine resolution, not future application behavior; implementation must still prove API/worker DI and external contracts.

| Newly selected package | Exact version | Compatibility evidence |
|---|---|---|
| @nestjs/bullmq | 12.0.0 | Registry peers accept Nest common/core `^10 || ^11 || ^12` and BullMQ `^3 || ^4 || ^5 || ^6`; no separate Node engine restriction is declared. Published as ESM; retain the project's Node 25.6.0/nodenext configuration and verify test/module loading during implementation. |
| bullmq | 5.81.5 | Registry engine `node >=12.22.0`; accepted by the Nest adapter. Includes `ioredis 5.11.1` as a dependency, so application code can use connection options without importing or adding ioredis directly. |
| @aws-sdk/client-s3 | 3.1156.0 | Registry engine `node >=20.0.0`; does not impose a NestJS or TypeORM peer dependency. |
| @aws-sdk/s3-request-presigner | 3.1156.0 | Same AWS patch and Node engine as client-s3; no NestJS/TypeORM peer requirement. |

**Discrepancies, checked before adopting APIs:** Context7 offers BullMQ repository version `v6.3.11`, not selected `5.81.5`; its current website also includes v6 features. Use only the shared Queue/Worker/job/retry APIs cross-checked in the [selected BullMQ source](https://github.com/taskforcesh/bullmq/tree/v5.81.5/src), excluding PostgreSQL backends and v6-only cancellation/client-adapter APIs. Registry latest BullMQ `6.4.2` was checked but has an optional `ioredis` peer rather than a bundled driver; selecting 5.81.5 preserves TD-01/A without an otherwise unnecessary direct driver dependency. Repository tag manifests report 5.81.4 at tag v5.81.5 and 6.4.1 at tag v6.4.2; published version pins and dependency metadata are taken from npm, not inferred from those source-version strings.

Context7's AWS snapshot is `v3.1153.0`, three patch releases behind both selected packages. Client/command and presigner APIs were cross-checked against the [3.1156.0 SDK source](https://github.com/aws/aws-sdk-js-v3/tree/v3.1156.0). The Nest Bull index has no pinned version; the [adapter manifest](https://github.com/nestjs/bull/blob/master/packages/bullmq/package.json) agrees with npm 12.0.0 peers. Nest documentation is rolling and includes Nest 12 examples; TypeORM's offered 0.3.27 snapshot is behind installed 0.3.28. Keep existing Nest 11/config 4 patterns and TypeORM 0.3 APIs. Other rolling indexes below are references, not evidence of an exact package snapshot.

## Library documentation

### @nestjs/bullmq

Pin `12.0.0`; Context7 `/nestjs/bull`. TD-01 and TD-04.

Use `BullModule.forRootAsync` with injected typed configuration and `BullModule.registerQueue` for the named queue. Producers obtain it through `@InjectQueue`. A consumer extends `WorkerHost` and implements `process(job)`, registered as a provider with `@Processor(queueName, { concurrency: 1 })`. Register consumers only in the worker's module graph. Close workers/queues through Nest lifecycle handling and terminate owned media subprocesses on shutdown.

Sources: [module configuration](https://github.com/nestjs/bull/blob/master/_autodocs/api-reference/bullmq-module.md), [consumer decorators](https://github.com/nestjs/bull/blob/master/_autodocs/api-reference/bullmq-decorators.md).

### bullmq

Pin `5.81.5`; Context7 `/websites/bullmq_io`. TD-01, TD-04, TD-09, TD-10.

`queue.add(name, { videoId }, { jobId, attempts: 3, backoff: { type: 'exponential', delay } })` supplies the queue contract; the delay is configured during implementation. Three attempts means one initial execution plus at most two retries. Context7's example prose incorrectly described three retry delays for this setting; retain the total-attempt semantics in TD-09. Throw `UnrecoverableError` for terminal invalid media to bypass remaining attempts. Persist safe error codes separately from internal exception details.

Use `getJob`/`getState` when reconciling durable processing intent. Waiting, active, and delayed work must not be mistaken for missing work. A retained terminal job with the same ID prevents another `add`; inspect terminal state/exhaustion before deciding recovery or persisting the final error. Removed jobs lose queue deduplication, so database status and persisted attempts remain authoritative. IDs must avoid BullMQ's colon separator. Worker Redis connections require `maxRetriesPerRequest: null`; producer operations need bounded failure behavior. Set the host explicitly to `redis`.

Sources: [retries](https://docs.bullmq.io/guide/retrying-failing-jobs), [terminal errors](https://docs.bullmq.io/patterns/stop-retrying-jobs), [IDs](https://docs.bullmq.io/guide/jobs/job-ids), [production settings](https://docs.bullmq.io/guide/going-to-production), [pinned Job API](https://github.com/taskforcesh/bullmq/blob/v5.81.5/src/classes/job.ts).

### @aws-sdk/client-s3

Pin `3.1156.0`; Context7 `/aws/aws-sdk-js-v3/v3.1153.0`, plus the resolved official SDK service index for a targeted multipart query. TD-02, TD-03, TD-05, TD-08, TD-11, TD-12.

Use `S3Client` and `client.send(new Command(input))`, with configurable region, credentials, `endpoint`, and MinIO `forcePathStyle: true`. The control sequence uses `CreateMultipartUploadCommand`, `ListPartsCommand`, `CompleteMultipartUploadCommand`, `AbortMultipartUploadCommand`, `HeadObjectCommand`, and `DeleteObjectCommand`. Persist server-owned references; verify returned part numbers, sizes, and ETags before completion, paginate ListParts, and verify final `ContentLength` against declared size. A lost completion response requires HeadObject reconciliation at the known key. The API never receives a video body. Only the thumbnail upload requires a small worker-generated body.

Context7's package snapshot mainly returned endpoint configuration; the targeted official service-index query returned multipart and HeadObject examples. The index also describes the aggregated `S3` client: retain the modular `S3Client.send(Command)` pattern. Real integration tests must validate signing/checksum behavior against the selected storage build.

Sources: [v3 configuration names](https://github.com/aws/aws-sdk-js-v3/blob/v3.1153.0/UPGRADING.md), [CreateMultipartUpload](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/command/CreateMultipartUploadCommand/), [pinned ListParts source](https://github.com/aws/aws-sdk-js-v3/blob/v3.1156.0/clients/client-s3/src/commands/ListPartsCommand.ts), [HeadObject](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/command/HeadObjectCommand/).

### @aws-sdk/s3-request-presigner

Pin `3.1156.0`; Context7 `/aws/aws-sdk-js-v3/v3.1153.0`. TD-02, TD-03, TD-05, TD-08.

Call `getSignedUrl(client, command, { expiresIn })` with `UploadPartCommand` for each authorized part and `GetObjectCommand` for reads. Supply expiration explicitly: upload-part URLs last 900 seconds and are renewable only during the active 24-hour session. The URL signer uses the endpoint appropriate to its consumer; use separate configured clients for public signing and internal operations. Test configuration points both at `http://minio:9000`. Never alter a signed host/path.

GET commands set `ResponseContentDisposition` to inline or attachment with the sanitized filename. Playback consumers can request byte ranges from storage; do not bind a playback URL to one fixed Range if clients must seek. Worker GET URLs target only the known internal object. Signed links are reusable bearer credentials until expiration.

Sources: [pinned presigner README](https://github.com/aws/aws-sdk-js-v3/blob/v3.1156.0/packages/s3-request-presigner/README.md), [client endpoints](https://github.com/aws/aws-sdk-js-v3/blob/v3.1153.0/supplemental-docs/CLIENTS.md), [GetObject response overrides](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html).

### @nestjs/config

Existing `4.0.3`; Context7 `/nestjs/docs.nestjs.com`. TD-03, TD-12.

Retain `registerAs` namespaces, typed `ConfigType<typeof factory>` injection, and startup environment validation. Add storage/queue/upload values through existing configuration patterns. The fetched rolling docs include newer Standard Schema and Nest 12 guidance; those are not changes to the installed config 4 contract.

Source: [configuration reference](https://github.com/nestjs/docs.nestjs.com/blob/master/content/application/configuration.md).

### joi

Existing `18.1.2`; Context7 `/hapijs/joi`. TD-03, TD-12.

Use object schemas with required strings and positive/integer/min/max/default constraints for operational settings. The 10,737,418,240-byte limit is within JavaScript's safe integer range. Validate configuration at startup through the inherited config setup; no new validation library or frontend validation contract is selected.

Source: [Joi API](https://github.com/hapijs/joi/blob/master/API.md). The index is rolling and exposes no exact 18.1.2 snapshot.

### @nestjs/core

Existing `11.1.16`; Context7 `/nestjs/docs.nestjs.com`. TD-04.

Create a standalone context with `NestFactory.createApplicationContext(WorkerModule)`, enable signal shutdown hooks, and close the context during orderly teardown. Import only worker requirements; an application context creates no HTTP listener. Native asynchronous subprocesses require their own timeout/termination ownership.

Sources: [standalone contexts](https://github.com/nestjs/docs.nestjs.com/blob/master/content/application-context.md), [lifecycle](https://github.com/nestjs/docs.nestjs.com/blob/master/content/fundamentals/lifecycle-events.md), [11.1.16 factory](https://github.com/nestjs/nest/blob/v11.1.16/packages/core/nest-factory.ts).

### typeorm

Existing `0.3.28`; Context7 `/typeorm/typeorm/0.3.27`. TD-07, TD-09, TD-10, TD-11.

Use the transaction callback's EntityManager for every operation in that transaction. Create draft/session records together and commit processing intent before queue publication. Use a status predicate and inspect affected rows when persisting processing results; queue callbacks do not replace a durable terminal update. Handle the public-ID UNIQUE violation with bounded insert attempts. External byte transfers must not hold an SQL transaction open.

Sources: [installed-version transaction contract](https://github.com/typeorm/typeorm/blob/0.3.28/docs/docs/advanced-topics/2-transactions.md), [indexed repository API](https://github.com/typeorm/typeorm/blob/0.3.27/docs/docs/working-with-entity-manager/6-repository-api.md). Context7 does not offer installed 0.3.28.

### pg

Existing `8.20.0`; Context7 `/brianc/node-postgres`. TD-07, TD-10, TD-11.

Keep the existing TypeORM/PostgreSQL connection configuration, with host `db`. Direct SQL uses parameters; transactions require a single checked-out connection, released in finally. Close pools/data sources during teardown. No new PostgreSQL queue backend is selected.

Sources: [transactions](https://github.com/brianc/node-postgres/blob/master/docs/pages/features/transactions.mdx), [pool lifecycle](https://github.com/brianc/node-postgres/blob/master/docs/pages/apis/pool.mdx). The documentation index is unversioned.

### jest

Existing `30.3.0`; Context7 `/websites/jestjs_io_30_0`. TD-13.

Run database-sharing suites with `--runInBand`; await async setup/cleanup hooks and close workers, storage clients, Nest contexts, and database connections. Use `--detectOpenHandles` only when diagnosing a hang. Generate small media at test time and isolate test queues/buckets from development consumers.

Sources: [Jest 30 CLI](https://jestjs.io/docs/30.0/cli), [lifecycle hooks](https://jestjs.io/docs/30.0/api). The indexed 30.0 documentation is not an exact 30.3.0 snapshot.

### ts-jest

Existing `29.4.6`; Context7 `/kulshekhar/ts-jest`. TD-13.

Retain the established TypeScript transform in both Jest configurations. Do not switch runtime module strategy based on rolling documentation; test actual worker/module imports with the installed Node/Jest/TypeScript setup. Current docs deprecate the transform-level isolatedModules setting in favor of tsconfig, which is unrelated to this resolve run.

Sources: [transform configuration](https://github.com/kulshekhar/ts-jest/blob/main/_autodocs/configuration.md), [presets](https://github.com/kulshekhar/ts-jest/blob/main/_autodocs/api-reference/presets.md). No exact 29.4.6 index was offered.

### supertest

Existing `7.2.2`; Context7 `/forwardemail/supertest`. TD-13.

Exercise the Nest HTTP server with request methods, Authorization headers, JSON bodies, and status/body/header assertions. Use real storage requests for multipart and returned signed links. API tests prove authentication, ownership, validation wiring, and continued control-endpoint responses while a direct-storage upload is active.

Sources: [Supertest README](https://github.com/forwardemail/supertest/blob/master/README.md), [expect API](https://github.com/forwardemail/supertest/blob/master/_autodocs/api-reference/test.md). This is a rolling index rather than an exact 7.2.2 snapshot.

## Infrastructure pins and verification

| Component | Exact pin | Evidence and intended use |
|---|---|---|
| Redis | `redis:8.2.3-bookworm@sha256:0908d9af26bf9b985e984a40a5eb82eed229b07a3317eee6843832c3cc3a9619` | Docker Hub manifest and actual pull succeeded. Enable AOF and `maxmemory-policy noeviction`, persist Redis data, and use Compose host `redis`. This covers queue durability alongside TD-10. |
| Local MinIO community build | `pgsty/minio:RELEASE.2026-08-04T00-00-00Z@sha256:b6bfe7239bfc83fb90d31612d9704d86039dd714f7904b3f1ad68f211e602372` | Docker Hub tag API returned active amd64/arm64 manifests and this index digest; actual pull succeeded. An offline `minio --version` reported this release. This is an independent PGSTY fork, not an upstream MinIO, Inc. distribution. Production storage remains S3. |
| Bucket initializer | Same pinned `pgsty/minio` image | Its included `/usr/bin/mcli --version` ran successfully and reported the same release. Override the one-shot service entrypoint to use mcli against `http://minio:9000`; create private environment/test buckets. Bucket CORS (`mcli cors set` / `PutBucketCors`) returns `501 NotImplemented` on this build, so CORS is set server-wide with `MINIO_API_CORS_ALLOW_ORIGIN` on the `minio` service (verified: preflight answered only for listed origins; `ETag`/range headers exposed). No separate unverified mc image is needed. |
| Worker/API base | Existing `node:25.6.0-slim` | The running backend container reports Node v25.6.0 and Debian GNU/Linux 12 (bookworm); do not assume current trixie packages apply to this built base. Both processes are built from the same backend image. |
| FFmpeg and ffprobe | Debian `ffmpeg=7:5.1.9-0+deb12u1` | `apt-cache policy ffmpeg` and `apt-cache show ffmpeg` inside that container report this available bookworm package; it supplies ffmpeg and ffprobe. Add it during the future image build with no recommended packages. Neither binary was installed by this resolve run. |

The upstream Docker Hub tag endpoint for `minio/minio:RELEASE.2025-09-07T16-13-09Z` returned HTTP 404; `docker pull` returned access denied/repository unavailable. Manifest checks for upstream April and June 2025 tags also failed. Checked historical official Quay tags (April, July, September 2025) returned no such manifest, and the Quay tag API required authorization. A stale indexed Docker Hub listing was therefore insufficient evidence of pullability. The chosen community image was verified against the live Docker Hub tag API and downloaded, with its provenance retained explicitly.

Sources: [PGSTY image provenance](https://hub.docker.com/r/pgsty/minio), [exact live tag metadata](https://hub.docker.com/v2/repositories/pgsty/minio/tags/RELEASE.2026-08-04T00-00-00Z), [fork lineage and archived MinIO identity](https://github.com/pgsty/silo), [bookworm FFmpeg package](https://packages.debian.org/bookworm/ffmpeg), [Redis image](https://hub.docker.com/_/redis).

Available package versions and image tags can change; digest pins preserve the selected image content. The shared image build and real MinIO/Redis/FFmpeg integration tests belong to implementation, including the direct multipart limit rehearsal specified in TD-12. No 10 GiB transfer has been performed at this planning stage.

