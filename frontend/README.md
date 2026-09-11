# RECALLER — site and loan officer console

One app, two modes on one origin:

- **`/`** — the landing page. Cinematic, editorial, presentation data only.
- **`/console`** — the loan officer console. Real underwriting against the real
  RECALLER domain packages or the RECALLER backend.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static output in dist/
npm run lint     # oxlint
```

## Where the numbers come from

The console performs **no credit arithmetic**. It does not compute EMI, FOIR,
LTV, eligibility or any verdict, and it evaluates no policy rule. Every figure
on screen arrived already computed from one of two transports, both of which
return the identical response shape:

| Transport | When | What it is |
| --- | --- | --- |
| `engine` | default | The deterministic packages (`packages/*`) executed in the browser. Offline, installable, no server. |
| `http` | `VITE_RECALLER_API` is set | The RECALLER FastAPI backend. |

`engine` is the demo / mock mode, and it is deliberately **not** a parallel mock
schema: it calls the same orchestrator, credit engine and `policy/policy.v1.json`
the backend calls, so a record produced in the browser is the record the server
would have produced — same reason codes, same hashes, same ledger.

A build configured for `http` that cannot reach its backend degrades to `engine`
and says so in the console top bar (`Runtime online · In-process engine ·
fallback`). Set `VITE_RECALLER_STRICT=true` to make that a hard failure instead.
See `.env.example`.

Engine mode persists **intent**, not output: which files were processed and what
the officer resolved. On reload the pipeline is re-run from that intent, which is
safe precisely because it is deterministic — the rehydrated record is identical.

## Evidence strength

`src/sections/Strength.jsx` and `src/components/decision/EvidenceStrength.jsx`
render `record.evidence_strength` — RECALLER's own 0–100 measure of how much of a
file is actually known, produced by `computeEvidenceStrength()` in
`packages/credit-engine`. The landing section animates the four components
arriving in the order the engine evaluates them; **the animation controls when a
number is revealed, never what it is**, and every bar's resting state is its true
proportion so a tab that never animates still tells the truth.

## Structure

```
src/
  api/                 the only place that knows where data comes from
    config.js          transport selection from env
    http.js            FastAPI backend (bootstrap, SSE run progress, replay, what-if)
    engine.js          deterministic packages in-browser + localStorage rehydration
    index.js           facade + degrade logic + amendPolicy
  store/console.js     queue, open file, what is running (useSyncExternalStore)
  store/toasts.js      notifications
  hooks/console.js     useConsole / useBootedConsole / useApplicationDetail
  lib/router.jsx       history router (/, /console, /console/application/:id/:tab)
  lib/format.js        display formatting only — inr, pct, fingerprint, dates
  components/
    common/            Tag, Metric, LimitBar, Panel, states, toasts
    layout/            ConsoleShell (top bar, workspace rail, system health)
    applications/      the queue
    decision/          decision hero, deterministic compute, policy ledger, memo
    evidence/          fields by source with confidence and citations
    reconciliation/    cross-document findings
    whatif/            solver levers + engine-evaluated scenario sandbox
    assist/            held fields, officer resolution, resume
    audit/             fingerprint, policy amendment replay, execution trace
  pages/               LandingPage, ConsolePage, ApplicationPage
  sections/            landing sections (one component + one stylesheet each)
  styles/console.css   console design system
  index.css            shared tokens and landing primitives
```

## Things to know

- **Class names.** The landing and the console share one global stylesheet
  bundle. Console-side classes that would otherwise collide with landing ones
  (`stage`, `kv`, `slider`, `docs`, `ledger`, `console`) carry an `rc-` prefix.
  Keep it that way when adding rules.
- **Demo order.** `RCL-2026-0418` approves cleanly · `RCL-2026-0421` suspends at
  the confidence gate for Assist · `RCL-2026-0433` declines on four blocking
  reconciliation findings · `RCL-2026-0437` refers, and What-if finds the
  ₹4,500 reduction that approves it.
- **Aliases.** `vite.config.js` maps `@core`, `@orchestrator`, `@policy`,
  `@synthetic` and friends straight into the monorepo, so there is exactly one
  implementation of the credit engine in the repository.
- **Motion** respects `prefers-reduced-motion`; landing demos jump to their
  final state.
