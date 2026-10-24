<!-- Generated from CLAUDE.md by scripts/port-ai-foundation-to-codex.mjs — do not edit by hand. -->
<!-- Codex reads AGENTS.md; Claude Code reads CLAUDE.md. Edit CLAUDE.md and regenerate. -->

# AGENTS.md

## Project Overview

StreamTube — a video sharing platform (YouTube-like). Users can upload, manage, and publish videos. Anonymous users can watch freely; social features (comments, subscriptions, likes) require authentication.

More info in the project overview: [docs/project-plan.md](docs/project-plan.md)

## Repository Structure

This is a monorepo with two main areas:

- `nestjs-project/` — Backend API (NestJS 11, TypeScript, Express). Contains modules for users, channels, videos, comments, etc.
- `docs/` — Project documentation, architecture diagrams, and planning.
- `next-frontend/` (Next.js) — not yet initialized

## Architecture (C4 Container Diagram)

See `docs/diagrams/software-arch.mermaid` for the full diagram. Key containers:

- **Frontend** (Next.js) → calls API via REST, streams from Object Storage
- **API** (Nest.js) → business rules, auth, reads/writes DB, uploads to storage, publishes jobs to queue, sends emails
- **Video Worker** (FFmpeg) → consumes jobs from queue, processes videos, updates DB and storage
- **Database** (PostgreSQL) → users, channels, videos, comments, likes
- **Object Storage** (S3/MinIO) → video files and thumbnails
- **Message Queue** (TBD) → video processing job queue
- **Email Service** (SMTP) → account confirmation and password recovery

## Docker Networking

This project runs entirely in Docker containers. When configuring connections between services (database, cache, queue, etc.), **always use the Docker Compose service name** as the host — never `localhost` or `127.0.0.1`.

Inside a container, `localhost` refers to the container itself, not the host machine or other containers. Services communicate through the Docker Compose network using their service names (e.g., `db`, `nestjs-api`).

- **Correct:** `DB_HOST=db` (the Compose service name)
- **Wrong:** `DB_HOST=localhost`

This applies to all environment variables, configuration files, and code that references service hosts.

## Working Principles

- **Single Responsibility:** each module, service, and function should have a clear, focused responsibility. Re-evaluate adherence at every step — when a module starts owning logic or entities that are not its own (e.g., a service creating an entity from another domain), extract it immediately into the proper module instead of deferring to a later corrective task.
- **Type Safety:** Strict TypeScript usage across all layers.
- **Testing:** Strong emphasis on pyramid testing at all levels to ensure reliability and maintainability.
- **Code Quality:** Use ESLint and Prettier for consistent code style. Code reviews should focus on readability, maintainability, and adherence to best practices.
- **Documentation:** Comprehensive docs for architecture, setup, and troubleshooting in `docs/`.

## Definition of Done (Technical)

A change is only considered complete when **all** of the following pass:

1. The relevant test suite passes (unit + integration + e2e affected by the change).
2. The full test suite passes before finishing the task.
3. TypeScript compiles cleanly: `npx tsc --noEmit` exits with code 0. Compilation errors must never be left as debt for future tasks.
4. Lint passes: `npm run lint`.

If any of these fails, the task is not done — fix the underlying issue before declaring completion.


## Git Conventions

- **Main branch:** `main` — never commit directly to it
- Branches: `feature/*`, `bugfix/*`, `hotfix/*`, `docs/*`
- **Commits:** short, descriptive messages focused on the "why" of the change
- **Workflow:** Git Flow conventions. Two long-lived branches:
  - `main` — stable, production-ready code 
  - `dev` — integration branch; all feature/bugfix/hotfix branches start from `dev` and merge back into `dev`
  - When `dev` is stable, it is merged into `main`

## Testing Policy

Every change must be tested. During development, run only the tests related to the modified code. Before finishing, always run the full test suite to ensure nothing is broken.

## Scope Limits

- Work on **one feature, fix, or refactoring at a time** — do not mix scopes
- Do not include cosmetic changes (formatting, renaming) alongside functional changes
- If something out of scope comes up during work, note it as a separate task instead of acting on it
- Focus on the defined scope for each task to ensure clarity and maintainability of the codebase.
- If you identify a necessary change that is out of scope, create a new issue or task for it instead of including it in the current work.

## Agent Skill Usage

When working on any task (planning, implementing, debugging, refactoring, 
reviewing, etc.), decompose the request into its underlying subtasks and 
concerns, then identify which available skills match any of them and activate 
those skills.

## Library Documentation Lookup

Before implementing any feature, you MUST use the **context7** MCP tool to look up the relevant library APIs and official documentation.

Always:

