/**
 * Shared vocabulary, filled once from GET /api/bootstrap.
 *
 * The Python backend is the single source of truth for these enums and labels.
 * They are exported as live bindings / mutable containers so modules can
 * import them statically; the console does not render until they are filled.
 */

export let ENGINE_VERSION = '';
export let WORKFLOW_VERSION = '';
export const STATUS_LABELS = {};
export const DOC_LABELS = {};
export const PROVENANCE = {};
export const STAGE_LABELS = {};
export const REQUIRED_DOCS = [];
export const OPTIONAL_DOCS = [];
export const DECISIONS = [];

export function fillVocab(boot) {
  ENGINE_VERSION = boot.engine_version;
  WORKFLOW_VERSION = boot.workflow_version;
  const v = boot.vocab;
  Object.assign(STATUS_LABELS, v.status_labels);
  Object.assign(DOC_LABELS, v.doc_labels);
  Object.assign(PROVENANCE, v.provenance);
  Object.assign(STAGE_LABELS, v.stage_labels ?? {});
  REQUIRED_DOCS.splice(0, REQUIRED_DOCS.length, ...v.required_docs);
  OPTIONAL_DOCS.splice(0, OPTIONAL_DOCS.length, ...v.optional_docs);
  DECISIONS.splice(0, DECISIONS.length, ...v.decisions);
}
