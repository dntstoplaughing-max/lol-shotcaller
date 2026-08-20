// Electron main process: owns the overlay window, global hotkeys, and the
// pipeline (LCU connector -> state machine -> planner -> overlay events).
//
// The overlay is a separate transparent always-on-top window — it never
// touches the game process (no injection, no memory reads), which is what
// keeps it on the right side of Vanguard. League must run in Borderless or
// Windowed mode for any overlay to be visible.

import "dotenv/config";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  app,
  BrowserWindow,
  globalShortcut,
  screen,
} from "electron";
import { loadCoachProfile } from "./coach/profile";
import { ensureChampMap } from "./data/ddragon";
import { LcuConnector } from "./lcu/connector";
import { runMockSession } from "./lcu/mock";
import { LiveClientPoller } from "./liveclient/poller";
import { makePlanner } from "./planner/claude";
import { Shotcaller } from "./planner/state";
import { loadBoostConfig, runBoost, type BoostSummary } from "./system/boost";
import {
  bumpGamesSinceProfile,
  clampToWorkAreas,
  parseSavedPosition,
  PROFILE_STALE_GAMES,
  profileStaleNoteText,
  updateNoteText,
} from "./system/housekeeping";
import { launchLeagueIfNeeded } from "./system/league";
import type { ChampMap } from "./types";

const flags = new Set(process.argv.slice(1));
const MOCK = flags.has("--mock") || process.env.MOCK === "1";
const DRY_RUN = flags.has("--dry-run") || process.env.PLAN_DRY_RUN === "1";
const DEMO = flags.has("--demo");
// Game mode: run the boost.json kill list and auto-launch League, so one
// desktop shortcut is the whole pre-game routine.
const GAME_MODE = flags.has("--game-mode") || process.env.SHOTCALLER_GAME_MODE === "1";
const BOOST_DRY = flags.has("--boost-dry-run");
// Session stop-loss gate and champ-select pick hints (both default on).
const GATE_ENABLED = process.env.SHOTCALLER_GATE !== "off";
const HINTS_ENABLED = process.env.SHOTCALLER_HINTS !== "off";

const OVERLAY_WIDTH = 400;
const OVERLAY_HEIGHT = 640;

const TOGGLE_MOUSE_HOTKEY = process.env.SHOTCALLER_HOTKEY_MOUSE ?? "Control+Alt+O";
const COLLAPSE_HOTKEY = process.env.SHOTCALLER_HOTKEY_COLLAPSE ?? "Control+Alt+K";
const PANIC_QUIT_HOTKEY = process.env.SHOTCALLER_HOTKEY_QUIT ?? "Control+Alt+Shift+Q";

// Dead-man switch: interactive mode reverts to click-through on its own, so
// an accidental toggle mid-fight can never leave the overlay eating clicks.
const INTERACTIVE_TIMEOUT_MS = (() => {
  const raw = Number(process.env.SHOTCALLER_INTERACTIVE_TIMEOUT_S);
  if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw) * 1000;
  return 20_000;
})();

let overlay: BrowserWindow | null = null;
let interactive = false;
let interactiveTimer: NodeJS.Timeout | null = null;
// The live pipeline's state machine, once startPipeline has built it — the
// second-instance game-mode handoff needs to reach it from outside.
let pipelineSc: Shotcaller | null = null;

// ------------------------------------------------------- position memory

const positionFile = () => path.join(app.getPath("userData"), "overlay-position.json");

/** Where the overlay was last dragged to, if that spot is still on-screen. */
function loadOverlayPosition(): { x: number; y: number } | null {
  try {
    const raw = fs.existsSync(positionFile())
      ? fs.readFileSync(positionFile(), "utf8")
      : null;
    return clampToWorkAreas(
      parseSavedPosition(raw),
      { width: OVERLAY_WIDTH, height: OVERLAY_HEIGHT },
      screen.getAllDisplays().map((d) => d.workArea),
    );
  } catch {
    return null;
  }
}

let savePositionTimer: NodeJS.Timeout | null = null;
function watchOverlayPosition(win: BrowserWindow): void {
  win.on("move", () => {
    if (savePositionTimer) clearTimeout(savePositionTimer);
    savePositionTimer = setTimeout(() => {
      if (win.isDestroyed()) return;
      try {
        const [x, y] = win.getPosition();
        fs.mkdirSync(app.getPath("userData"), { recursive: true });
        fs.writeFileSync(positionFile(), JSON.stringify({ x, y }));
      } catch {
        // remembering the spot is best-effort; never bother the pipeline
      }
    }, 500);
  });
}