- Check the installed library version in the project manifest
- Retrieve the corresponding documentation using context7
- Cross-reference APIs to avoid deprecated or incompatible patterns
- Follow the official documentation over training data

Skip documentation lookup only for trivial operations such as:

- Variable declarations
- Basic control flow
- Simple CRUD using established project patterns

If a library is involved and there is uncertainty, documentation lookup is mandatory.
If the documentation returned does not match the installed version, flag the discrepancy before proceeding.

## Codex port of the AI foundation

The AI foundation of this repository was authored for Claude Code (`CLAUDE.md` files and `.claude/`). This section
describes how it is ported to the OpenAI Codex CLI conventions. The workflow (research → plan-context → plan-validate
→ plan-resolve → plan-build → [plan-test-specs] → implement) and every artifact it produces are identical; only the
tool runtime changes.

| Claude Code | Codex | Maintenance |
|---|---|---|
| `CLAUDE.md` (root, `nestjs-project/`, `next-frontend/`) | `AGENTS.md` next to each one | generated |
| `.claude/skills/<name>/` | `.agents/skills/<name>/`; `disable-model-invocation: true` → `agents/openai.yaml` with `policy.allow_implicit_invocation: false` (invoke with `$<name>`) | generated |
| `.claude/agents/<name>.md` (sub-agents) | `.codex/agents/<name>.toml` (custom agents, `sandbox_mode = "read-only"`) | generated |
| `.claude/rules/*.md` (auto-loaded by `paths:`) | same files, loaded through the "Path-scoped rules" index below | source used as is |
| `.mcp.json` (postgres) + context7 | `.codex/config.toml` → `[mcp_servers.postgres]`, `[mcp_servers.context7]` | hand-maintained |
| `.claude/settings.json` `UserPromptSubmit` hook | `.codex/hooks.json` (same hook; Codex runs project hooks only after they are reviewed and trusted in the TUI) | hand-maintained |

Codex loads `.codex/config.toml`, `.codex/agents/` and `.codex/hooks.json` only for trusted projects
(`[projects."<absolute repo path>"] trust_level = "trusted"` in `~/.codex/config.toml`). MCP tools are not listed as
top-level functions: they live in the code-mode tool catalog of the `exec` tool. Find them with
`ALL_TOOLS.filter(t => /context7|postgres/i.test(t.name))` and call them from there (`list_mcp_resources` only lists
resources, not tools). Use the context7 MCP tools for documentation lookups instead of raw HTTP calls.

**Subproject instructions.** Codex only auto-loads the `AGENTS.md` files from the repository root down to the current
working directory. Before working on files under `nestjs-project/` or `next-frontend/` from another directory, read
that subproject's `AGENTS.md` (Claude Code loads the nested `CLAUDE.md` on demand; this is the equivalent step).

**Source of truth.** `CLAUDE.md` files and `.claude/` stay canonical (Claude Code users keep working unchanged).
Never edit the generated files (`AGENTS.md`, `.agents/skills/`, `.codex/agents/`) by hand: edit the source
(`CLAUDE.md`, `.claude/...`, or this file `.codex/AGENTS.codex-port.md`) and regenerate on the host with
`node scripts/port-ai-foundation-to-codex.mjs` (`--check` exits 1 when a generated file drifted). When a skill says
"read `CLAUDE.md`", the sibling `AGENTS.md` has the same content. When a skill or task says "update `CLAUDE.md`",
edit the `CLAUDE.md` file and regenerate, so both stay identical.

### Tool mapping (Claude Code names used inside skills and agents → Codex)

- `/<skill>` or "use the Skill tool to load `<skill>`" → mention `$<skill>` or read `.agents/skills/<skill>/SKILL.md`
  (plus the companion files it references) and follow it.
- `Agent` tool with `subagent_type: <name>` where `<name>` is a project agent → `spawn_agent` with the custom agent
  `<name>` from `.codex/agents/`, passing the same inputs the skill specifies; wait for it and use its returned block
  exactly as the skill describes. `subagent_type: Explore` → built-in `explorer`; `subagent_type: general-purpose` →
  built-in `default` (or `worker` for execution-heavy work such as running test suites). Sub-agents do not see this
  conversation: put every input they need in the spawn message, as the skills already require.
- `AskUserQuestion` → in an interactive session, ask the user and wait. In a non-interactive run (`codex exec`), end
  the turn with the pending questions — numbered, each with its options, the recommended option first and marked
  "(Recommended)", plus the context needed to decide — and stop. Never assume an answer and never continue past a
  question; the reply arrives in the next turn (`codex exec resume`).
