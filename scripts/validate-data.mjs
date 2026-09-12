/**
 * RECALLER — synthetic fixture and policy validation.
 *
 *   node --import ./scripts/alias.mjs scripts/validate-data.mjs
 *
 * Checks the demo data and the policy document against the schema the engines
 * assume, before any of them are run. A fixture that silently loses a field
 * produces a plausible-looking wrong number, which is the one failure mode this
 * product cannot have.
 */

import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'

import { DOC_TYPES, REQUIRED_DOCS } from '@core/constants.js'
import { EVIDENCE_SPEC, SPEC_BY_PATH, getPath } from '@extraction/schema.js'
import { SYNTHETIC_APPLICATIONS } from '@synthetic/applications.js'

const POLICY = JSON.parse(
  await readFile(new URL('../policy/policy.v1.json', import.meta.url), 'utf8')
)

let checks = 0
let failures = 0
const problems = []

function check(ok, label) {
  checks += 1
  if (!ok) {
    failures += 1
    problems.push(label)
  }
}

/* ------------------------------------------------------------- policy */

check(Boolean(POLICY.policy_id), 'policy has an id')
check(Boolean(POLICY.version), 'policy has a version')
check(Array.isArray(POLICY.rules) && POLICY.rules.length > 0, 'policy has rules')

const KNOWN_OPERATORS = new Set(['lte', 'gte', 'lt', 'gt', 'eq'])
// These two read their bounds from the segment the application was filed under,
// so they carry no threshold of their own.
const SEGMENT_SCOPED_OPERATORS = new Set(['within_segment_ticket', 'within_segment_tenure'])

for (const rule of POLICY.rules) {
  check(Boolean(rule.code), 'rule has a code')
  check(Boolean(rule.metric), `${rule.code}: rule names a metric`)
  check(
    KNOWN_OPERATORS.has(rule.operator) || SEGMENT_SCOPED_OPERATORS.has(rule.operator),
    `${rule.code}: operator "${rule.operator}" is known`
  )
  if (!SEGMENT_SCOPED_OPERATORS.has(rule.operator)) {
    check(rule.threshold != null, `${rule.code}: rule has a threshold`)
  }
  check(Boolean(rule.rationale), `${rule.code}: rule explains itself`)
  for (const key of ['reject_reason', 'refer_reason', 'pass_reason']) {
    const code = rule[key]
    check(code == null || code in POLICY.reason_codes, `${rule.code}: ${key} "${code}" is defined`)
  }
  if (rule.refer_band) {
    check(
      Array.isArray(rule.refer_band) && rule.refer_band.length === 2 &&
        rule.refer_band[0] <= rule.refer_band[1],
      `${rule.code}: refer band is a valid interval`
    )
  }
}

// Every threshold the confidence gate depends on must be present, and the
// attested floors must sit below the extraction floors — otherwise attested
// evidence, which is capped lower by construction, could never clear the gate.
const conf = POLICY.confidence || {}
for (const key of [
  'field_threshold',
  'critical_field_threshold',
  'attested_field_threshold',
  'attested_critical_field_threshold',
]) {
  check(typeof conf[key] === 'number', `policy.confidence.${key} is set`)
}
check(
  conf.attested_field_threshold < conf.field_threshold,
  'attested floor sits below the extraction floor'
)
check(
  conf.attested_critical_field_threshold < conf.critical_field_threshold,
  'attested critical floor sits below the extraction critical floor'
)
check(
  conf.informant?.source_confidence_ceiling > conf.attested_critical_field_threshold,
  'a sound attestation can actually clear its own critical floor'
)
// The confidence gate walks evidence fields and matches on path. A metric name
// listed here silently matches nothing, which reads in the policy document as a
// protection that does not exist.
for (const path of conf.critical_fields || []) {
  check(
    path in SPEC_BY_PATH,
    `policy.confidence.critical_fields: "${path}" is not an evidence field, so the ` +
      'gate can never match it (computed metrics are governed by rules, not floors)'
  )
}

/* ------------------------------------------------------------- schema */

const seen = new Set()
for (const spec of EVIDENCE_SPEC) {
  check(!seen.has(spec.path), `schema: ${spec.path} is declared once`)
  seen.add(spec.path)
  check(Boolean(spec.label), `schema: ${spec.path} has a label`)
  check(Boolean(spec.type), `schema: ${spec.path} has a type`)
  check(
    spec.doc == null || Object.values(DOC_TYPES).includes(spec.doc),
    `schema: ${spec.path} names a known document type`
  )
}

/* ----------------------------------------------------------- fixtures */

const ids = new Set()
for (const app of SYNTHETIC_APPLICATIONS) {
  const label = app.id || '(unnamed)'
  check(Boolean(app.id), 'fixture has an id')
  check(!ids.has(app.id), `${label}: id is unique`)
  ids.add(app.id)

  for (const key of ['borrower_name', 'segment', 'loan_amount', 'tenure_months', 'created_at']) {
    check(app[key] != null, `${label}: has ${key}`)
  }
  check(
    Boolean(POLICY.segments[app.segment]),
    `${label}: segment "${app.segment}" is defined in policy`
  )
  check(app.loan_amount > 0, `${label}: loan amount is positive`)
  check(app.tenure_months > 0, `${label}: tenure is positive`)
  check(Boolean(app.scenario), `${label}: fixture says what it demonstrates`)

  const types = new Set(app.documents.map((d) => d.type))
  for (const required of REQUIRED_DOCS) {
    check(types.has(required), `${label}: has the required ${required}`)
  }

  const docIds = new Set()
  for (const doc of app.documents) {
    const dl = `${label}/${doc.type}`
    check(Boolean(doc.id), `${dl}: document has an id`)
    check(!docIds.has(doc.id), `${dl}: document id is unique`)
    docIds.add(doc.id)
    check(Boolean(doc.filename), `${dl}: document has a filename`)
    check(doc.pages > 0, `${dl}: document has pages`)
    check(
      Object.values(DOC_TYPES).includes(doc.type),
      `${dl}: "${doc.type}" is a known document type`
    )

    // Every field the schema expects from this document type must either be
    // present in the payload or be genuinely optional — a typo in a fixture key
    // is otherwise invisible until a metric quietly reads zero.
    const expected = EVIDENCE_SPEC.filter((s) => s.doc === doc.type)
    const found = expected.filter((s) => getPath(doc.payload, s.path) != null)
    check(
      found.length > 0,
      `${dl}: payload yields at least one schema field (key typo?)`
    )

    // And nothing in the payload may be a field the schema has never heard of.
    for (const [group, body] of Object.entries(doc.payload || {})) {
      if (body == null || typeof body !== 'object') continue
      for (const key of Object.keys(body)) {
        if (key.startsWith('_')) continue
        check(
          `${group}.${key}` in SPEC_BY_PATH,
          `${dl}: payload key "${group}.${key}" is not in the evidence schema`
        )
      }
    }
  }

  // An informant reference must be internally answerable before it is scored.
  const ref = app.documents.find((d) => d.type === DOC_TYPES.INFORMANT_REFERENCE)
  if (ref) {
    const inf = ref.payload.informant
    check(Boolean(inf.name), `${label}: informant is named`)
    check(Boolean(inf.relationship), `${label}: informant states a relationship`)
    check(inf.months_known != null, `${label}: informant states how long they have known the borrower`)
    check(
      inf.current_outstanding != null && inf.principal_lent != null,
      `${label}: informant states principal and outstanding`
    )
  }
}

console.log(`${checks - failures}/${checks} data checks passed`)
if (failures) {
  console.error(`\n${failures} FAILED:`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
