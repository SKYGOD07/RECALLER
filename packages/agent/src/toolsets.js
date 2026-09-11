/**
 * RECALLER agent runtime — toolsets.
 *
 * Adapted from NousResearch/hermes-agent `toolsets.py` (MIT): named groups of
 * tools, resolved recursively through `includes`. Hermes ships dozens of them
 * (terminal, browser, web, memory, cron…). RECALLER ships only what a credit
 * reasoning agent needs. None of these tools reaches the network, the
 * filesystem, or the deterministic engines, so least privilege is the default
 * rather than a configuration.
 */

export const TOOLSETS = {
  evidence: {
    description: 'Read one document and record grounded evidence fields from it.',
    tools: ['read_document', 'record_evidence', 'flag_issue'],
  },
  review: {
    description: 'Read the gated evidence set and flag inconsistencies for the officer.',
    tools: ['read_evidence', 'flag_issue'],
  },
  narration: {
    description: 'Read a finished decision record in order to explain it.',
    tools: ['read_decision'],
  },
  delegation: {
    description: 'Hand a reasoning-heavy subtask to an isolated child agent.',
    tools: ['delegate_task'],
  },
  supervisor: {
    description: 'Coordinate child agents over an evidence set.',
    tools: [],
    includes: ['review', 'delegation'],
  },
};

/** Every tool name in a toolset, following `includes` (cycles are ignored). */
export function resolveToolset(name, seen = new Set()) {
  const ts = TOOLSETS[name];
  if (!ts) throw new Error(`Unknown toolset "${name}".`);
  if (seen.has(name)) return [];
  seen.add(name);
  const included = (ts.includes ?? []).flatMap((n) => resolveToolset(n, seen));
  return [...new Set([...ts.tools, ...included])];
}

export function resolveToolsets(names = []) {
  return [...new Set(names.flatMap((n) => resolveToolset(n)))];
}