- `TodoWrite` → `update_plan`.
- `Read` / `Grep` / `Glob` / `Bash` → shell commands (`sed -n`, `rg`, `ls`, ...); `Edit` / `Write` → `apply_patch`.
- `mcp__context7__resolve-library-id` and `mcp__context7__query-docs` (older name: `get-library-docs`) → the tools of
  the `context7` MCP server; `mcp__postgres__query` → the `query` tool of the `postgres` MCP server.
- `WebFetch` / `WebSearch` → the web search tool when enabled; otherwise `curl` from the shell.
- "Run in background in the Bash tool" → start never-ending processes detached (`docker compose exec -d ...`) and poll
  them; never block a turn waiting on a process that does not exit.

### Path-scoped rules

Claude Code auto-loads a `.claude/rules/*.md` file whenever a file matching its `paths:` globs is read or edited.
Codex does not, so before creating or editing a file, read every rule below whose glob matches that file (generated
from each rule's frontmatter).

| Rule | Applies to (globs) | Purpose |
|---|---|---|
| `.claude/rules/auth-jwt.md` | `nestjs-project/src/auth/**` | JWT and refresh-token rotation rules |
| `.claude/rules/nestjs-common-conventions.md` | `nestjs-project/src/**/*.ts` | NestJS common conventions |
| `.claude/rules/nestjs-controllers.md` | `nestjs-project/**/*.controller.ts` | Controller conventions — REST compliance, no silent errors, prefer exception filters over try/catch |
| `.claude/rules/nestjs-dtos.md` | `nestjs-project/**/*.dto.ts` | DTO conventions for input validation and data transfer |
| `.claude/rules/nestjs-entities.md` | `nestjs-project/**/*.entity.ts` | TypeORM entity conventions for database models |
| `.claude/rules/nestjs-layer-separation.md` | `nestjs-project/**/*.controller.ts`, `nestjs-project/**/*.guard.ts`, `nestjs-project/**/*.interceptor.ts`, `nestjs-project/**/*.pipe.ts`, `nestjs-project/**/*.filter.ts` | Layer separation — business logic belongs exclusively in services; controllers, guards, interceptors, pipes, and filters must delegate to services |
| `.claude/rules/nestjs-modules.md` | `nestjs-project/src/**/*.module.ts` | NestJS module structure conventions |
| `.claude/rules/nestjs-services.md` | `nestjs-project/**/*.service.ts` | Service layer error handling — errors must always propagate to upper layers |
| `.claude/rules/nestjs-testing.md` | `nestjs-project/**/*.spec.ts`, `nestjs-project/**/*.integration-spec.ts`, `nestjs-project/**/*.e2e-spec.ts`, `nestjs-project/test/**` | Testing conventions for NestJS unit, integration, and e2e tests |
| `.claude/rules/next-frontend-bff-api.md` | `next-frontend/app/api/**/route.ts`, `next-frontend/lib/api/**/*.ts` | BFF Route Handlers and the typed upstream client — OpenAPI-anchored wire-shape pipeline |
| `.claude/rules/next-frontend-code-quality.md` | `next-frontend/**/*.ts`, `next-frontend/**/*.tsx` | TypeScript strict, imports, RSC/client boundary, file naming, cn(), Next.js primitives, env access |
| `.claude/rules/next-frontend-msw-mocks.md` | `next-frontend/mocks/**`, `next-frontend/**/*.integration.test.ts`, `next-frontend/**/*.integration.test.tsx` | MSW handler typing convention + Route Handler integration test pattern (paths-anchored fixtures) |
| `.claude/rules/next-frontend-testing.md` | `next-frontend/**/__tests__/**`, `next-frontend/tests/**`, `next-frontend/**/*.test.ts`, `next-frontend/**/*.test.tsx`, `next-frontend/**/*.integration.test.ts`, `next-frontend/**/*.integration.test.tsx`, `next-frontend/**/*.e2e-spec.ts` | Test type routing, file placement, forbidden patterns (no real-network Vitest tests) |
| `.claude/rules/next-frontend-ui.md` | `next-frontend/components/**/*.tsx`, `next-frontend/app/**/*.tsx`, `next-frontend/app/**/*.css` | UI rules: design tokens (no hardcoding), shadcn primitive pattern, custom icon components |
| `.claude/rules/typeorm-migrations.md` | `nestjs-project/**/migrations/**`, `nestjs-project/**/*data-source.ts` | Database migration safety rules |
| `.claude/rules/typeorm-queries.md` | `nestjs-project/src/**/*.service.ts`, `nestjs-project/src/**/*.repository.ts` | TypeORM query pitfalls — silent footguns when reading/writing through repositories |
| `.claude/rules/typescript-strict.md` | `nestjs-project/src/**/*.ts`, `nestjs-project/test/**/*.ts` | TypeScript strictness rules — keep tsc --noEmit clean at all times |
