/**
 * RECALLER — agent runtime tests.
 *
 *   node scripts/test-agent.mjs
 *
 * Every model here is a scripted fake, so nothing depends on a network or a
 * provider. These pin the boundaries: which tools an agent can reach, what a
 * child agent can see, and what the evidence agent is allowed to record.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  createRegistry,
  isForbiddenToolName,
  resolveToolset,
  runAgent,
  delegateTask,
  registerDelegateTool,
  validate,
  generateStructured,
  parseSkill,
  skillPrompt,
  createAgentExtractionAdapter,
  createNarrationStylist,
} from '../packages/agent/src/index.js';
import { extractBundle, applyConfidenceGate } from '../packages/extraction/src/index.js';
import { narrate } from '../packages/narration/src/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const policy = JSON.parse(readFileSync(join(root, 'policy/policy.v1.json'), 'utf8'));

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed += 1;
  else failures.push(`${name}\n      expected ${e}\n      actual   ${a}`);
}

function ok(name, condition, detail = '') {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? `\n      ${detail}` : ''}`);
}

/** A fake model that plays back replies in order; a function reply receives the request. */
function scripted(replies) {
  const calls = [];
  let i = 0;
  const model = async (req) => {
    // Snapshot: the loop keeps appending to the same transcript after the call.
    calls.push({ ...req, messages: [...req.messages] });
    const r = replies[Math.min(i, replies.length - 1)];
    i += 1;
    return typeof r === 'function' ? r(req) : r;
  };
  model.calls = calls;
  return model;
}

const call = (name, args, id) => ({ tool_calls: [{ id, name, arguments: args }] });

/* ================================================================== *
 * Registry: no agent can be handed a decision
 * ================================================================== */

for (const name of ['approve_loan', 'reject_application', 'calculate_emi', 'compute_foir', 'set_policy', 'override_decision', 'refer_case']) {
  ok(`forbidden tool name: ${name}`, isForbiddenToolName(name));
  let threw = false;
  try {
    createRegistry().register({ name, handler: () => null });
  } catch {
    threw = true;
  }
  ok(`registry refuses ${name}`, threw);
}
for (const name of ['read_decision', 'record_evidence', 'read_reference', 'flag_issue', 'delegate_task']) {
  ok(`allowed tool name: ${name}`, !isForbiddenToolName(name));
}

{
  const reg = createRegistry().register({ name: 'boom', handler: () => { throw new Error('x'.repeat(5000)); } });
  const out = JSON.parse(await reg.dispatch('boom', {}));
  ok('a thrown handler becomes a bounded error', out.error.length < 2100 && out.error.endsWith('[truncated]'));
}

/* ================================================================== *
 * Toolsets
 * ================================================================== */

check('evidence toolset', resolveToolset('evidence'), ['read_document', 'record_evidence', 'flag_issue']);
check('supervisor includes review + delegation', resolveToolset('supervisor').sort(), ['delegate_task', 'flag_issue', 'read_evidence']);

/* ================================================================== *
 * The loop
 * ================================================================== */

{
  const seen = [];
  const reg = createRegistry()
    .register({ name: 'echo', handler: (args) => { seen.push(args); return { echoed: args.text }; } })
    .register({ name: 'secret', handler: () => { seen.push('secret'); return 'leaked'; } });

  const model = scripted([call('echo', '{"text":"hi"}', 'c1'), call('secret', {}, 'c2'), { content: 'done' }]);
  const run = await runAgent({ model, registry: reg, toolNames: ['echo'], messages: [{ role: 'user', content: 'go' }] });

  check('loop completes on a plain reply', run.exitReason, 'completed');
  check('loop parses JSON-string arguments', seen[0], { text: 'hi' });
  ok('a tool outside the toolset is never executed', !seen.includes('secret'));
  ok('the refusal names the available tools', /not available.*echo/.test(run.toolCalls[1].result));
  check('only allowed tools are advertised', model.calls[0].tools.map((t) => t.name), ['echo']);
  check('tool results are threaded back in order', run.messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id), ['c1', 'c2']);
}

{
  const reg = createRegistry().register({ name: 'echo', handler: () => 'ok' });
  const run = await runAgent({ model: scripted([call('echo', {})]), registry: reg, toolNames: ['echo'], maxIterations: 3 });
  check('loop stops at the iteration budget', [run.exitReason, run.iterations], ['max_iterations', 3]);
}

/* ================================================================== *
 * Structured output
 * ================================================================== */

const verdictSchema = {
  type: 'object',
  properties: { status: { type: 'string', enum: ['MATCHED', 'ADVISORY'] }, score: { type: 'number', minimum: 0, maximum: 1 } },
  required: ['status', 'score'],
  additionalProperties: false,
};

