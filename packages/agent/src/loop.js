/**
 * RECALLER agent runtime — the conversation loop.
 *
 * Adapted from NousResearch/hermes-agent `agent/conversation_loop.py` and the
 * `AIAgent` facade in `run_agent.py` (MIT). Kept: call the model, dispatch any
 * tool calls through the registry, feed the results back, repeat until the
 * model answers in plain text or the iteration budget runs out. An unknown or
 * unavailable tool is answered with an error listing the valid tools, never
 * executed. The exit reason is either `completed` or `max_iterations`.
 *
 * Dropped: context compression, prompt caching, provider fallback and billing
 * handling. A credit file is small and bounded, and the provider lives behind
 * the injected `model` function.
 *
 * Model contract (providers adapt to this shape):
 *   model({ system, messages, tools })
 *     → Promise<{ content?: string, tool_calls?: [{ id?, name, arguments }] }>
 * `arguments` may be an object or a JSON string.
 */

import { toolError } from './registry.js';

export const DEFAULT_MAX_ITERATIONS = 12;

export async function runAgent({
  model,
  registry,
  toolNames = [],
  system = '',
  messages = [],
  maxIterations = DEFAULT_MAX_ITERATIONS,
  context = {},
  onEvent,
}) {
  if (typeof model !== 'function') throw new TypeError('runAgent needs a model function.');
  const allowed = new Set(toolNames.filter((n) => registry.has(n)));
  const tools = registry.definitions([...allowed]);
  const transcript = [...messages];
  const toolCalls = [];

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const reply = await model({ system, messages: transcript, tools });
    const calls = normaliseCalls(reply?.tool_calls);
    const content = reply?.content ?? '';
    transcript.push({ role: 'assistant', content, ...(calls.length ? { tool_calls: calls } : {}) });

    if (!calls.length) {
      emit(onEvent, { type: 'final', iteration });
      return { content, messages: transcript, toolCalls, iterations: iteration, exitReason: 'completed' };
    }

    for (const call of calls) {
      let result;
      if (!allowed.has(call.name)) {
        result = toolError(
          `Tool "${call.name}" is not available to this agent. Available tools: ${[...allowed].join(', ') || 'none'}.`,
        );
      } else {
        const args = parseArgs(call.arguments);
        result =
          args instanceof Error
            ? toolError(`Arguments for "${call.name}" are not valid JSON: ${args.message}`)
            : await registry.dispatch(call.name, args, { ...context, toolNames: [...allowed] });
      }
      toolCalls.push({ name: call.name, arguments: call.arguments, result });
      transcript.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: result });
      emit(onEvent, { type: 'tool', iteration, name: call.name });
    }
  }

  emit(onEvent, { type: 'max_iterations', iteration: maxIterations });
  return { content: '', messages: transcript, toolCalls, iterations: maxIterations, exitReason: 'max_iterations' };
}

function normaliseCalls(calls) {
  if (!Array.isArray(calls)) return [];
  return calls
    .filter((c) => c && c.name)
    .map((c, i) => ({ id: c.id ?? `call_${i}`, name: String(c.name), arguments: c.arguments ?? {} }));
}

function parseArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (raw === undefined || raw === null || raw === '') return {};
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : new Error('expected a JSON object');
  } catch (err) {
    return err;
  }
}

function emit(onEvent, event) {
  if (typeof onEvent !== 'function') return;
  try {
    onEvent(event);
  } catch {
    // an observer must never break a run
  }
}
