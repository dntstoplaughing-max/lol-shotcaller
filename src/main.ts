// Electron main process: owns the overlay window, global hotkeys, and the
// pipeline (LCU connector -> state machine -> planner -> overlay events).
//
// The overlay is a separate transparent always-on-top window — it never
// touches the game process (no injection, no memory reads), which is what
// keeps it on the right side of Vanguard. League must run in Borderless or
// Windowed mode for any overlay to be visible.

import "dotenv/config";
import * as path from "node:path";
import {
  app,
  BrowserWindow,
  globalShortcut,
  screen,
} from "electron";
import { ensureChampMap } from "./data/ddragon";
import { LcuConnector } from "./lcu/connector";
import { runMockSession } from "./lcu/mock";
import { LiveClientPoller } from "./liveclient/poller";
import { makePlanner } from "./planner/claude";
import { Shotcaller } from "./planner/state";
import type { ChampMap } from "./types";

const flags = new Set(process.argv.slice(1));
const MOCK = flags.has("--mock") || process.env.MOCK === "1";
const DRY_RUN = flags.has("--dry-run") || process.env.PLAN_DRY_RUN === "1";
const DEMO = flags.has("--demo");

const OVERLAY_WIDTH = 400;
const OVERLAY_HEIGHT = 640;

const TOGGLE_MOUSE_HOTKEY = process.env.SHOTCALLER_HOTKEY_MOUSE ?? "Control+Alt+O";
const COLLAPSE_HOTKEY = process.env.SHOTCALLER_HOTKEY_COLLAPSE ?? "Control+Alt+K";

let overlay: BrowserWindow | null = null;
let interactive = false;

function createOverlay(): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
    x: workArea.x + workArea.width - OVERLAY_WIDTH - 24,
    y: workArea.y + 96,
    transparent: true,
    frame: false,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // 'screen-saver' keeps the overlay above a borderless-fullscreen game.
  win.setAlwaysOnTop(true, "screen-saver");
  setInteractive(win, false);

  const overlayHtml = path.join(app.getAppPath(), "src/overlay/overlay.html");
  void win.loadFile(overlayHtml, DEMO ? { query: { demo: "1" } } : undefined);
  return win;
}

function setInteractive(win: BrowserWindow, value: boolean): void {
  interactive = value;
  // Click-through when not interactive, so it never eats a game click.
  win.setIgnoreMouseEvents(!value, { forward: true });
  if (value) win.focus();
  win.webContents.send("sc-ui", { type: "interactive", value });
}

async function startPipeline(win: BrowserWindow): Promise<void> {
  if (DEMO) return; // overlay.html?demo=1 drives itself

  let champs: ChampMap = new Map();
  let champError: string | null = null;
  try {
    champs = await ensureChampMap(path.join(app.getPath("userData"), "ddragon"));
  } catch (err) {
    champError = String(err);
  }

  const planner = makePlanner(DRY_RUN);
  const sc = new Shotcaller(champs, planner);
  const poller = new LiveClientPoller((t) => sc.onClock(t));

  sc.onEvent((evt) => {
    if (!win.isDestroyed()) win.webContents.send("sc-event", evt);
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
    await new LcuConnector(sc, poller).start();
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
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
  });

  app.on("will-quit", () => globalShortcut.unregisterAll());
  app.on("window-all-closed", () => app.quit());
}