check('validate: clean object', validate(verdictSchema, { status: 'MATCHED', score: 0.9 }), []);
check('validate: every violation reported', validate(verdictSchema, { status: 'NOPE', score: 2, extra: 1 }).length, 3);
check('validate: missing required', validate(verdictSchema, { status: 'MATCHED' }), ['$.score: is required']);

{
  const model = scripted([{ content: 'not json' }, { content: '{"status":"MATCHED","score":7}' }, { content: '```json\n{"status":"ADVISORY","score":0.4}\n```' }]);
  const res = await generateStructured({ model, prompt: 'grade', schema: verdictSchema });
  check('structured output retries until valid', [res.ok, res.attempts, res.value], [true, 3, { status: 'ADVISORY', score: 0.4 }]);
  ok('the retry shows the model its errors', /score: must be ≤ 1/.test(model.calls[2].messages.at(-1).content));
}
{
  const res = await generateStructured({ model: scripted([{ content: '{}' }]), prompt: 'grade', schema: verdictSchema, maxRetries: 1 });
  check('structured output gives up after its retries', [res.ok, res.attempts], [false, 2]);
}

/* ================================================================== *
 * Delegation
 * ================================================================== */

{
  const reg = createRegistry().register({ name: 'read_evidence', handler: () => ({ fields: 3 }) });
  registerDelegateTool(reg, { model: null }); // registered so the parent could advertise it
  const model = scripted([
    (req) => ({ content: req.system.includes('Goal: A') ? 'summary A' : 'summary B' }),
  ]);
  const out = await delegateTask({
    tasks: [{ goal: 'A', context: 'only A context' }, { goal: 'B' }],
    model,
    registry: reg,
    parent: { depth: 0, toolNames: ['read_evidence', 'delegate_task'] },
  });

  check('children return only their summaries', out.results.map((r) => [r.status, r.summary]), [['completed', 'summary A'], ['completed', 'summary B']]);
  ok('a child starts with a fresh conversation', model.calls.every((c) => c.messages.length === 1 && ['A', 'B'].includes(c.messages[0].content)));
  ok('a child sees only its own context', !model.calls.find((c) => c.system.includes('Goal: B')).system.includes('only A context'));
  ok('leaf children cannot delegate', model.calls.every((c) => !c.tools.some((t) => t.name === 'delegate_task')));
  ok('children keep the parent’s other tools', model.calls.every((c) => c.tools.some((t) => t.name === 'read_evidence')));

  const deep = await delegateTask({ tasks: [{ goal: 'x' }], model, registry: reg, parent: { depth: 1 } });
  ok('depth limit is enforced', /depth limit/.test(deep.error ?? ''));
}

{
  const reg = createRegistry();
  const model = scripted([{ content: 'I think it matches' }, { content: '{"status":"MATCHED","score":0.97}' }]);
  const out = await delegateTask({ tasks: [{ goal: 'compare names', output_schema: verdictSchema }], model, registry: reg });
  check('output schema gets one correction retry', [out.results[0].schema_valid, out.results[0].output], [true, { status: 'MATCHED', score: 0.97 }]);
}

/* ================================================================== *
 * Skill
 * ================================================================== */

{
  const skill = parseSkill(readFileSync(join(root, 'packages/agent/skills/credit-underwriter/SKILL.md'), 'utf8'));
  check('skill frontmatter parses', [skill.name, skill.version], ['credit-underwriter', '1.0.0']);
  const prompt = skillPrompt(skill, { 'evidence-rules': readFileSync(join(root, 'packages/agent/skills/credit-underwriter/references/evidence-rules.md'), 'utf8') });
  ok('skill prompt carries the prohibitions', prompt.includes('## You may not') && prompt.includes('Reference: evidence-rules'));
}

/* ================================================================== *
 * Evidence agent: grounding is enforced, not requested
 * ================================================================== */

const invoice = {
  id: 'doc-inv',
  type: 'DEALER_INVOICE',
  filename: 'invoice_ev.pdf',
  pages: [
    'TAX INVOICE  INV-24-08817\nEx-showroom price  Rs 1,09,500.00\nRegistration & RTO  Rs 14,500.00\nOn-road price  Rs 1,24,000.00\nChassis No. MD9EVS24A7K004471',
  ],
};

function invoiceModel(onRoadConfidence) {
  return scripted([
    call('read_document', { page: 1 }, 'r1'),
    call('record_evidence', { path: 'invoice.on_road_price', value: '1,24,000', confidence: onRoadConfidence, page: 1, snippet: 'On-road price  Rs 1,24,000.00' }, 'e1'),
    call('record_evidence', { path: 'invoice.ex_showroom', value: 110000, confidence: 0.99, page: 1, snippet: 'Ex-showroom price  Rs 1,09,500.00' }, 'e2'),
    call('record_evidence', { path: 'invoice.chassis_number', value: 'MD9EVS24A7K004471', confidence: 0.97, page: 1, snippet: 'Chassis No. MD9EVS24A7K009999' }, 'e3'),
    call('record_evidence', { path: 'applicant.name', value: 'ARJUN', confidence: 0.99, page: 1, snippet: 'TAX INVOICE' }, 'e4'),
    call('record_evidence', { path: 'invoice.on_road_price', value: 124000, confidence: 1.4, page: 1, snippet: 'On-road price  Rs 1,24,000.00' }, 'e5'),
    call('record_evidence', { path: 'invoice.chassis_number', value: 'MD9EVS24A7K004471', confidence: 0.97, page: 1, snippet: 'chassis no.   MD9EVS24A7K004471' }, 'e6'),
    { content: 'Recorded on-road price and chassis number.' },
  ]);
}

