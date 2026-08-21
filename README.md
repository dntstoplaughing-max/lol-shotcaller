# Shotcaller

League of Legends lobby scanner + AI game-plan overlay.

Shotcaller watches your League client, reads champ select and the loading
screen through Riot's local APIs, and streams a Claude-generated game plan
into a transparent always-on-top overlay — win condition, lane plan, threat
list with power spikes, item pivots, and phase-by-phase macro that follows
the game clock.

<p>
  <img src="docs/overlay-demo.png" width="49%" alt="Overlay: full plan view during a live game" />
  <img src="docs/overlay-compact.png" width="49%" alt="Overlay: compact mode — win condition plus the section the clock points at" />
</p>

## Why it's fast enough

The historic failure mode for tools like this is trying to OCR the screen or
scrape the web after picks lock. Shotcaller doesn't:

| Moment | What happens | Latency |
| --- | --- | --- |
| Champ select | LCU WebSocket pushes every pick/ban; overlay shows your lobby live | ~0 |
| All five allies lock | **Stage 1**: ally-side brief starts streaming (comp identity, your job) | seconds |
| Loading screen starts | LCU gameflow session reveals all ten champions | ~100 ms |
| +1–2 s | **Stage 2**: full plan streams into the overlay, token by token | first words |
| +10–15 s | Complete plan rendered | done |

In ranked, enemy picks are hidden until the loading screen *by design* — so
the loading screen (30–60 s) plus the 1:05 before minions spawn is the real
window, and the plan lands with most of it to spare. Both stages share a
prompt-cached coaching rubric (1 h TTL), so the time-critical call starts
from a warm cache.

## Quick start (Windows, on your gaming PC)

```
git clone <this repo> && cd lol-shotcaller
npm install
copy .env.example .env    # then put your ANTHROPIC_API_KEY in .env
npm start
```

- Get an API key at <https://console.anthropic.com>. A full game plan costs
  on the order of a few cents (default model `claude-opus-5`; see tuning).
- **League must run in Borderless (or Windowed) display mode** — true
  Fullscreen hides every overlay, Discord's included.
- Start Shotcaller whenever; it waits for the League client, reconnects if
  the client restarts, and picks up mid-game if you launch it late.

### Hotkeys

| Keys | Action |
| --- | --- |
| `Ctrl+Alt+O` | Toggle mouse interaction (overlay is click-through by default; interactive mode lets you scroll/drag it, and auto-locks back to click-through after ~20s) |
| `Ctrl+Alt+K` | Compact mode: win condition + FOCUS + the section the game clock points at |
| `Ctrl+Alt+H` | Hide/show the overlay. **Use this instead of quitting when you're done reading** — the app keeps running invisibly, so the end-of-game stats still reach the session gate and the archive. It reappears on its own at the next champ select |
| `Ctrl+Alt+Shift+Q` | Panic quit — kills the whole app instantly |

Override with `SHOTCALLER_HOTKEY_MOUSE` / `SHOTCALLER_HOTKEY_COLLAPSE` /
`SHOTCALLER_HOTKEY_HIDE` / `SHOTCALLER_HOTKEY_QUIT` in `.env`.

**Every hotkey press is acknowledged**: the overlay footer names the current
state (FULL PLAN / COMPACT / Interactive) and flashes on each press — note
that `Ctrl+Alt+K` is a toggle, so if auto-compact already collapsed the
overlay, pressing it *expands*. If the footer doesn't react at all, the key
never reached Shotcaller (see Troubleshooting). If a hotkey can't be
registered at startup (another app owns the combo), the overlay says so in
a note instead of failing silently.

