/**
 * RECALLER — agent runtime.
 *
 * A small, dependency-free JavaScript port of the parts of Hermes Agent
 * (NousResearch/hermes-agent, MIT) that a credit reasoning layer needs: the
 * tool loop, least-privilege toolsets, isolated delegation, skills and
 * validated structured output. The model client is injected, so no key or
 * provider SDK lives in this package.
 *
 * Invariant: nothing here imports credit-engine or policy-engine, and the
 * registry refuses any tool that decides or computes a credit outcome.
 * scripts/test-agent.mjs asserts both.
 */

export { createRegistry, toolError, isForbiddenToolName } from './registry.js';
export { TOOLSETS, resolveToolset, resolveToolsets } from './toolsets.js';
export { runAgent, DEFAULT_MAX_ITERATIONS } from './loop.js';
export {
  delegateTask,
  registerDelegateTool,
  buildChildSystemPrompt,
  DELEGATE_BLOCKED_TOOLS,
  DELEGATE_TASK_SCHEMA,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_CHILDREN,
} from './delegate.js';
export { validate, parseJsonReply, checkSchema, generateStructured } from './structured.js';
export { parseSkill, skillPrompt } from './skills.js';
export { createAgentExtractionAdapter } from './adapters/extraction.js';
export { createNarrationStylist } from './adapters/narration.js';