function createOverlay(): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay();
  const saved = loadOverlayPosition();
  const win = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
    x: saved ? saved.x : workArea.x + workArea.width - OVERLAY_WIDTH - 24,
    y: saved ? saved.y : workArea.y + 96,
    transparent: true,
    frame: false,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    // Never take keyboard focus (clicks/scroll still work when interactive),
    // and register as a tool window so Alt+Tab can't land on the overlay —
    // the game keeps focus no matter what.
    focusable: false,
    type: "toolbar",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // 'screen-saver' keeps the overlay above a borderless-fullscreen game.
  win.setAlwaysOnTop(true, "screen-saver");
  setInteractive(win, false);
  watchOverlayPosition(win);

  const overlayHtml = path.join(app.getAppPath(), "src/overlay/overlay.html");
  void win.loadFile(overlayHtml, DEMO ? { query: { demo: "1" } } : undefined);
  return win;
}

function setInteractive(win: BrowserWindow, value: boolean): void {
  interactive = value;
  // Click-through when not interactive, so it never eats a game click.
  //
  // Deliberately NO `{ forward: true }` and NO focus() here:
  // - forward:true installs a system-wide low-level mouse hook on Windows;
  //   when a running game starves this process, that hook stalls and the
  //   OS cursor freezes machine-wide (first-run incident). We don't need
  //   hover events, so no hook, ever.
  // - The overlay must never steal focus from the game.
  win.setIgnoreMouseEvents(!value);
  win.webContents.send("sc-ui", { type: "interactive", value });

  if (interactiveTimer) {
    clearTimeout(interactiveTimer);
    interactiveTimer = null;
  }
  if (value && INTERACTIVE_TIMEOUT_MS > 0) {
    interactiveTimer = setTimeout(() => {
      if (overlay && !overlay.isDestroyed()) setInteractive(overlay, false);
    }, INTERACTIVE_TIMEOUT_MS);
  }
}

// -------------------------------------------------------- passive nudges

/** Show a low-key housekeeping note in the overlay footer (id-keyed so a
 *  re-send replaces rather than stacks). The renderer hides notes while a
 *  plan is streaming or a game is live — no mid-game noise, ever. */
function sendNote(id: string, text: string): void {
  console.log(`[note] ${text}`);
  if (overlay && !overlay.isDestroyed()) {
    overlay.webContents.send("sc-ui", { type: "note", id, text });
  }
}

function gitInRepo(args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd: app.getAppPath(), timeout: 30_000, windowsHide: true },
      (err, stdout) => resolve(err ? null : String(stdout)),
    );
  });
}

/**
 * Passive update nudge: says when `npm run update` has something, and never
 * pulls on its own — an update that fails (or half-applies) right before a
 * queue is the worst possible timing, so applying stays a human decision.
 * Every failure path here is silent: no repo, no network, no upstream — the
 * app just runs as it is.
 */
function scheduleUpdateCheck(): void {
  if (process.env.SHOTCALLER_UPDATE_CHECK === "off") return;
  if (!fs.existsSync(path.join(app.getAppPath(), ".git"))) return;
  setTimeout(() => {
    void (async () => {
      if ((await gitInRepo(["fetch", "--quiet"])) === null) return;
      const count = await gitInRepo(["rev-list", "--count", "HEAD..@{upstream}"]);
      const behind = count === null ? NaN : Number(count.trim());
      if (Number.isFinite(behind) && behind > 0) {
        sendNote("update", updateNoteText(behind));
      }
    })();
  }, 10_000); // well off the launch path; nothing ever waits on this
}

let profileNudgeSent = false;
/** Count finished games against the profile's generatedAt; at 30+ suggest a
 *  regen (INDEX.md protocol). The app keeps the count so the player never
 *  has to wonder whether the profile still describes them. */
function noteGameFinished(profileGeneratedAt: string | undefined): void {
  if (!profileGeneratedAt) return;
  try {
    const file = path.join(app.getPath("userData"), "games-since-profile.json");
    const raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    const bumped = bumpGamesSinceProfile(raw, profileGeneratedAt);
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(bumped));
    if (bumped.games >= PROFILE_STALE_GAMES && !profileNudgeSent) {
      profileNudgeSent = true;
      sendNote("profile", profileStaleNoteText(bumped.games));
    }
  } catch {
    // bookkeeping must never break the pipeline
  }
}

// ------------------------------------------------------------- pipeline