**Mouse safety, by construction:** the overlay never installs a mouse hook
(no `forward: true` — a starved global hook is how overlays freeze the OS
cursor mid-game), never takes keyboard focus (the game keeps focus even
while you scroll the overlay), is invisible to Alt+Tab, and interactive
mode reverts to click-through on its own (`SHOTCALLER_INTERACTIVE_TIMEOUT_S`,
0 to disable). If anything ever looks stuck anyway: `Ctrl+Alt+Shift+Q`, or
`Ctrl+Alt+Del` → Task Manager (arrow keys + Enter work without a mouse) →
end `electron.exe`.

The overlay shows the full plan through the loading screen, then
**auto-compacts at 1:30** (when lanes meet) to the win condition + FOCUS +
current section. `Ctrl+Alt+K` re-expands; a manual toggle disables
auto-compact for that game.

The overlay **remembers where you drag it** and comes back there next
launch. If your monitor layout changed and that spot no longer exists, it
snaps back to the default corner instead of stranding itself off-screen.

### Tuning

| Env var | Default | Notes |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | Required for real plans; without it you get canned dry-run text |
| `SHOTCALLER_MODEL` | `claude-opus-5` | `claude-fable-5` for the strongest reasoning (premium tier, works out of the box incl. refusal fallback); `claude-haiku-4-5` for cheap/fast ~5s plans. The console logs `ms=` per call for A/B comparisons |
| `SHOTCALLER_EFFORT` | `low` | `low`/`medium`/`high` — reasoning depth vs. latency |
| `SHOTCALLER_MAX_PLAN_TOKENS` | `4000` | Response cap for the stage-2 call |
| `SHOTCALLER_UPDATE_CHECK` | on | `off` disables the background "update available" note |

## Game mode — one icon, zero thinking

```
npm run shortcut            # puts "Shotcaller" on your Desktop
npm run shortcut:startup    # optional: also start (idle) at login
```

Double-clicking the Desktop shortcut runs the whole pre-game routine:

1. **Boost** — closes the background apps listed in `boost.json`
   (disabled until you review the list and set `"enabled": true` — a
   one-time decision). Launchers, music, and sync clients are pre-filled.
2. **Launches League** via the Riot Client if it isn't already running
   (path auto-detected; override with `SHOTCALLER_RIOT_CLIENT` in `.env`).
3. **Starts the overlay**, which waits for champ select as usual.

Boost safety rules (deliberate, and not configurable):

- Only processes **named in `boost.json`** are ever touched. There is no
  "close everything unnecessary" heuristic — software can't know which
  process holds your unsaved work, so you name the list once instead.
- A hard-coded never-kill guard protects Windows system processes,
  everything Riot/Vanguard, and Shotcaller's own runtime, even if listed.
- Graceful close by default (apps can prompt to save). Add `"force": true`
  per entry only if you accept losing that app's unsaved state.
- `"trigger": "gamestart"` defers the boost to the loading screen instead
  of shortcut launch (e.g. keep Spotify through queue, drop it for the game).
- Preview without touching anything: `npm start -- --game-mode --boost-dry-run`.

The Startup-folder variant starts the overlay **without** boost or
auto-launch — it just waits quietly for League after login.

The two shortcuts compose: **the Desktop icon works whether or not
Shotcaller is already running.** If the Startup copy is idling, a second
launch hands the game-mode routine (boost + League launch) to the running
overlay instead of dying against the single-instance lock — and
`boost.json` is re-read on every trigger, so list edits apply without a
restart. One icon, valid in every state.

### Zero upkeep

Between games, Shotcaller keeps track of its own chores and tells you —
quietly, in the overlay footer area, and only when nothing is happening
(never during planning, a live game, or compact mode):

- **Updates** — it checks its git checkout in the background (off the
  launch path) and shows a note when `npm run update` has something to
  apply. It never pulls on its own: a half-applied update right before a
  queue is the worst possible timing, so applying stays your call.
  Disable the check with `SHOTCALLER_UPDATE_CHECK=off`.
- **Coach profile age** — it counts your finished games and, once the
  profile is ~30 games old, notes that a regeneration is due (the profile
  describes *you*, and you change). Regenerating resets the count
  automatically.
