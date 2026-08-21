# INDEX.md — the map

Compressed context for future sessions (human or LLM). Reading order:
this file → `README.md` for user-facing behavior → source only as needed.
Read `coach/diagnosis.md` in full only when revising coaching content.

**Status (2026-08-21):** working. Field report 1 validated the product
(owner: "helped me see the win condition") and exposed the mouse-freeze
incident (fixed). Field report 2 (a 27/3/3 stomp): "repeat overloaded
advice" — every profile directive was recited in every plan; fixed by the
rubric's say-it-once contract (#5, decision log). Owner is A/B testing
models — plans.jsonl now records model + ms per plan.

## Map

```
src/
  main.ts                Electron main: overlay window, hotkeys, game mode wiring
  preload.ts             contextBridge: sc-event / sc-ui channels (renderer is sandboxed)
  types.ts               ShotcallerEvent union + LCU payload shapes + GameResult
  planner/
    state.ts             THE state machine: when stages fire, sides, hints, gate — all timing lives here
    prompt.ts            cache-stable RUBRIC (FOCUS + say-it-once personalization contract) + per-game message builders
    claude.ts            streaming planner (opus-5 default, effort low, refusal fallback,
                         1h-TTL cached rubric) + DryRunPlanner twin + profile injection
  coach/
    profile.ts           CoachProfile type, loader, prompt-block formatter
    gate.ts              SessionGate: 2 ranked L → closed; rough game → 15min cooldown; W reopens
    history.ts           post-game archive (raw EOG + derived header, gameId-deduped) + plan log appender
  lcu/
    connector.ts         league-connect wiring: WS subscriptions, roster/EOG retries, reconnect loop
    eog.ts               defensive parser for /lol-end-of-game/v1/eog-stats-block
    mock.ts              fixture replayer (start:mock, simulate, CI)
  liveclient/poller.ts   game clock from https://127.0.0.1:2999 (official API), drives section highlight
  system/
    boost.ts             game-mode kill list: planBoost (pure) + taskkill exec; NEVER_KILL guard
    league.ts            Riot Client discovery + League auto-launch
    housekeeping.ts      pure zero-upkeep logic: position clamp, games-since-profile counter, nudge texts
  overlay/               plain HTML/CSS/JS renderer, no build step; ?demo=1 self-drives
  simulate.ts            headless end-to-end smoke (runs in CI)
coach/
  profile.json           machine profile the planner injects (leaks, directives, pool plan)
  diagnosis.md           the full human-readable hardstuck diagnosis
  notes.md               owner's replay self-review journal (dated entries; regen input, n=1 each)
  history/               git-ignored, grows as the owner plays: games.jsonl (raw EOG
                         per finished game) + plans.jsonl (every plan + model + ms)
fixtures/                recorded LCU shapes + ddragon slim + EOG block (tests/mock)
test/                    68 vitest tests: state timing, prompts, gate, boost, ddragon, coach, housekeeping, history
scripts/install-shortcuts.ps1   Desktop/Startup shortcuts (npm run shortcut[:startup])
boost.json               user-reviewed kill list (enabled:false until owner opts in)
.github/workflows/ci.yml typecheck + tests + build + simulate (no Electron binary)
```

## How it works (one screen)

```
League client ──lockfile/WSS──▶ LcuConnector ──▶ Shotcaller (state machine) ──events──▶ overlay
   phases: ChampSelect → GameStart → InProgress → EndOfGame
   ChampSelect: myTeam/bans stream in → lobby chips + pick hints;
                all 5 locked (FINALIZATION) → STAGE 1 ally brief (Claude, streamed)
   GameStart:   gameflow session reveals both rosters (enemy picks are hidden in
                ranked until now — this IS the design window) → STAGE 2 full plan;
                stage 1 aborted if streaming, its partial (≥200 chars) fed forward
   InProgress:  clock poll (5s) → active section highlight; auto-compact at 1:30
   EndOfGame:   EOG stats → archive (coach/history) + SessionGate → red banner if stop-loss trips
Timing: plan first-token ~1-2s into loading screen, complete ~10-15s (30-60s available).
```

Key mechanics: two-stage planning shares one ≥1024-token rubric behind a
1h-TTL cache breakpoint (stage 1 warms it ~1min before the critical call);
side detection = summonerId/puuid in either roster, champ-select overlap
fallback; `PLAYER PROFILE` block goes in the (uncached) user message.

## The player (compressed diagnosis — full text: coach/diagnosis.md)

