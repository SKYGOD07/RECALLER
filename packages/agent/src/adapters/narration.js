/**
 * RECALLER — narration stylist for `narrate(memo, { stylist })`.
 *
 * The model receives one finished paragraph of the credit memo and returns it
 * reworded. It holds no authority: packages/narration already discards any
 * rewrite whose numeric tokens moved, and falls back to the deterministic text
 * if this function throws.
 */

const INSTRUCTIONS =
  'Rewrite the credit-memo paragraph you are given for a credit committee: clear, formal and concise. ' +
  'Keep every number, amount, percentage and code exactly as written. Add no facts. Reply with the paragraph only.';

export function createNarrationStylist({ model, skillPrompt = '' }) {
  if (typeof model !== 'function') throw new TypeError('createNarrationStylist needs a model function.');
  return async (text) => {
    const reply = await model({
      system: [skillPrompt.trim(), INSTRUCTIONS].filter(Boolean).join('\n\n'),
      messages: [{ role: 'user', content: String(text) }],
      tools: [],
    });
    const out = String(reply?.content ?? '').trim();
    if (!out) throw new Error('The stylist returned an empty rewrite.');
    return out;
  };
}
