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
resources, not tools). MCP servers start asynchronously (`npx`), so context7 may be missing from `ALL_TOOLS` in
the first seconds of a session: wait a few seconds and check again before concluding it is unavailable. Use the
configured context7 MCP tools for documentation lookups; never call the HTTP endpoint or spawn your own MCP client.

**Subproject instructions.** Codex only auto-loads the `AGENTS.md` files from the repository root down to the current
working directory. Before working on files under `nestjs-project/` or `next-frontend/` from another directory, read
that subproject's `AGENTS.md` (Claude Code loads the nested `CLAUDE.md` on demand; this is the equivalent step).

**Source of truth.** `CLAUDE.md` files and `.claude/` stay canonical (Claude Code users keep working unchanged).
Never edit the generated files (`AGENTS.md`, `.agents/skills/`, `.codex/agents/`) by hand: edit the source
(`CLAUDE.md`, `.claude/...`, or this file `.codex/AGENTS.codex-port.md`) and regenerate on the host with
`node scripts/port-ai-foundation-to-codex.mjs` (`--check` exits 1 when a generated file drifted). When a skill says
"read `CLAUDE.md`", the sibling `AGENTS.md` has the same content. When a skill or task says "update `CLAUDE.md`",
edit the `CLAUDE.md` file and regenerate, so both stay identical.

**Language of artifacts.** Everything written to the repository — decisions docs, phase/task artifacts under `docs/`,
code, comments, commit-ready text — follows the existing project convention: English, keeping Portuguese only for
verbatim quotes of `docs/project-plan.md` (capability bullets, phase names). This overrides any personal or global
language preference. Chat replies to the user may use the user's language.

### Tool mapping (Claude Code names used inside skills and agents → Codex)

- `/<skill>` or "use the Skill tool to load `<skill>`" → mention `$<skill>` or read `.agents/skills/<skill>/SKILL.md`
  (plus the companion files it references) and follow it.
- `Agent` tool with `subagent_type: <name>` where `<name>` is a project agent → `spawn_agent` with the custom agent
  `<name>` from `.codex/agents/`, passing the same inputs the skill specifies; wait for it and use its returned block
  exactly as the skill describes. `subagent_type: Explore` → built-in `explorer`; any other `subagent_type:
  general-purpose` delegation → built-in `default`. Sub-agents do not see this conversation: put every input they need
  in the spawn message, as the skills already require.
- Test execution is never delegated. Where a skill says to delegate running tests to a sub-agent (e.g. `implement`
  step 4, `subagent_type: general-purpose`), run the tests yourself and do not call `spawn_agent`. A Codex sub-agent
  forks the parent's whole conversation, and one that waits on a long test process re-sends that context on every
  poll, so it costs far more than running the suite directly. How to run them:
  1. Read the subproject's `AGENTS.md` for the command conventions (container, env, runner).
  2. Run exactly the files the skill lists, once per attempt. Block until the command exits and redirect
     stdout/stderr to a log file: `<documented test command> <files> > /tmp/si-tests.log 2>&1; echo exit=$?`.
  3. Read only the runner's summary lines. For jest that is `grep -E '^(PASS|FAIL|Tests:)' /tmp/si-tests.log`. On a
     failure, read just the failure blocks; for jest, `grep -n -A40 '●' /tmp/si-tests.log`.
  The skill's report rules still apply to what you read: keep every diagnostic line (test names, assertion diffs,
  stack frames into project code, console output, setup/teardown errors, timeouts) and skip only noise. The fix-loop
  limit (3 attempts) is unchanged.
- Sub-agent tools unavailable (e.g. the run uses `--disable multi_agent`) → do the delegated work yourself. For a
  project agent, follow the `developer_instructions` in `.codex/agents/<name>.toml` and produce the same returned block.
  For `Explore`, use `rg` / `sed -n`.
- `AskUserQuestion` → in an interactive session, ask the user and wait. In a non-interactive run (`codex exec`), end
  the turn with the pending questions — numbered, each with its options, the recommended option first and marked
  "(Recommended)", plus the context needed to decide — and stop. Never assume an answer and never continue past a
  question; the reply arrives in the next turn (`codex exec resume`).
- `TodoWrite` → `update_plan`.
- `Read` / `Grep` / `Glob` / `Bash` → shell commands (`sed -n`, `rg`, `ls`, ...); `Edit` / `Write` → `apply_patch`.
- `mcp__context7__resolve-library-id` and `mcp__context7__query-docs` (older name: `get-library-docs`) → the tools of
  the `context7` MCP server; `mcp__postgres__query` → the `query` tool of the `postgres` MCP server.
- `WebFetch` / `WebSearch` → the web search tool when enabled; otherwise `curl` from the shell.
- "Run in background in the Bash tool" → start never-ending processes detached (`docker compose exec -d ...`) and check
  them with a single `tail`/`grep` of their log at long intervals (≥ 60 s), never with rapid empty polls. Never block
  a turn waiting on a process that does not exit. Commands that do exit, such as test suites and builds, run in the
  foreground until they finish.

### Path-scoped rules

Claude Code auto-loads a `.claude/rules/*.md` file whenever a file matching its `paths:` globs is read or edited.
Codex does not, so before creating or editing a file, read every rule below whose glob matches that file (generated
from each rule's frontmatter).
