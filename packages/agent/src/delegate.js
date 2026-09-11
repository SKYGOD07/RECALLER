/**
 * RECALLER agent runtime — delegation to isolated child agents.
 *
 * Adapted from NousResearch/hermes-agent `tools/delegate_tool.py` (MIT). Kept
 * from its contract:
 *   - each child gets a fresh conversation and a focused system prompt built
 *     from its goal and context; it knows nothing else of the parent's run;
 *   - children inherit the parent's tools minus DELEGATE_BLOCKED_TOOLS;
 *   - nesting is bounded by depth (a child may delegate only while depth remains);
 *   - the parent sees only each child's final summary, never its tool calls;
 *   - an optional `output_schema` is validated with one bounded correction retry.
 *
 * Dropped: sessions, terminals, heartbeats, background dispatch and credential
 * pools. A credit file is processed synchronously, in one place.
 *
 * Child summaries are self-reports. Nothing a child returns enters the evidence
 * set except through a grounded tool such as `record_evidence`.
 */

import { runAgent, DEFAULT_MAX_ITERATIONS } from './loop.js';
import { checkSchema } from './structured.js';

export const DELEGATE_BLOCKED_TOOLS = ['delegate_task'];
export const DEFAULT_MAX_DEPTH = 1; // the top-level agent may delegate; its children are leaves
export const DEFAULT_MAX_CHILDREN = 4;

export const DELEGATE_TASK_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description: 'What this child should accomplish. Self-contained: it knows nothing of your conversation.',
          },
          context: {
            type: 'string',
            description: 'Everything this child needs: evidence excerpts, constraints. Children share nothing.',
          },
          output_schema: {
            type: 'object',
            description: 'Optional JSON Schema the final answer must satisfy (one correction retry).',
          },
        },
        required: ['goal'],
      },
    },
  },
  required: ['tasks'],
};

export function buildChildSystemPrompt(task, prefix = '') {
  return [
    prefix.trim(),
    'You are a focused sub-agent inside RECALLER. You know nothing of the parent run beyond what is written here.',
    `Goal: ${task.goal}`,
    task.context ? `Context:\n${task.context}` : '',
    task.output_schema
      ? `Your final reply must be only JSON matching this schema:\n${JSON.stringify(task.output_schema)}`
      : 'Finish with a concise summary of what you found. It is a self-report; the parent will verify it.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Register `delegate_task` on a registry. `parent` context (depth and the
 * parent's own tool names) arrives through the loop's dispatch context.
 */
export function registerDelegateTool(registry, options) {
  return registry.register({
    name: 'delegate_task',
    toolset: 'delegation',
    description:
      'Spawn isolated sub-agents for reasoning-heavy subtasks; only their final summaries return. ' +
      'Pass everything a child needs in its context. Summaries are self-reports, not verified facts.',
    parameters: DELEGATE_TASK_SCHEMA,
    handler: (args, context) => delegateTask({ ...options, registry, tasks: args.tasks, parent: context }),
  });
}

export async function delegateTask({
  tasks,
  model,
  registry,
  parent = {},
  maxDepth = DEFAULT_MAX_DEPTH,
  maxChildren = DEFAULT_MAX_CHILDREN,
  maxIterations = DEFAULT_MAX_ITERATIONS,
  systemPrefix = '',
}) {
  const depth = parent.depth ?? 0;
  if (depth >= maxDepth) return { error: `Delegation depth limit reached (depth=${depth}, max=${maxDepth}).` };
  if (!Array.isArray(tasks) || tasks.length === 0 || tasks.some((t) => !t?.goal)) {
    return { error: 'delegate_task needs at least one task, and every task needs a goal.' };
  }
  if (tasks.length > maxChildren) return { error: `At most ${maxChildren} tasks per call.` };

  const childDepth = depth + 1;
  const blocked = childDepth >= maxDepth ? DELEGATE_BLOCKED_TOOLS : [];
  const toolNames = (parent.toolNames ?? []).filter((n) => !blocked.includes(n));

  const results = await Promise.all(
    tasks.map((task, index) =>
      runChild({ index, task, model, registry, toolNames, depth: childDepth, maxIterations, systemPrefix }),
    ),
  );
  return { results };
}

async function runChild({ index, task, model, registry, toolNames, depth, maxIterations, systemPrefix }) {
  const system = buildChildSystemPrompt(task, systemPrefix);
  const entry = { task_index: index, goal: task.goal };
  try {
    const run = await runAgent({
      model,
      registry,
      toolNames,
      system,
      messages: [{ role: 'user', content: task.goal }],
      maxIterations,
      context: { depth },
    });
    Object.assign(entry, {
      status: run.exitReason === 'completed' ? 'completed' : 'failed',
      exit_reason: run.exitReason,
      summary: run.content,
      tool_calls: run.toolCalls.length,
    });
    if (!task.output_schema) return entry;

    let check = checkSchema(run.content, task.output_schema);
    if (!check.valid && run.exitReason === 'completed') {
      const retry = await runAgent({
        model,
        registry,
        toolNames: [], // the correction is a rewrite, not more work
        system,
        messages: [
          ...run.messages,
          {
            role: 'user',
            content: `Your final answer did not match the required schema:\n- ${check.errors.join('\n- ')}\nReply again with only the corrected JSON.`,
          },
        ],
        maxIterations: 1,
        context: { depth },
      });
      entry.summary = retry.content;
      check = checkSchema(retry.content, task.output_schema);
    }
    entry.schema_valid = check.valid;
    if (check.valid) entry.output = check.value;
    else entry.schema_errors = check.errors;
    return entry;
  } catch (err) {
    return { ...entry, status: 'failed', exit_reason: 'error', summary: String(err?.message ?? err) };
  }
}
