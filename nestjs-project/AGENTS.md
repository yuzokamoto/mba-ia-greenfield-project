<!-- Generated from nestjs-project/CLAUDE.md by scripts/port-ai-foundation-to-codex.mjs — do not edit by hand. -->
<!-- Codex reads AGENTS.md; Claude Code reads nestjs-project/CLAUDE.md. Edit nestjs-project/CLAUDE.md and regenerate. -->

# AGENTS.md

## Environment Startup Verification

**Default behavior:** starting the environment starts infrastructure and the background video worker. Start the NestJS HTTP application server only when the user explicitly asks to run/serve the project (e.g., "rode o projeto", "suba o servidor", "run the app").

After starting infrastructure, always confirm the containers are up before proceeding:

```bash
docker compose ps   # all services must show status "running"
```

Then verify each infrastructure service is actually ready to accept connections — not just running:

- **PostgreSQL:** `docker compose exec db pg_isready -U streamtube` — expect `accepting connections`

Only start the NestJS dev server (`npm run start:dev`) when the user **explicitly** asks to run the application — never as part of "start the environment".

## Development Environment

This project runs inside Docker. Always use the container for development:

```bash
# Start containers
docker compose up -d

# Install dependencies (first time only)
docker compose exec nestjs-api npm ci
docker compose exec nestjs-api npm run migration:run

# Run the dev server (watch mode)
docker compose exec nestjs-api npm run start:dev
```

Services:
- `nestjs-api` — NestJS API, port `3000`
- `db` — PostgreSQL 17, port `5432`, database `streamtube`, user/password `streamtube`

All verification and teardown commands run on the **host machine**:

```bash
# Verify NestJS is running (expect 200 + "Hello World!")
curl http://localhost:3000

# Verify PostgreSQL is ready (runs inside the db container)
docker compose exec db pg_isready -U streamtube

# Check container logs
docker compose logs nestjs-api
docker compose logs db

# Tear down the entire environment
docker compose down
```

## Commands

**Strict rule:** every `npm`, `npx`, `node`, `tsc`, and test command runs **inside the container**, never on the host. Running on the host causes env-var divergence (`DB_HOST` resolves to `localhost` instead of the Compose service), uses a different Node version, and produces results that do not reflect what runs in CI/prod.

### Container-only commands (always prefix with `docker compose exec nestjs-api`)

```bash
npm run start:dev                        # Dev server with hot-reload
npm run build                            # Compile to dist/
npm run start:prod                       # Run compiled build

npm test                                 # Unit tests
npm run test:watch                       # Unit tests in watch mode
npm run test:cov                         # Coverage report
npm run test:e2e                         # End-to-end tests (script includes --runInBand)

npx tsc --noEmit                         # Type-check (required before declaring a task done)
npm run lint                             # ESLint with auto-fix
npm run format                           # Prettier formatting
```

### Host-only commands (Docker / connectivity probes)

```bash
docker compose ps
docker compose logs nestjs-api
docker compose exec db pg_isready -U streamtube
curl http://localhost:3000
```

### Test execution

Integration and e2e suites share a single test database. They **must** be run with `--runInBand`:

```bash
docker compose exec nestjs-api npm test -- --runInBand
docker compose exec nestjs-api npm run test:e2e   # already configured
```

Parallel execution causes FK violations, deadlocks, and cross-suite contamination because suites truncate or seed shared tables concurrently.

During active development, run only the tests related to the file being changed (`npm test -- path/to/file.spec.ts`). Before declaring a task done, run the full suite — see the global `CLAUDE.md` → "Definition of Done (Technical)".

## Long-running Processes

Commands that never exit (dev server, watch modes) must be run in background in the Bash tool — otherwise the agent blocks indefinitely waiting for the process to return.

This applies to: `start:dev`, `start:prod`, `test:watch`, and any other persistent process.

## Test Type Selection

Choose the suffix by what the test really does, not by where the code under test lives. The suffix is a contract that drives Jest config (`testRegex`, parallelism), CI steps, and reader expectations.

| Suffix                  | Purpose                                                              | DB / external I/O | Location                     |
|-------------------------|----------------------------------------------------------------------|-------------------|------------------------------|
| `*.spec.ts`             | **Unit** — pure logic, all collaborators mocked                      | Forbidden         | Next to the source file      |
| `*.integration-spec.ts` | **Integration** — exercises real DB, real repositories, real modules | Required          | Next to the source file      |
| `*.e2e-spec.ts`         | **End-to-end** — full HTTP cycle via `supertest`                     | Required          | `nestjs-project/test/`       |

