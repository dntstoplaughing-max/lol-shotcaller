# CLAUDE.md — lol-shotcaller

**`INDEX.md` is the map — read it before changing anything.** It compresses
the architecture, invariants, decision + incident log, the player's verified
coaching diagnosis, and the profile-regeneration protocol. Prefer it over
re-deriving context from source or re-researching.

## What this is

Windows Electron app ("Shotcaller"): reads champ select and the loading
screen from the local LCU API, streams a two-stage Claude game plan into a
transparent click-through overlay, personalized by `coach/profile.json` —
the owner's adversarially-verified leak diagnosis.

## Invariants (each one broke, or would break, the real world)

- **Read-only integration**: LCU + Live Client Data + Data Dragon only.
  Never automate inputs, read game memory, or add live "do X now" trackers
  — that's Riot's ban line (README "Is this allowed?").
- **Never** reintroduce `{ forward: true }` on `setIgnoreMouseEvents`, a
  focusable overlay window, or `focus()` calls — a global mouse hook froze
  the owner's OS cursor mid-game once (INDEX: incident log).
- `RUBRIC` in `src/planner/prompt.ts` is cache-stable: volatile content
  goes in user messages only; keep the rubric ≥ ~1024 tokens or the prompt
  cache silently stops engaging.
- Stage 2 must fit the loading screen: streaming, `effort: low` default,
  warm cache. Add nothing blocking before first token.
- `boost.json` stays an explicit user-reviewed kill list guarded by
  `NEVER_KILL`; no "close unnecessary processes" heuristics, ever.
- The session gate stays advisory UI (never blocks/declines queues).
- `coach/profile.json` + `coach/diagnosis.md` claims are evidence-backed;
  don't edit conclusions without new data — regenerate per INDEX instead.

## Verify before pushing

`npm run typecheck && npm test && npm run build && node dist/simulate.js`
(CI runs exactly this.) Overlay or Electron-behavior changes additionally
need the real-Electron check — INDEX "Verifying changes".

## Conventions

- The user IS the player in the profile (NoRights4Laners#512, jungle).
- Tasks/follow-ups for David live only in the `davis davis davis davis`
  repo (mullins-academia) — a TODO here will never be seen; never add an
  item there unasked.
