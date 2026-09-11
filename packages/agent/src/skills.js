/**
 * RECALLER agent runtime — skills.
 *
 * Adapted from the NousResearch/hermes-agent skill format (MIT): a SKILL.md
 * with YAML frontmatter (`name`, `description`, …) and a markdown body of
 * procedure, plus optional `references/` supplied when relevant.
 *
 * This module only parses. Callers supply the text: in Node,
 * `readFileSync(…/SKILL.md, 'utf8')`; under Vite,
 * `import text from '…/SKILL.md?raw'`. The package therefore needs no
 * filesystem access. Only top-level `key: value` frontmatter is read; nested
 * blocks such as `metadata:` are skipped.
 */

export function parseSkill(markdown) {
  const text = String(markdown).replace(/^﻿/, '');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error('SKILL.md must begin with a --- frontmatter block.');
  const meta = parseFrontmatter(m[1]);
  if (!meta.name || !meta.description) throw new Error('Skill frontmatter needs a name and a description.');
  return { ...meta, body: m[2].trim() };
}

function parseFrontmatter(src) {
  const out = {};
  for (const line of src.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv && kv[2] !== '') out[kv[1]] = parseScalar(kv[2]);
  }
  return out;
}

function parseScalar(raw) {
  const v = raw.trim();
  if (/^\[.*\]$/.test(v)) {
    return v
      .slice(1, -1)
      .split(',')
      .map((s) => unquote(s.trim()))
      .filter(Boolean);
  }
  if (v === 'true' || v === 'false') return v === 'true';
  return unquote(v);
}

function unquote(s) {
  return /^(['"]).*\1$/.test(s) ? s.slice(1, -1) : s;
}

/** The system-prompt text for a skill, with any references appended under their names. */
export function skillPrompt(skill, references = {}) {
  const refs = Object.entries(references).map(([name, text]) => `## Reference: ${name}\n\n${String(text).trim()}`);
  return [`# Skill: ${skill.name}`, skill.body, ...refs].join('\n\n');
}