A test that constructs a `TypeOrmModule.forRoot`, opens a connection, or hits the `db` service **must** be `*.integration-spec.ts`, never `*.spec.ts`. A test that boots the full Nest application and makes HTTP calls **must** be `*.e2e-spec.ts`.

Conventions for **how to write** each kind of test (mocking patterns, AAA structure, override strategies for global guards, etc.) live in `.claude/rules/nestjs-testing.md` and load when you edit a test file.

## Jest Configuration

These settings are required in `package.json` (jest config) and `test/jest-e2e.json` for the project's tests to work correctly:

- `setupFiles: ["dotenv/config"]` — without this, `.env` is not loaded inside the Jest process. `DB_HOST`, `JWT_SECRET`, etc. fall back to undefined or to the host's `localhost`, breaking container-to-container DNS.
- `testRegex: '.*\\.(spec|integration-spec)\\.ts$'` — covers both unit (`*.spec.ts`) and integration (`*.integration-spec.ts`) suffixes.

Do not add new test-file suffixes; if a new test type is needed, update the regex deliberately.

## Environment File Conventions

`.env` is parsed by both Docker Compose and `dotenv` — values containing shell-special characters (`<`, `>`, `|`, `&`, spaces) **must be quoted** or rewritten:

```dotenv
# Wrong — the unquoted angle brackets are shell redirection syntax and break parsing
MAIL_FROM=StreamTube <noreply@streamtube.local>

# Right — quote the value
MAIL_FROM="StreamTube <noreply@streamtube.local>"
```

Whenever possible, prefer storing only the bare address in `.env` and composing display names in code (e.g., in `mail.config.ts`) so the file stays shell-safe.

## Build Assets

`tsc` (and therefore `nest build`) only emits compiled `.ts` files to `dist/`. Any non-TypeScript runtime asset — Handlebars templates (`.hbs`), JSON fixtures, static config files, etc. — must be declared in `nest-cli.json` under `compilerOptions.assets` (with `watchAssets: true` for dev). Without that, the file exists in `src/` but is missing in `dist/` and runtime fails only after build.

## Architecture

NestJS with standard module structure. Source lives in `src/`, compiled output in `dist/`.

- Each domain feature gets its own module (e.g., `UsersModule`, `VideosModule`) registered in `AppModule`
- Controllers handle HTTP routing; Services hold business logic; both are scoped to their module

## Code Conventions

- **TypeScript:** `nodenext` module resolution, `ES2023` target, `strictNullChecks` on, `noImplicitAny` off
- **Decorators:** `emitDecoratorMetadata` + `experimentalDecorators` enabled — required for NestJS DI
- **Prettier:** single quotes, trailing commas everywhere
- **ESLint:** `no-explicit-any` allowed; `no-floating-promises` and `no-unsafe-argument` are warnings

## REST Conventions

This is a RESTful API. All endpoints must follow standard REST conventions — correct HTTP methods, proper status codes, plural resource nouns, and consistent URL structure. Details are enforced via rules on controller files.


## Video Backend Operations

The API is a control plane: JSON metadata, part signing, completion, abort,
owner retrieval/listing, and playback/download signing. Source bytes travel directly
between clients and private S3-compatible storage. All nine `/videos` operations
require the existing JWT guard; missing and foreign-owned videos share HTTP 404.
Only `ready` owners can obtain access URLs. A draft remains private after processing.
Playback uses Range-compatible original bytes with inline disposition; download
uses the original object with a sanitized attachment filename. URLs are bearer
credentials until storage expiry, even after the issuing JWT expires; renewal
requires a fresh owner check. No transcoding or browser codec guarantee is implied.

### Configuration and fixed policy

Copy the block labelled `Storage, queue, and worker: local development values
(not Joi schema defaults)` from `.env.example` into local `.env`, preserving existing
DB/JWT settings. Never overwrite local `.env` or `compose.override.yaml` when updating
examples. `src/config/runtime-config.ts` shares startup validation between API and
worker; required settings have no Joi defaults. Typed `storage`, `queue` and `video`
namespaces keep storage credentials and operating limits out of domain policy.

Local examples (development credentials only; never deploy them to production):