- **Post-game archive** — every finished game's end-of-game stats are
  saved to `coach/history/games.jsonl` on their own (see below), so the
  evidence for the next profile regeneration accumulates while you play.
- **Champion data** — already zero-touch: re-synced per patch from Data
  Dragon, cached on disk, tolerant of being offline.

## Developing without League running

- `npm run start:mock` — replays a recorded ranked session (champ select →
  loading → in-game clock) through the real pipeline with canned plan text.
- `npm run demo` — opens the overlay with a fully rendered example plan, for
  UI iteration.
- `npm run simulate` — the same end-to-end pipeline, headless in a terminal
  (CI runs this). Add `SHOTCALLER_SIMULATE_LIVE=1` with an API key to make
  real planner calls and iterate on the prompt.
- `npm test` / `npm run typecheck` — unit tests and types.

## Personal coaching profile

Shotcaller is not a generic tips app: it coaches **against your actual
leaks**. `coach/profile.json` holds a diagnosis of the player's long-term
tendencies (produced by a multi-agent analysis of their public ranked
history — the readable version lives in `coach/diagnosis.md`). When the file
exists:

- every plan section is steered by the profile's standing *plan directives*
  (e.g. how to plan "if behind" for a player who historically forces plays
  when tilted), and
- stage-2 plans gain a final **`## FOCUS`** section — the 2–3 profile leaks
  *this* matchup is most likely to trigger, each tied to a concrete in-game
  moment. FOCUS stays pinned in the overlay's compact mode.

