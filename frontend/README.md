# RECALLER — presentation site

The public product-launch website for RECALLER. It is a **presentation only**: every applicant,
document, figure and workflow run on the page is illustrative, scripted data. Nothing here
underwrites, calculates, or talks to a backend or n8n.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static output in dist/
npm run lint     # oxlint
```

## Structure

```
src/
  index.css            design tokens (colour, type, spacing) + shared primitives (buttons, pills, panels)
  App.jsx              section order
  animations/          easing (motion.js) and hooks (useMediaQuery, useSequence)
  components/          Nav, RevealLines/FadeIn, Counter/Scramble, ui (Button, Status, Logo, icons)
  data/case.js         the one illustrative applicant every section draws from
  data/site.js         download link, GitHub URL, nav links
  sections/            one component + one stylesheet per section, in page order
```

Story order: Hero → 01 Borrower → 02 Idea → 03 Agents → 04 Deterministic credit →
05 Reconciliation → 06 Human + AI → 07 Policy → 08 Decision → 09 Audit → 10 What-if →
11 Console → 12 Orchestration → 13 Download.

## Things to know

- **Download button.** `data/site.js` points it at `/downloads/RECALLER-Setup-0.1.0-x64.exe`.
  Put the installer in `public/downloads/` under that name (or change the path) — until then the
  link 404s. Version / platform / package labels live in the same file.
- **Consistent numbers.** All figures come from one case in `data/case.js` (₹1,00,000 over 36
  months at 14% → EMI ₹3,417.76, FOIR 38.14%, LTV 80.65%; the requested 24-month version is
  FOIR 45.66%). If you change the case, recompute and update the hard-coded copies in the
  section files too (search for the old value).
- **Scroll-linked opacity** must use `lerpRange` from `animations/motion.js` rather than an
  array mapping; framer-motion otherwise hands it to a native ScrollTimeline, which mis-mapped
  sticky-section offsets in testing.
- **Motion** respects `prefers-reduced-motion` (MotionConfig + CSS); scripted demos jump to
  their final state.
- Fonts are self-hosted via Fontsource: Space Grotesk (display), Inter Tight (body),
  JetBrains Mono (technical).