| Settings | Local values |
|----------|--------------|
| `S3_INTERNAL_ENDPOINT` / `S3_PUBLIC_ENDPOINT` | `http://minio:9000` / `http://localhost:9000` |
| `S3_REGION` / `S3_BUCKET` / `S3_FORCE_PATH_STYLE` | `us-east-1` / `streamtube-videos` / `true` |
| `S3_CORS_ALLOWED_ORIGINS` | `http://localhost:3001` |
| `MINIO_ROOT_USER` / `S3_ACCESS_KEY_ID` | `streamtube` |
| `MINIO_ROOT_PASSWORD` / `S3_SECRET_ACCESS_KEY` | `streamtube-minio` |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_DB` | `redis` / `6379` / `0` |
| `VIDEO_PROCESSING_QUEUE` | `video-processing` |
| `VIDEO_PROCESSING_BACKOFF_MS` / `VIDEO_RECONCILE_INTERVAL_MS` | `30000` / `60000` |
| `VIDEO_PLAYBACK_URL_TTL_SECONDS` / `VIDEO_DOWNLOAD_URL_TTL_SECONDS` | `3600` / `300` |
| `VIDEO_MEDIA_READ_URL_TTL_SECONDS` / `VIDEO_MEDIA_TIMEOUT_MS` | `3600` / `600000` |
| `VIDEO_WORKER_CPUS` / `VIDEO_WORKER_MEMORY` | `2` / `2g` |

Optional `REDIS_USERNAME`/`REDIS_PASSWORD` follow the deployment's Redis configuration.
All service connections use Compose names (`db`, `minio`, `redis`). The public
loopback URL is exclusively for host/browser consumers. Container tests use the
internal endpoint for public signing too. Never replace a hostname after signing:
the requested host is part of the signature. URL TTLs are separate positive inputs,
bounded by S3/credential expiry; internal media-read TTL must exceed the media timeout.
CORS origins must be explicit HTTP(S) origins, not a wildcard.

`src/videos/videos.constants.ts` owns the fixed 10 GiB limit (`10737418240` bytes),
64 MiB parts (`67108864`), 24-hour sessions (`86400` seconds), and maximum 900-second
part URLs (also capped by session expiry). At most 160 parts are expected. These
are code policy, not environment knobs. Keep historical migration constraints
stable; a policy change requires a new migration.

### Private storage and queue startup

From `nestjs-project/`, start infrastructure and verify readiness:

```bash
docker compose up -d
docker compose ps -a
docker compose exec -T db pg_isready -U streamtube
docker compose exec -T redis redis-cli ping
```

The API container's idle default command does not start an HTTP application.
`minio-init` must exit successfully; it idempotently creates private development
and `streamtube-videos-test` buckets. MinIO publishes S3 on host port 9000 and its
console on 9001. The pinned PGSTY community fork uses server-wide
`MINIO_API_CORS_ALLOW_ORIGIN` from `S3_CORS_ALLOWED_ORIGINS`; its bucket CORS API
returns 501, so do not use `PutBucketCors`/`mcli cors set`. Listed origins can use
direct PUT/GET/Range and read ETag, Accept-Ranges, Content-Range, Content-Length and
Content-Disposition. An unlisted origin gets no allow-origin grant. CORS does not
make a bucket public. Redis uses persistent AOF and `noeviction`, with no host port.

### Worker lifecycle and recovery

Plain Compose startup includes the development worker; no profile or manual worker
build is required. On a fresh checkout, complete setup in the API container:

```bash
docker compose up -d
docker compose exec -T nestjs-api npm ci
docker compose exec -T nestjs-api npm run migration:run
docker compose logs --tail 50 video-worker
docker compose restart video-worker
```

Restart the worker after code changes. `docker/video-worker.cjs` waits quietly for
dependencies and the video schema, checking every five seconds with bounded DB
timeouts. It compiles with the installed TypeScript into container-local
`/tmp/streamtube-video-worker` on each start/restart and starts that private entrypoint.
Build diagnostics go to `/tmp/video-worker-build.log`; unsuccessful builds retry
after five seconds. API `nest build`/`start:dev` may delete shared `dist/` without
affecting the worker, including modules loaded later. No second shared build tree,
watcher, dependency installer, or migration runner is needed. The supervisor forwards
SIGTERM/SIGINT and awaits its child. The worker uses the same backend image, has
CPU/memory limits and no HTTP listener, and shares the image's pinned native
FFmpeg/ffprobe binaries. `VideoWorkerModule` uses a standalone application context,
without AppModule/AuthModule/controllers. Concurrency is 1 with three total durable
attempts and exponential backoff. Internal signed GETs feed bounded asynchronous
ffprobe/ffmpeg subprocesses; timeout/output/temp-file limits apply. SIGTERM/SIGINT
stop reconciliation, await in-flight work, close the consumer/clients and terminate
owned subprocesses. Use the Compose stop grace period for normal shutdown.

The producer has `enableOfflineQueue: false` and bounded retries; the worker's
separate Redis connection uses `maxRetriesPerRequest: null`. Redis must be ready at
startup. A post-commit enqueue failure returns HTTP 202 with durable `processing`
intent and a bounded log, leaving the reconciler to publish later. Session-row locks
serialize complete/abort/expiry. HeadObject recovers a completed matching object
after a lost response or crash; unfinished uploads expire and are aborted. A wrong-size
object is cleaned up rather than processed. The worker reconciles missing jobs,
retained failures and missed terminal updates without resetting the durable attempt
budget or regressing terminal rows. Owner detail exposes only safe failure reasons:
`invalid_media`, `processing_failed`, `upload_expired`. Never log credentials,
presigned query strings or unbounded media diagnostics.

### Isolated verification and large-upload rehearsal

The development worker may remain running during test suites. Buckets and queues
are isolated; scheduled reconciliation additionally takes shared PostgreSQL advisory
lock `730319`. Integration/e2e setup holds the exclusive lock on a dedicated
connection before fixtures are created, releasing it when the suite closes. A
scheduled scan skips quietly while that lock is held; shutdown awaits any active
scan and lock release. This excludes expiry, missing-job publication and retained-job
recovery from test rows. Explicit test-owned `tick()` calls remain available and
test workers consume only their isolated queue. Unit suites open no lock connection.
Never run two test processes concurrently. Full suites have been verified with the
development worker running (Implementation revision 3 in the phase progress file).

```bash
docker compose exec -T nestjs-api npm test -- --runInBand
docker compose exec -T nestjs-api npm run test:e2e
docker compose exec -T nestjs-api npx tsc --noEmit
docker compose exec -T nestjs-api npm run lint
```

`test:e2e` already includes `--runInBand`; unit/integration commands still need it.
Both runners load dotenv first, then `src/test/video-test-setup.ts` applies
`S3_BUCKET=streamtube-videos-test`, `VIDEO_PROCESSING_QUEUE=video-processing-test`,
and `S3_PUBLIC_ENDPOINT=S3_INTERNAL_ENDPOINT` before modules/config/client creation.
Helpers restore previous environment values, guard destructive cleanup against
development resources, generate small media fixtures, and close owned resources.
Do not add an assumed `.env.test` path. Processing tests own their isolated consumer;
never start the development worker to make tests pass.

The SI-03.27 real 10 GiB rehearsal is a separate controlled operation, not an ordinary
suite or the small `video-worker-compose-rehearsal.ts` smoke helper. Reserve sufficient
storage/network time, keep suites stopped, and use a dedicated fixture with an owner
channel and a valid video file of exactly `10737418240` bytes. Start the API explicitly
for this rehearsal and build/start a worker for the same chosen environment. Initiate
through JSON, obtain part URLs, PUT all 160 actual 64 MiB parts directly to storage,
retain ETags, and submit the complete manifest. Confirm resumption, HTTP 202 and
subsequent ready state with metadata/thumbnail and original playback/download bytes.
During transfer, sample API container memory and send concurrent authenticated control
requests; record environment, transferred bytes, memory observations, responsiveness
and final processing result in phase progress.md. A declared size or mocked object is
insufficient evidence. Clean up only the rehearsal's owned resources and stop its
worker afterward. Do not invent a latency SLA or claim the rehearsal ran from small tests.

### OpenAPI maintenance

Swagger UI/JSON/YAML at `/api/docs`, `/api/docs-json`, `/api/docs-yaml` are opt-in
only when `SWAGGER_ENABLED=true`; otherwise they remain absent. Export the tracked
artifact without starting an HTTP listener or worker consumer:

```bash
docker compose exec -T nestjs-api npm run openapi:export
```

Keep explicit body/path/nested/response metadata for offline export: this ts-node
command does not execute the Nest CLI Swagger plugin. Validate exact integer byte
bounds and response statuses (201 start, 200 signing/reads, 202 complete, empty 204
abort), bearer security and examples. Domain/validation errors reference
`ApiErrorEnvelope`; the existing guard's native 401 is exactly
`{ message: 'Unauthorized', statusCode: 401 }`. Preserve that shape and inherited
native throttling rather than changing authentication to match documentation.

After editing this canonical file, run `node scripts/port-ai-foundation-to-codex.mjs`
then `node scripts/port-ai-foundation-to-codex.mjs --check` on the host from the repo
root. Include the generated sibling AGENTS.md; never edit it by hand.

> Codex: tool names, sub-agents and path-scoped rules are mapped in the root `AGENTS.md` → "Codex port of the AI foundation".