{
  const events = [];
  const model = invoiceModel(0.95);
  const adapter = createAgentExtractionAdapter({ model, onEvent: (e) => events.push(e) });
  const fields = await adapter.extract(invoice);
  const results = model.calls.at(-1).messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content));

  check('only grounded fields are recorded', Object.keys(fields).sort(), ['invoice.chassis_number', 'invoice.on_road_price']);
  check('printed money is read, formatting removed', fields['invoice.on_road_price'].value, 124000);
  check('recorded fields carry EXTRACTED provenance and a page citation', [fields['invoice.on_road_price'].provenance, fields['invoice.on_road_price'].citation.page], ['EXTRACTED', 1]);
  ok('an inferred number is refused', /does not appear in the snippet/.test(results[2].error ?? ''));
  ok('a snippet not on the page is refused', /does not appear on the cited page/.test(results[3].error ?? ''));
  ok('a field from another document type is refused', /not a field a DEALER_INVOICE/.test(results[4].error ?? ''));
  ok('an out-of-range confidence is refused', /between 0 and 1/.test(results[5].error ?? ''));
  ok('whitespace and case never defeat a verbatim quote', results[6].ok === true);
  ok('the model is never offered derived or declared fields', !model.calls[0].tools.find((t) => t.name === 'record_evidence').parameters.properties.path.enum.some((p) => p === 'applicant.age' || p === 'applicant.declared_monthly_income'));
  ok('extraction reports its outcome to observers', events.some((e) => e.type === 'extraction_done' && e.exit_reason === 'completed'));

  const bundle = await extractBundle({ documents: [invoice], application: {}, adapter: createAgentExtractionAdapter({ model: invoiceModel(0.95) }), seed: 'T' });
  check('the agent plugs into extractBundle unchanged', bundle.stats.adapter, 'agent');
  ok('a clean read clears the confidence gate', !applyConfidenceGate(bundle.fields, policy).held.some((h) => h.path === 'invoice.on_road_price'));

  const shaky = await extractBundle({ documents: [invoice], application: {}, adapter: createAgentExtractionAdapter({ model: invoiceModel(0.7) }), seed: 'T' });
  const held = applyConfidenceGate(shaky.fields, policy).held.find((h) => h.path === 'invoice.on_road_price');
  ok('a low-confidence read is held for an officer', held?.critical === true && held?.floor === 0.88);
}

{
  let threw = false;
  try {
    await createAgentExtractionAdapter({ model: scripted([{ content: '' }]) }).extract({ id: 'x', type: 'PAN' });
  } catch (err) {
    threw = /run OCR before extraction/.test(err.message);
  }
  ok('a document without text is refused, not guessed at', threw);
}

/* ================================================================== *
 * Narration stylist: wording may change, figures may not
 * ================================================================== */

{
  const memo = { sections: [{ id: 'income', kind: 'prose', body: 'Recognised income is ₹18,400.00 per month over 6 months.' }] };
  const drifted = await narrate(memo, { stylist: createNarrationStylist({ model: scripted([{ content: 'Income is roughly ₹18,500 a month.' }]) }) });
  check('a rewrite that moves a figure is discarded', drifted.sections[0].body, memo.sections[0].body);
  // narrate() compares numeric tokens in order, punctuation included, so a kept figure must also keep its place.
  const styled = await narrate(memo, { stylist: createNarrationStylist({ model: scripted([{ content: 'Recognised monthly income stands at ₹18,400.00 across 6 months.' }]) }) });
  ok('a rewrite that keeps every figure is accepted', styled.sections[0].styled === true);
}

/* ================================================================== *
 * Structural invariant: the agent package cannot reach the engines
 * ================================================================== */

{
  const files = [];
  const walk = (dir) => readdirSync(dir).forEach((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : files.push(join(dir, f))));
  walk(join(root, 'packages/agent/src'));
  const offenders = files.filter((f) => /credit-engine|policy-engine|whatif/.test(readFileSync(f, 'utf8').match(/^import .*$/gm)?.join('\n') ?? ''));
  check('packages/agent imports neither credit-engine, policy-engine nor whatif', offenders, []);
}

/* ================================================================== */

console.log(`\n  agent runtime: ${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exit(1);
}