NoRights4Laners#512, NA, 100% jungle. Arc: six years mid-Silver (one Gold 3
excursion 2023), season 48%/62g = statistically exact maintenance. Verdict:
**accurately rated; leaks are process, not mechanics.** Five verified leaks,
by LP impact: (1) kill-hoarding — 45% KP, 8.7K/5.4A, emblem 17/5/0 loss;
(2) zero control wards all season (trinkets fine); (3) 5.8 deaths/game on
shutdown-carrying Qiyana; (4) tilt-queueing, directly evidenced — 36 LP
round-trip in 2 days; (5) all-assassin pool + strong early (+755 gold@15,
laning 76 vs 55) that doesn't convert in the 15-25min window.
**Explicit NON-problems:** farming/clears (7.0 cs/min — strong), the loss
streak itself (63% of even players hit a 5+ streak/season), all n≤9
champion/matchup winrates (noise — never argue picks from them).
**Pool plan (owner-agreed 2026-08-20):** Qiyana default; Zac when comp
lacks frontline or Qiyana unavailable; Zac judged on a pre-committed
15-game block by process stats, never W-L. Gate rules encode leak #4.

## Regenerating the diagnosis (when: ~30+ new games, or on request)

**Primary source first (since #4): `coach/history/games.jsonl`** on the
gaming PC — one line per finished game with the raw LCU EOG block plus a
derived header (win, K/D/A, KP, control wards, cs, vision, gold). Ground
truth, all queues, no scraping — but only games Shotcaller was running
for, and no timeline stats (gold@15 etc.). Use the scrapes below to
backfill gaps and for anything per-minute. Also read `coach/notes.md` —
the owner's replay self-review journal: decision-quality observations the
stats can't see. Self-reported and n=1 per entry, so treat them as
hypotheses for the verification pass, not conclusions.

Sources that actually work from an agent environment (2026-08):
- **op.gg**: server-rendered — profile page + `/champions` `/matches`
  `/mastery` tabs parse via plain fetch; JSON-LD + RSC flight payload in
  the HTML carries season champion table, recent matches, season history.
  Mirror `fortnite.op.gg` serves identical SSR if the main host balks.
- **DeepLoL backend**: `b2c-api-cdn.deeplol.gg` (endpoints discoverable in
  www.deeplol.gg JS bundle) — role split, per-match durations/AI-scores,
  gold@15, LP timeline. Champion ids → names via Data Dragon.
- **Blocked** (Cloudflare/403, don't burn time): leagueofgraphs, u.gg,
  porofessor, mobalytics, tracker.gg.
Method that held up: multi-lens analysis (pool / early / macro / mental /
statistical-reality) → adversarial verification that recomputes every
number (it killed "drop Rengar/Kindred" as small-sample noise and the
"declining player" narrative) → synthesis into diagnosis.md + profile.json.
Discipline: only 60-game means and the multi-season arc are load-bearing;
n≤9 splits prove nothing; post-hoc streaks are normal variance.

## Decision log

- **Legality stance**: LCU (tolerated; register before public release) +
  Live Client Data (official) + Data Dragon; no memory/injection/automation;
  no live "draws conclusions for you" features (Riot's Mar-2025 line).
  Sources linked in README.
- **Models**: `claude-opus-5` default, `effort: low`, refusal fallback
  (opus-4-8) wired for opus-5/fable-5; haiku-4-5 documented as fast/cheap;
  `SHOTCALLER_MODEL=claude-fable-5` supported — owner A/B pending (compare
  FOCUS quality + `ms=` console log).
- **Two-stage planning** because ranked hides enemy picks until loading;
  stage 1 also pre-warms the prompt cache.
- **Boost = explicit list** (no heuristic), graceful-first, NEVER_KILL
  guard, disabled until reviewed: unsaved-work + Vanguard safety.
- **Gate = advisory only**: queue automation is both against Riot rules
  and the wrong product (restart-to-override is the deliberate pause).
- **Auto-compact at 1:30** rather than trimming plan content (owner liked
  the content, wanted less on screen mid-game).
- **Zero-thought ops (#4)**: the desktop icon hands game mode to an
  already-running instance (second-instance + lock additionalData — before
  this, a second launch silently died and boost/launch never ran); overlay
  position persists with an on-screen clamp; update + profile-age nudges
  are passive overlay notes, hidden while planning/live. Updates are never
  auto-applied (a half-applied pull pre-queue is the worst timing) and the
  profile is never auto-edited — the nudge points at the regen protocol
  above. boost.json is re-read per trigger; mock replays never bump the
  games counter.
- **Post-game archive (#4)**: the raw EOG block is stored untouched (the
  payload drifts across client versions and regens recompute every number
  adversarially — curating fields would silently discard evidence), plus a
  derived header that omits anything it can't state confidently (KP only
  when every teammate's kills are present). JSONL append-only, deduped by
  gameId against the file tail (reconnects on the EOG screen re-read the
  same block), archives all queues (normals are tilt evidence), skips
  exactly what parseEogStats rejects, and is best-effort: an archive
  failure logs and never touches the gate or pipeline. Enables the
  roadmap's real "bottom-3 of lobby" gate rule later — NOT wired into the
  gate now; changing the owner's stop-loss triggers needs the owner.
- **Say-it-once personalization (#5)** — field report 2026-08-20 (27/3/3
  stomp, overlay turned off at ~5min): plans were "repeat overloaded".
  Root cause: five profile planDirectives each read "every plan must…" and
  the rubric said to weave directives into every section they touch — so
  each plan recited all five AND FOCUS restated them, near-identically
  every game. Fixed at the consumption layer (rubric), not by editing the
  profile (profile edits are guarded): budgets are hard caps that beat
  directives; each directive at most once, as matchup detail; untriggered
  directives omitted; session-state directives ignored in-plan (the live
  gate owns session state — the model was opening plans with stop-loss
  boilerplate it cannot know). Companions: Ctrl+Alt+H hides the overlay
  while the pipeline keeps running (quitting the app mid-game was losing
  EOG → gate + archive; auto-reshows at next champ select, showInactive
  only — never focus); plans.jsonl gives plan-quality complaints and the
  model A/B receipts. Rubric edits invalidate the prompt cache once per
  deploy (1h TTL) — fine; keep it ≥ ~1024 tokens (prompt.test.ts floor).
- **Hotkeys must be observable (#5)** — same field report: "tried to
  compact it and it didn't work", undiagnosable because both failure modes
  were invisible: registration can fail silently (register() returns false
  when another app owns the combo — was never checked), and Ctrl+Alt+K is
  a toggle, so after auto-compact (1:30) pressing "compact" EXPANDS —
  reads as broken. Now: every registration failure is an overlay note
  naming the .env override, every fire logs to console, and the footer
  names the current state (FULL PLAN/COMPACT/Interactive) and pulses on
  each press — "footer didn't flash" now cleanly means "key never arrived".
- Repo layout: overlay is buildless on purpose; CJS output for
  league-connect interop; fixtures + mock + simulate exist so everything
  verifies without League or an API key (CI does exactly that).

## Incident log

- **2026-08-20 — system-wide mouse freeze mid-game (power-off required).**
  Cause: `setIgnoreMouseEvents(true, { forward: true })` installs a global
  WH_MOUSE_LL hook; game starved the Electron process; hook stalled the OS
  cursor; detached electron.exe outlived the console. Fix (PR #3): no
  forwarding (hover never needed), `focusable:false` + `type:"toolbar"`
  (no focus steal, no Alt+Tab), 20s interactive auto-revert, panic hotkey
  Ctrl+Alt+Shift+Q. Do not regress any of these.

## PR history

1. **#1** scaffold: connector, two-stage planner, overlay, mock/demo/simulate,
   CI; + coach profile integration; + diagnosis shipped; + game mode; + gate
   and pick hints (merged 2026-08-20).
2. **#2** demo-mode fix: demo keyed on `?demo=1`, not bridge absence (merged).
3. **#3** mouse-safety overhaul + auto-compact + `ms=` logging + these docs.
4. **#4** zero-thought ops: second-instance game-mode handoff, overlay
   position memory, update + profile-age nudges, `npm run update`,
   post-game EOG archive → coach/history/games.jsonl.
5. **#5** say-it-once personalization contract (fix for "repeat overloaded"
   plans), hide-overlay hotkey (Ctrl+Alt+H — pipeline keeps running),
   plan log → coach/history/plans.jsonl.
6. **#6** coach/notes.md — owner's replay self-review journal (first
   entry: the 27/3/3 comeback review), wired into the regen protocol.

## Verifying changes

- Always: `npm run typecheck && npm test && npm run build && node dist/simulate.js`.
- Overlay CSS/JS quickly: headless Chromium screenshot of
  `src/overlay/overlay.html?demo=1` (exact-viewport via playwright-core).
- Electron behavior (IPC, windowing, demo/mock): drive the real app with
  playwright-core `_electron.launch` under `xvfb-run`, args
  `['.', '--no-sandbox', '--mock', '--dry-run']`, then `firstWindow()` →
  evaluate/screenshot. This catches what browser tests can't (PR #2's bug).
- Real-planner prompt iteration without Electron:
  `SHOTCALLER_SIMULATE_LIVE=1 node dist/simulate.js` (needs API key).

## Roadmap (unstarted)

- Profile refresh consuming coach/history/games.jsonl (the archive ships
  in #4; the regen protocol above already points at it). The archive also
  makes a real "bottom-3 of lobby" gate rule computable — needs the owner
  to agree on the placement metric before wiring it into the gate.
- Backfill history from the LCU match-history endpoint (games played while
  Shotcaller was off).
- Riot Web API scouting of the other nine players (dev-key friction noted).
- Installer packaging (electron-builder); optional patch-notes feed into
  the rubric.
