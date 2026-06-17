/**
 * vowRules.ts — Vow Mode constants: hold duration and the seven rules.
 * Imported by VowActivationModal (display) and potentially by other vow UI.
 */

/** Milliseconds the user must hold the commit button to activate a vow. */
export const VOW_HOLD_MS = 3000

/** The seven rules of a vow. Displayed in full during activation. */
export const VOW_RULES: { title: string; body: string }[] = [
  {
    title: 'One vow at a time.',
    body: 'While it stands, nothing else exists.',
  },
  {
    title: 'A vow is sworn on a written finish line.',
    body: "You write what 'done means' before it starts — and only meeting it ends the vow well.",
  },
  {
    title: 'The vow does not sleep.',
    body: 'It survives breaks, app restarts, and nights. Until the criteria are met, you are under it.',
  },
  {
    title: 'Everything else is a thought to park.',
    body: 'Urges and ideas get written down into the vow box — not followed.',
  },
  {
    title: 'Leaving is allowed, but never silent.',
    body: 'Every override and every break requires a written reason. It is logged, not judged.',
  },
  {
    title: 'No shame, full honesty.',
    body: 'Your kept count is displayed with pride; breaks are recorded quietly in the log.',
  },
  {
    title: 'Done means done.',
    body: 'Confirm the criteria, take the release, write one line about how the resistance broke.',
  },
]