The profile lives in the user message (not the cached rubric), so editing it
never costs cache latency. Point `SHOTCALLER_PROFILE` at a different file to
swap profiles. Delete the file to fall back to generic coaching. Regenerate
it after a meaningful number of new games — it describes the player, not the
patch. (You don't have to count: Shotcaller tallies finished games against
the profile's `generatedAt` and shows a quiet note once it hits ~30.)

### Post-game archive

Shotcaller already reads the end-of-game stats block for the session gate —
so it archives it too. Every finished game appends one line to
`coach/history/games.jsonl` (git-ignored):

- the **raw EOG stats block, untouched** — the payload the client actually
  sent, so a future profile regeneration can recompute any number from
  ground truth instead of scraping op.gg, and
- a small derived header for quick reading: win/loss, K/D/A, champion,
  kill participation, control wards bought, cs, vision score, gold.

All queues are archived (normals matter for tilt evidence), duplicates are
dropped by `gameId` (reconnecting on the end-of-game screen doesn't
double-count), and only games Shotcaller was running for are captured —
op.gg still covers gaps. Move it with `SHOTCALLER_HISTORY=<path>`, disable
with `SHOTCALLER_HISTORY=off`.

**Generated plans are logged too** (`coach/history/plans.jsonl`): every
plan's full text with the rosters it was written for, the model and effort
that produced it, and how long it took to land. When a plan feels
repetitive, wrong, or slow, the receipt survives the game — and comparing
models is reading a file instead of remembering.

### Session gate & pick hints

Two live enforcers of the profile, both on by default:

- **Session gate** — Shotcaller reads each finished game's result from the
  LCU end-of-game stats and applies the profile's stop-loss rule: two
  consecutive ranked losses closes the gate for this app session; any
  "rough game" (a loss with kills + assists ≤ deaths, any queue) starts a
  15-minute cooldown with a countdown; a ranked win reopens everything.
  The gate is a red banner in the overlay — **advisory only, on purpose**:
  it never touches the queue or declines anything (input automation is
  against Riot's rules, and the override — restarting the app — is exactly
  the deliberate pause the rule wants). Disable with `SHOTCALLER_GATE=off`.
- **Pick hints** — during champ select, the overlay reads the profile's
  pool plan (`pool.main` / `pool.stabilizer`) against live ally locks and
  bans: *"Qiyana is banned — stabilizer game: lock Zac"*, *"No frontline
  locked yet — lean Zac"*, *"Frontline covered — Qiyana game."* Frontline
  detection is a heuristic (Data Dragon's Tank tag). Disable with
  `SHOTCALLER_HINTS=off`.

## Is this allowed?

Yes — this is the same integration surface the big companion apps
(Blitz, Porofessor, Mobalytics) are built on:

- **LCU API** (local client REST/WebSocket): read-only here; Riot tolerates
  it and asks developers to [register before public release](https://www.riotgames.com/en/DevRel/changes-to-the-lcu-api-policy).
- **Live Client Data API** (`https://127.0.0.1:2999`): [officially documented](https://developer.riotgames.com/docs/lol)
  by Riot for exactly this use.
- **Data Dragon**: Riot's official static-data CDN.
- The overlay is a separate transparent window — no injection, no memory
  reads, no input automation, which is what [Vanguard actually polices](https://www.riotgames.com/en/DevRel/vanguard-faq).
- Riot's line on features (per their [third-party app policy](https://support-leagueoflegends.riotgames.com/hc/en-us/articles/38353478786067-Third-Party-Applications)):
  nothing that reveals hidden information or "draws conclusions for you
  during gameplay" (e.g. the March 2025 ban on enemy-ult timers). Shotcaller
  stays on the safe side: pre-game planning plus a passive cheat sheet; the
  only live signal it reads is the game clock.

## Architecture

> Working on this repo (human or LLM)? **`INDEX.md` is the map** — compressed
> architecture, invariants, decision + incident log, the coaching diagnosis,
> and the profile-regeneration protocol. `CLAUDE.md` carries the hard rules.

```
League client ──lockfile/WSS──▶ LcuConnector ──▶ Shotcaller (state machine)
                                                   │   fires stage 1 at pick lock,
Game process ──:2999 clock────▶ LiveClientPoller ──┤   stage 2 at loading screen
                                                   ▼
Data Dragon (cached) ──names──▶ prompt builder ──▶ Claude (streaming, cached rubric)
                                                   │
                       Electron overlay ◀──events──┘
```

- `src/planner/state.ts` — the state machine; all timing decisions live here
- `src/planner/prompt.ts` — the coaching rubric (cache-stable) + per-game messages
- `src/planner/claude.ts` — streaming planner, refusal fallback, dry-run twin
- `src/lcu/connector.ts` — league-connect wiring, reconnects, roster retries
- `src/lcu/mock.ts` + `fixtures/` — recorded session replay
- `src/overlay/` — the renderer (plain HTML/CSS/JS, no build step)

## Roadmap

- Scouting: enemy ranks/mains via the Riot Web API (needs an API key + daily
  dev-key refresh, so it's opt-in)
- Persist overlay position; per-role layout presets
- Package as an installer (electron-builder) instead of `npm start`
- Optional patch-notes feed into the rubric

## Troubleshooting

- **Overlay invisible in game** → switch League to Borderless in Settings →
  Video. If the card renders black, try `app.disableHardwareAcceleration()`
  (known Electron transparency quirk on some GPUs).
- **"Waiting for the League client…" forever** → make sure the League
  *client* (not just Riot Client) is running; Shotcaller reads its lockfile.
- **Pressed a hotkey and the overlay footer didn't flash** → the key never
  reached Shotcaller: another app grabbed the combo mid-session, or the game
  intercepted it. Rebind via the `SHOTCALLER_HOTKEY_*` variables in `.env`.
  (A combo that was already taken at startup shows as an overlay note.)
- **Plans feel slow** → set `SHOTCALLER_MODEL=claude-haiku-4-5`, keep
  `SHOTCALLER_EFFORT=low`.
- **No plan, status shows an API error** → check `ANTHROPIC_API_KEY` in
  `.env`; the terminal window logs the underlying error.
