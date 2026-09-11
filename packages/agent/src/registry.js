/**
 * RECALLER agent runtime — tool registry.
 *
 * Adapted from NousResearch/hermes-agent `tools/registry.py` (MIT; see
 * ../THIRD_PARTY_NOTICES.md). Every tool declares its schema, handler and
 * toolset in one place, and `dispatch` is the only path from a model to a
 * handler. Error bodies are bounded before they reach model context.
 *
 * RECALLER adds one rule Hermes has no reason to need: a tool whose name says
 * it decides or computes a credit outcome cannot be registered at all. Models
 * read and explain; packages/credit-engine and packages/policy-engine decide,
 * and no agent is ever handed a path to them.
 */

const MAX_TOOL_ERROR_CHARS = 2048; // Hermes: _MAX_TOOL_ERROR_CHARS
const TRUNCATION_MARKER = '… [truncated]';

const FORBIDDEN_TOKENS = new Set([
  'approve',
  'reject',
  'refer',
  'decide',
  'override',
  'sanction',
  'disburse',
  'calculate',
  'compute',
  'emi',
  'foir',
  'ltv',
]);

/** True for any tool name an agent must never be given, e.g. `approve_loan`, `compute_foir`, `set_policy`. */
export function isForbiddenToolName(name) {
  const tokens = String(name).toLowerCase().split(/[^a-z0-9]+/);
  return tokens.some((t) => FORBIDDEN_TOKENS.has(t)) || /set_?policy/i.test(String(name));
}

function boundText(text) {
  return text.length <= MAX_TOOL_ERROR_CHARS ? text : text.slice(0, MAX_TOOL_ERROR_CHARS) + TRUNCATION_MARKER;
}

/** A tool result reporting failure, in the shape models are shown. */
export function toolError(message) {
  return JSON.stringify({ error: boundText(String(message)) });
}

export function createRegistry() {
  const tools = new Map();

  return {
    register({ name, toolset, description = '', parameters = { type: 'object', properties: {} }, handler }) {
      if (!name || typeof handler !== 'function') throw new TypeError('A tool needs a name and a handler.');
      if (isForbiddenToolName(name)) {
        throw new Error(`Refusing to register "${name}": agents never get tools that decide or compute credit outcomes.`);
      }
      if (tools.has(name)) throw new Error(`Tool "${name}" is already registered.`);
      tools.set(name, { name, toolset, description, parameters, handler });
      return this;
    },

    has(name) {
      return tools.has(name);
    },

    names(toolset) {
      return [...tools.values()].filter((t) => !toolset || t.toolset === toolset).map((t) => t.name);
    },

    /** Model-facing definitions for exactly these tool names (unknown names are skipped). */
    definitions(names) {
      return names
        .filter((n) => tools.has(n))
        .map((n) => {
          const t = tools.get(n);
          return { name: t.name, description: t.description, parameters: t.parameters };
        });
    },

    /** Run a tool. Always resolves to a string; a thrown handler becomes a bounded error result. */
    async dispatch(name, args, context) {
      const tool = tools.get(name);
      if (!tool) return toolError(`Unknown tool "${name}".`);
      try {
        const out = await tool.handler(args ?? {}, context ?? {});
        return typeof out === 'string' ? out : JSON.stringify(out ?? null);
      } catch (err) {
        return toolError(err?.message ?? String(err));
      }
    },
  };
}
