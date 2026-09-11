/**
 * RECALLER — evidence-reading agent, behind the extraction adapter interface.
 *
 * packages/extraction defines one interface, `{ name, extract(document, { seed }) }`,
 * with a slot for a model-backed adapter. This is that adapter. The model
 * reads the document's text pages; the only way a value enters the evidence
 * set is `record_evidence`, which enforces grounding:
 *
 *   - the path must be a field this document type carries (derived and
 *     declared fields can never be read from a document);
 *   - the snippet must appear verbatim (whitespace- and case-insensitive) on
 *     the cited page;
 *   - text and id values must appear inside the snippet, and every number in
 *     a money, number or list value must appear in it too. Numbers are read,
 *     never inferred or summed.
 *
 * A refused field comes back to the model with the reason, and it may try
 * again. Everything recorded still passes the confidence gate downstream. OCR
 * happens before this adapter: it expects `document.pages` (strings) or
 * `document.text` (pages separated by form feeds).
 */

import { EVIDENCE_SPEC, field } from '../../../extraction/src/schema.js';
import { PROVENANCE } from '../../../core/src/constants.js';
import { createRegistry } from '../registry.js';
import { runAgent } from '../loop.js';
import { resolveToolset } from '../toolsets.js';

export function createAgentExtractionAdapter({ model, skillPrompt = '', maxIterations = 24, onEvent } = {}) {
  if (typeof model !== 'function') throw new TypeError('createAgentExtractionAdapter needs a model function.');

  return {
    name: 'agent',
    async extract(document) {
      const pages = documentPages(document);
      const specs = EVIDENCE_SPEC.filter((s) => s.doc === document.type && !s.derived && !s.declared);
      const recorded = {};
      const issues = [];

      const registry = createRegistry()
        .register({
          name: 'read_document',
          toolset: 'evidence',
          description: 'Return the text of one page of the document (pages are 1-based).',
          parameters: { type: 'object', properties: { page: { type: 'integer', minimum: 1 } }, required: ['page'] },
          handler: ({ page }) =>
            pages[page - 1] === undefined
              ? { error: `Page ${page} does not exist; the document has ${pages.length}.` }
              : { page, text: pages[page - 1] },
        })
        .register({
          name: 'record_evidence',
          toolset: 'evidence',
          description:
            'Record one field read from the document, with a confidence (0–1) and a verbatim snippet from the cited page that contains the value.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', enum: specs.map((s) => s.path) },
              value: { description: 'The value exactly as printed (numbers without currency formatting are fine).' },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              page: { type: 'integer', minimum: 1 },
              snippet: { type: 'string' },
            },
            required: ['path', 'value', 'confidence', 'page', 'snippet'],
          },
          handler: (args) => recordEvidence(args),
        })
        .register({
          name: 'flag_issue',
          toolset: 'evidence',
          description: 'Note something an officer should see: an illegible region, an alteration, a missing section.',
          parameters: {
            type: 'object',
            properties: { note: { type: 'string' }, path: { type: 'string' } },
            required: ['note'],
          },
          handler: ({ note, path }) => {
            issues.push({ document_id: document.id, path: path ?? null, note: String(note ?? '') });
            return { ok: true };
          },
        });

      function recordEvidence({ path, value, confidence, page, snippet }) {
        const spec = specs.find((s) => s.path === path);
        if (!spec) {
          return { error: `"${path}" is not a field a ${document.type} document provides. Allowed: ${specs.map((s) => s.path).join(', ')}.` };
        }
        if (typeof confidence !== 'number' || !(confidence >= 0 && confidence <= 1)) {
          return { error: 'confidence must be a number between 0 and 1.' };
        }
        const text = pages[page - 1];
        if (text === undefined) return { error: `Page ${page} does not exist.` };
        if (typeof snippet !== 'string' || !snippet.trim()) return { error: 'A verbatim snippet from the page is required.' };
        if (!squash(text).includes(squash(snippet))) {
          return { error: 'That snippet does not appear on the cited page. Quote the document exactly.' };
        }
        const typed = coerce(spec, value, snippet);
        if (typed.error) return { error: typed.error };

        recorded[path] = field(path, typed.value, {
          confidence,
          provenance: PROVENANCE.EXTRACTED,
          citation: {
            document: document.filename,
            document_id: document.id,
            page,
            snippet: snippet.trim().slice(0, 160),
          },
          raw: snippet.trim(),
        });
        return { ok: true, path };
      }

      const run = await runAgent({
        model,
        registry,
        toolNames: resolveToolset('evidence'),
        system: systemPrompt(skillPrompt, document, specs, pages.length),
        messages: [
          {
            role: 'user',
            content: `Read ${document.filename ?? document.id} (${document.type}, ${pages.length} page${pages.length === 1 ? '' : 's'}) and record every field you can ground in it.`,
          },
        ],
        maxIterations,
        onEvent,
      });

      emit(onEvent, { type: 'extraction_done', document_id: document.id, exit_reason: run.exitReason, recorded: Object.keys(recorded), issues });
      return recorded;
    },
  };
}

function documentPages(document) {
  if (Array.isArray(document.pages) && document.pages.length) return document.pages.map(String);
  if (typeof document.text === 'string' && document.text.trim()) return document.text.split('\f');
  throw new Error(
    `Document ${document.id ?? '(unnamed)'} has no text. The agent adapter reads text pages; run OCR before extraction.`,
  );
}

function systemPrompt(skillText, document, specs, pageCount) {
  return [
    skillText.trim(),
    `Document type: ${document.type}. Pages: ${pageCount}.`,
    `Fields this document can provide:\n${specs.map((s) => `- ${s.path} (${s.type}): ${s.label}`).join('\n')}`,
    'Read pages with read_document. Record each field with record_evidence, quoting the snippet that contains it. ' +
      'If a field is absent or you cannot read it, do not record it; use flag_issue instead. Finish with a one-line summary.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Lower-case and collapse whitespace so line wrapping never defeats a verbatim match. */
function squash(s) {
  return String(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Every number printed in a string, with thousands separators removed. */
function numbersIn(text) {
  return (String(text).match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, '')));
}

function coerce(spec, value, snippet) {
  const printed = numbersIn(snippet);
  const grounded = (n) => printed.some((p) => Math.abs(p - n) < 1e-9);

  if (spec.type === 'money' || spec.type === 'number') {
    const n = typeof value === 'number' ? value : Number(String(value).replace(/[,\s₹]/g, ''));
    if (!Number.isFinite(n)) return { error: `${spec.path} must be a number.` };
    if (!grounded(n)) return { error: `The value ${value} does not appear in the snippet. Numbers are read, never inferred.` };
    return { value: n };
  }
  if (spec.type === 'list') {
    if (!Array.isArray(value)) return { error: `${spec.path} must be a list.` };
    const missing = numbersIn(JSON.stringify(value)).filter((n) => !grounded(n));
    if (missing.length) return { error: `These numbers do not appear in the snippet: ${missing.join(', ')}. Do not add up or derive values.` };
    return { value };
  }
  if (typeof value !== 'string' || !value.trim()) return { error: `${spec.path} must be a non-empty string.` };
  if (spec.type !== 'date' && !squash(snippet).includes(squash(value))) {
    return { error: `The value "${value}" does not appear in the snippet.` };
  }
  return { value: value.trim() };
}

function emit(onEvent, event) {
  if (typeof onEvent !== 'function') return;
  try {
    onEvent(event);
  } catch {
    // an observer must never break extraction
  }
}