async function startPipeline(win: BrowserWindow): Promise<void> {
  if (DEMO) return; // overlay.html?demo=1 drives itself
  if (!MOCK) scheduleUpdateCheck();

  let champs: ChampMap = new Map();
  let champError: string | null = null;
  try {
    champs = await ensureChampMap(path.join(app.getPath("userData"), "ddragon"));
  } catch (err) {
    champError = String(err);
  }

  const planner = makePlanner(DRY_RUN);
  const profile = loadCoachProfile(
    process.env.SHOTCALLER_PROFILE ||
      path.resolve(process.cwd(), "coach/profile.json"),
  );
  const sc = new Shotcaller(champs, planner, {
    profile,
    hints: HINTS_ENABLED,
    gate: GATE_ENABLED,
  });
  pipelineSc = sc;
  const poller = new LiveClientPoller((t) => sc.onClock(t));

  sc.onEvent((evt) => {
    if (!win.isDestroyed()) win.webContents.send("sc-event", evt);
    // Mock replays must never inflate the real games-since-profile count.
    if (evt.kind === "game-result" && !MOCK) {
      noteGameFinished(profile?.generatedAt);
    }
  });

  if (champError) {
    sc.announce("error", champError);
  }
  if (!process.env.ANTHROPIC_API_KEY && !DRY_RUN) {
    sc.announce(
      "waiting",
      "No ANTHROPIC_API_KEY set — running with canned dry-run plans.",
    );
  }

  if (MOCK) {
    sc.announce("waiting", "Mock mode: replaying a recorded session…");
    await runMockSession(sc, { fast: false });
  } else {
    if (GAME_MODE) await triggerGameMode();
    await new LcuConnector(sc, poller).start();
  }
}

// ------------------------------------------------------------ game mode

function boostLine(summary: BoostSummary): string {
  if (summary.closed.length === 0) return "Game mode: nothing to close.";
  const prefix = summary.dryRun ? "Game mode (dry run): would close" : "Game mode: closed";
  return `${prefix} ${summary.closed.join(", ")}.`;
}

let gamestartBoostArmed = false;
function armGamestartBoost(sc: Shotcaller): void {
  if (gamestartBoostArmed) return; // one listener, however many triggers
  gamestartBoostArmed = true;
  // trigger === "gamestart": free resources right as the loading screen
  // begins (the matchup event), once per game.
  let boostedThisGame = false;
  sc.onEvent((evt) => {
    if (evt.kind === "reset") boostedThisGame = false;
    if (evt.kind === "matchup" && !boostedThisGame) {
      boostedThisGame = true;
      // Re-read boost.json at fire time, so list edits apply without a restart.
      const config = loadBoostConfig(path.resolve(process.cwd(), "boost.json"));
      if (config?.enabled && config.trigger === "gamestart") {
        void runBoost(config, BOOST_DRY, console.log).then((summary) =>
          console.log(`[boost] ${boostLine(summary)}`),
        );
      }
    }
  });
}

/**
 * The whole pre-game routine: boost (per boost.json) + launch League. Runs
 * at startup under --game-mode, and again whenever the desktop shortcut is
 * clicked while Shotcaller is already up (second-instance handoff below) —
 * the icon is valid in every state, no "is it already running?" thought.
 */
async function triggerGameMode(): Promise<void> {
  const sc = pipelineSc;
  const announce = (msg: string) => {
    console.log(msg);
    sc?.announce("waiting", msg.replace(/^\[\w+\] /, ""));
  };
  const config = loadBoostConfig(path.resolve(process.cwd(), "boost.json"));
  if (!config) {
    console.log("[boost] boost.json missing or invalid — skipping boost.");
  } else if (!config.enabled) {
    console.log(
      '[boost] disabled — review boost.json and set "enabled": true to close background apps in game mode.',
    );
  } else if (config.trigger === "launch") {
    const summary = await runBoost(config, BOOST_DRY, console.log);
    announce(boostLine(summary));
  } else if (sc) {
    armGamestartBoost(sc);
  }
  await launchLeagueIfNeeded(announce);
}

// -------------------------------------------------------------- lifecycle

const gotLock = app.requestSingleInstanceLock({ gameMode: GAME_MODE });
if (!gotLock) {
  // A copy is already running (usually the login/startup instance). Our job
  // — including --game-mode — was handed to it via the lock's additionalData,
  // so quitting here is a handoff, not a failure.
  app.quit();
} else {
  // The running instance picks up a re-launch's game mode: the desktop icon
  // boosts + launches League through the existing overlay instead of dying
  // against the single-instance lock.
  app.on("second-instance", (_event, argv, _wd, additionalData) => {
    const wantsGameMode =
      Boolean((additionalData as { gameMode?: boolean } | null)?.gameMode) ||
      argv.includes("--game-mode");
    if (wantsGameMode) void triggerGameMode();
  });

  void app.whenReady().then(() => {
    overlay = createOverlay();
    overlay.webContents.once("did-finish-load", () => {
      if (overlay) void startPipeline(overlay);
    });

    globalShortcut.register(TOGGLE_MOUSE_HOTKEY, () => {
      if (overlay) setInteractive(overlay, !interactive);
    });
    globalShortcut.register(COLLAPSE_HOTKEY, () => {
      overlay?.webContents.send("sc-ui", { type: "collapse-toggle" });
    });
    // Panic button: kill the whole app (and any mouse state with it).
    globalShortcut.register(PANIC_QUIT_HOTKEY, () => app.quit());
  });

  app.on("will-quit", () => globalShortcut.unregisterAll());
  app.on("window-all-closed", () => app.quit());
}
