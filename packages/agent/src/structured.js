/**
 * RECALLER agent runtime — validated structured output.
 *
 * The pattern from the Hermes `instructor` skill (MIT), ported from
 * Python/Pydantic to dependency-free JavaScript: state the schema up front,
 * parse the reply, validate it, and on failure send the errors back for a
 * bounded number of corrections.
 *
 * Validation constrains shape and range. It cannot make a value true: a
 * well-formed number can still be wrong. Truth comes from grounding (see
 * adapters/extraction.js), reconciliation and the confidence gate.
 *
 * Supported JSON Schema subset: type (incl. arrays of types), enum, required,
 * properties, additionalProperties: false, items, minItems/maxItems,
 * minimum/maximum, minLength/maxLength, pattern.
 */

export function validate(schema, value, path = '$') {
  const errors = [];
  walk(schema, value, path, errors);
  return errors;
}

function walk(s, v, p, errors) {
  if (!s || typeof s !== 'object') return;

  if (s.enum && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(v))) {
    errors.push(`${p}: must be one of ${JSON.stringify(s.enum)}`);
  }
  if (s.type) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t) => isType(t, v))) {
      errors.push(`${p}: expected ${types.join(' | ')}, got ${typeName(v)}`);
      return;
    }
  }
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) errors.push(`${p}: must be ≥ ${s.minimum}`);
    if (s.maximum !== undefined && v > s.maximum) errors.push(`${p}: must be ≤ ${s.maximum}`);
  }
  if (typeof v === 'string') {
    if (s.minLength !== undefined && v.length < s.minLength) errors.push(`${p}: must be at least ${s.minLength} characters`);
    if (s.maxLength !== undefined && v.length > s.maxLength) errors.push(`${p}: must be at most ${s.maxLength} characters`);
    if (s.pattern && !new RegExp(s.pattern).test(v)) errors.push(`${p}: must match /${s.pattern}/`);
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) errors.push(`${p}: needs at least ${s.minItems} items`);
    if (s.maxItems !== undefined && v.length > s.maxItems) errors.push(`${p}: allows at most ${s.maxItems} items`);
    if (s.items) v.forEach((item, i) => walk(s.items, item, `${p}[${i}]`, errors));
  }
  if (isPlainObject(v)) {
    (s.required ?? []).forEach((k) => {
      if (!(k in v)) errors.push(`${p}.${k}: is required`);
    });
    Object.entries(s.properties ?? {}).forEach(([k, sub]) => {
      if (k in v) walk(sub, v[k], `${p}.${k}`, errors);
    });
    if (s.additionalProperties === false) {
      Object.keys(v)
        .filter((k) => !(k in (s.properties ?? {})))
        .forEach((k) => errors.push(`${p}.${k}: is not allowed`));
    }
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isType(t, v) {
  switch (t) {
    case 'string':
      return typeof v === 'string';
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    case 'integer':
      return Number.isInteger(v);
    case 'boolean':
      return typeof v === 'boolean';
    case 'array':
      return Array.isArray(v);
    case 'object':
      return isPlainObject(v);
    case 'null':
      return v === null;
    default:
      return true;
  }
}

function typeName(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/** Pull a JSON value out of a model reply, tolerating ``` fences and surrounding prose. */
export function parseJsonReply(text) {
  const raw = String(text ?? '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : raw;
  const start = body.search(/[[{]/);
  if (start === -1) return { ok: false, error: 'no JSON object or array found' };
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
  try {
    return { ok: true, value: JSON.parse(body.slice(start, end + 1)) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Parse and validate in one step: `{ valid, value, errors }`. */
export function checkSchema(text, schema) {
  const parsed = parseJsonReply(text);
  if (!parsed.ok) return { valid: false, value: undefined, errors: [`not valid JSON: ${parsed.error}`] };
  const errors = validate(schema, parsed.value);
  return { valid: errors.length === 0, value: parsed.value, errors };
}

/**
 * Ask for JSON matching `schema`; retry with the validation errors up to
 * `maxRetries` times. Resolves `{ ok: true, value, attempts }` or `{ ok: false, errors, attempts }`.
 */
export async function generateStructured({ model, system = '', prompt, schema, maxRetries = 2 }) {
  const messages = [
    { role: 'user', content: `${prompt}\n\nReply with only JSON matching this schema:\n${JSON.stringify(schema)}` },
  ];
  let errors = [];
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    const reply = await model({ system, messages, tools: [] });
    const text = reply?.content ?? '';
    const check = checkSchema(text, schema);
    if (check.valid) return { ok: true, value: check.value, attempts: attempt };
    errors = check.errors;
    messages.push(
      { role: 'assistant', content: text },
      { role: 'user', content: `That reply failed validation:\n- ${errors.join('\n- ')}\nReturn the corrected JSON only.` },
    );
  }
  return { ok: false, errors, attempts: maxRetries + 1 };
}
