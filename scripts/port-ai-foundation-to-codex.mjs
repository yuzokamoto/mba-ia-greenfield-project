#!/usr/bin/env node
// scripts/port-ai-foundation-to-codex.mjs — roda no HOST, a partir da raiz do repositório.
//
// Porta a fundação de IA do Claude Code (.claude/) para a convenção do OpenAI Codex CLI:
//   .claude/skills/<skill>/**   -> .agents/skills/<skill>/**   (skills do repositório no Codex)
//   .claude/agents/<agent>.md   -> .codex/agents/<agent>.toml  (custom agents / sub-agents do Codex)
//   CLAUDE.md (raiz e subprojetos) -> AGENTS.md ao lado de cada um; o da raiz recebe também a seção
//   .codex/AGENTS.codex-port.md e o índice das rules de .claude/rules (gerado do frontmatter `paths:`)
//
// A fonte da verdade continua sendo CLAUDE.md + .claude/: depois de alterar qualquer um deles,
// rode `node scripts/port-ai-foundation-to-codex.mjs` para regenerar os artefatos do Codex.
// Com `--check`, apenas verifica se os artefatos gerados estão em dia (exit 1 se houver drift).
//
// .codex/config.toml (MCP) e .codex/hooks.json são mantidos à mão (não gerados).

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC_SKILLS = join(ROOT, '.claude/skills');
const SRC_AGENTS = join(ROOT, '.claude/agents');
const OUT_SKILLS = join(ROOT, '.agents/skills');
const OUT_AGENTS = join(ROOT, '.codex/agents');
const CHECK = process.argv.includes('--check');

if (!existsSync(SRC_SKILLS) || !existsSync(SRC_AGENTS)) {
  console.error('Rode a partir da raiz do repositório (precisa de .claude/skills e .claude/agents).');
  process.exit(2);
}

const HEADER_NOTE =
  '> Codex port: generated from `.claude/` by `scripts/port-ai-foundation-to-codex.mjs` — edit the source and regenerate.\n' +
  '> Claude Code tool names in this text map to Codex tools as described in the root `AGENTS.md` → "Codex port of the AI foundation".\n';

// Reescritas de caminho aplicadas a todo arquivo de texto portado.
// As rules continuam em .claude/rules/ (conteúdo neutro de ferramenta, indexado pelo AGENTS.md) e os
// CLAUDE.md continuam sendo citados pelo nome: são a fonte dos AGENTS.md gerados (mesmo conteúdo).
function rewriteText(text) {
  return text
    .replace(/\.claude\/agents\/([A-Za-z0-9_-]+)\.md/g, '.codex/agents/$1.toml')
    .replace(/\.claude\/agents\//g, '.codex/agents/')
    .replace(/\.claude\/skills\//g, '.agents/skills/');
}

// Remove chaves de frontmatter exclusivas do Claude Code e devolve a política equivalente do Codex.
function portSkillFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return { text, implicit: true };
  const lines = match[1].split('\n');
  let implicit = true;
  const kept = lines.filter((line) => {
    if (/^disable-model-invocation:\s*true\s*$/.test(line)) {
      implicit = false;
      return false;
    }
    return !/^(disable-model-invocation|allowed-tools|user-invocable|argument-hint|model|context|agent):/.test(line);
  });
  const body = text.slice(match[0].length);
  return { text: `---\n${kept.join('\n')}\n---\n\n${HEADER_NOTE}\n${body.replace(/^\n+/, '')}`, implicit };
}

function isText(path) {
  return /\.(md|txt|json|ya?ml|py|sh|mjs|js|ts|toml)$/i.test(path) || path.endsWith('.gitignore');
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// Gera o mapa { caminhoDeSaída: conteúdo } sem tocar no disco.
function buildSkills() {
  const files = new Map();
  for (const skill of readdirSync(SRC_SKILLS).sort()) {
    const skillDir = join(SRC_SKILLS, skill);
    if (!statSync(skillDir).isDirectory()) continue;
    for (const src of walk(skillDir)) {
      const rel = relative(SRC_SKILLS, src);
      const dest = join(OUT_SKILLS, rel);
      if (!isText(src)) {
        files.set(dest, readFileSync(src));
        continue;
      }
      let text = rewriteText(readFileSync(src, 'utf8'));
      if (rel === join(skill, 'SKILL.md')) {
        const ported = portSkillFrontmatter(text);
        text = ported.text;
        if (!ported.implicit) {
          // Equivalente Codex de `disable-model-invocation: true`: só roda quando invocada com $<skill>.
          files.set(join(OUT_SKILLS, skill, 'agents/openai.yaml'), 'policy:\n  allow_implicit_invocation: false\n');
        }
      }
      files.set(dest, text);
    }
  }
  return files;
}

function parseAgent(text, file) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`Sem frontmatter: ${file}`);
  const meta = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  if (!meta.name || !meta.description) throw new Error(`name/description ausentes: ${file}`);
  return { meta, body: match[2] };
}

function tomlBasicString(value) {
  return JSON.stringify(value); // string JSON é uma basic string TOML válida (escapes compatíveis)
}

