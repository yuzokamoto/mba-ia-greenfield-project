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
(`[projects."<absolute repo path>"] trust_level = "trusted"` in `~/.codex/config.toml`). MCP tools may be deferred:
search the available tools for `context7` / `postgres` before concluding they are missing.

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