function buildAgents() {
  const files = new Map();
  for (const name of readdirSync(SRC_AGENTS).sort()) {
    if (!name.endsWith('.md')) continue;
    const src = join(SRC_AGENTS, name);
    const { meta, body } = parseAgent(readFileSync(src, 'utf8'), src);
    const tools = (meta.tools || '').split(',').map((t) => t.trim()).filter(Boolean);
    const readOnly = tools.length > 0 && tools.every((t) => ['Read', 'Grep', 'Glob'].includes(t));
    const instructions =
      `Codex port of \`.claude/agents/${name}\` (generated by scripts/port-ai-foundation-to-codex.mjs).\n` +
      (readOnly ? 'You are read-only: inspect files with shell read commands (cat, sed -n, rg, ls); never edit files.\n' : '') +
      'Claude Code tool names below map to Codex tools as described in the root AGENTS.md.\n\n' +
      rewriteText(body).replace(/^\n+/, '');
    if (instructions.includes("'''")) throw new Error(`Corpo contém ''' (quebraria a literal TOML): ${src}`);
    const lines = [
      `name = ${tomlBasicString(meta.name)}`,
      `description = ${tomlBasicString(rewriteText(meta.description))}`,
    ];
    if (readOnly) lines.push('sandbox_mode = "read-only"');
    lines.push(`developer_instructions = '''\n${instructions.replace(/\n*$/, '\n')}'''`);
    files.set(join(OUT_AGENTS, `${meta.name}.toml`), lines.join('\n') + '\n');
  }
  return files;
}

// Índice das rules (glob -> arquivo), gerado do frontmatter de cada .claude/rules/*.md.
function rulesIndex() {
  const rows = ['| Rule | Applies to (globs) | Purpose |', '|---|---|---|'];
  const dir = join(ROOT, '.claude/rules');
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.md')) continue;
    const text = readFileSync(join(dir, name), 'utf8');
    const fm = (text.match(/^---\n([\s\S]*?)\n---\n/) || [])[1] || '';
    const globs = [...fm.matchAll(/^\s+-\s+'?([^'\n]+)'?\s*$/gm)].map((m) => `\`${m[1]}\``);
    const description = ((fm.match(/^description:\s*'?(.*?)'?\s*$/m) || [])[1] || '').replace(/\|/g, '\\|');
    rows.push(`| \`.claude/rules/${name}\` | ${globs.join(', ') || '_(always)_'} | ${description} |`);
  }
  return rows.join('\n');
}

const GENERATED_NOTE = (source) =>
  `<!-- Generated from ${source} by scripts/port-ai-foundation-to-codex.mjs — do not edit by hand. -->\n` +
  `<!-- Codex reads AGENTS.md; Claude Code reads ${source}. Edit ${source} and regenerate. -->\n\n`;

function buildAgentsMd() {
  const files = new Map();
  for (const sub of ['', 'nestjs-project', 'next-frontend']) {
    const src = join(ROOT, sub, 'CLAUDE.md');
    if (!existsSync(src)) continue;
    const source = sub ? `${sub}/CLAUDE.md` : 'CLAUDE.md';
    let body = rewriteText(readFileSync(src, 'utf8')).replace(/^# CLAUDE\.md[ \t]*\n+/, '# AGENTS.md\n\n');
    if (!sub) {
      const port = readFileSync(join(ROOT, '.codex/AGENTS.codex-port.md'), 'utf8');
      body = `${body.replace(/\s*$/, '\n')}\n${port.replace(/\s*$/, '\n')}\n${rulesIndex()}\n`;
    } else {
      body =
        body.replace(/\s*$/, '\n') +
        '\n> Codex: tool names, sub-agents and path-scoped rules are mapped in the root `AGENTS.md` → "Codex port of the AI foundation".\n';
    }
    files.set(join(ROOT, sub, 'AGENTS.md'), GENERATED_NOTE(source) + body);
  }
  return files;
}

const expected = new Map([...buildSkills(), ...buildAgents()]);
const agentsMd = buildAgentsMd();

function currentFiles() {
  const out = [];
  for (const dir of [OUT_SKILLS, OUT_AGENTS]) if (existsSync(dir)) out.push(...walk(dir));
  return out;
}

if (CHECK) {
  const problems = [];
  for (const [dest, content] of [...expected, ...agentsMd]) {
    if (!existsSync(dest)) problems.push(`faltando: ${relative(ROOT, dest)}`);
    else if (!Buffer.from(readFileSync(dest)).equals(Buffer.from(content))) problems.push(`desatualizado: ${relative(ROOT, dest)}`);
  }
  for (const file of currentFiles()) if (!expected.has(file)) problems.push(`sobrando: ${relative(ROOT, file)}`);
  if (problems.length) {
    console.error(problems.join('\n'));
    console.error(`PORT_CHECK=drift (${problems.length}) — rode: node scripts/port-ai-foundation-to-codex.mjs`);
    process.exit(1);
  }
  console.log(`PORT_CHECK=ok files=${expected.size + agentsMd.size}`);
  process.exit(0);
}

rmSync(OUT_SKILLS, { recursive: true, force: true });
rmSync(OUT_AGENTS, { recursive: true, force: true });
for (const [dest, content] of [...expected, ...agentsMd]) {
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content);
}
const skills = readdirSync(OUT_SKILLS).length;
const agents = readdirSync(OUT_AGENTS).length;
console.log(`PORT=ok skills=${skills} agents=${agents} agents_md=${agentsMd.size} files=${expected.size + agentsMd.size}`);
