// Game-mode "boost": close a user-configured list of background apps before
// playing. Windows-only (no-op elsewhere).
//
// Safety posture, deliberately conservative:
// - Only processes named in boost.json are ever touched — there is no
//   heuristic "kill everything unnecessary", because software cannot know
//   which process holds your unsaved work.
// - A hard-coded NEVER_KILL guard protects Windows system processes, all
//   Riot/Vanguard processes, and Shotcaller's own runtime, even if listed.
// - Graceful close first (taskkill without /F sends a window-close request);
//   force-terminate only processes explicitly marked "force": true, and only
//   after the grace period.
// - --boost-dry-run reports the plan without touching anything.

import { execFile } from "node:child_process";
import * as fs from "node:fs";

export interface BoostProcess {
  /** Image name, e.g. "Spotify.exe". Case-insensitive. */
  name: string;
  /** Force-terminate (/F /T) if still alive after the grace period. */
  force?: boolean;
}

export interface BoostConfig {
  enabled: boolean;
  /** "launch": when game mode starts. "gamestart": at the loading screen. */
  trigger: "launch" | "gamestart";
  /** How long to wait after the graceful close before force pass (ms). */
  graceMs: number;
  processes: BoostProcess[];
}

export interface BoostPlan {
  toKill: BoostProcess[];
  protectedSkipped: string[];
  invalidSkipped: string[];
  notRunning: string[];
}

export interface BoostSummary {
  closed: string[];
  forced: string[];
  protectedSkipped: string[];
  dryRun: boolean;
}

/** Processes we refuse to touch no matter what the config says. */
export const NEVER_KILL = new Set(
  [
    // Windows core
    "system", "registry", "smss.exe", "csrss.exe", "wininit.exe",
    "winlogon.exe", "services.exe", "lsass.exe", "svchost.exe",
    "explorer.exe", "dwm.exe", "fontdrvhost.exe", "sihost.exe",
    "taskhostw.exe", "ctfmon.exe", "runtimebroker.exe", "audiodg.exe",
    "spoolsv.exe", "dllhost.exe", "conhost.exe", "wmiprvse.exe",
    // Shells/terminals (the user is likely running us from one)
    "cmd.exe", "powershell.exe", "pwsh.exe", "windowsterminal.exe", "wt.exe",
    // Our own runtime
    "node.exe", "electron.exe", "shotcaller.exe",
    // Riot / League / Vanguard — killing these breaks the game or anticheat
    "riotclientservices.exe", "riotclientux.exe", "riotclientuxrender.exe",
    "leagueclient.exe", "leagueclientux.exe", "leagueclientuxrender.exe",
    "league of legends.exe", "vgtray.exe", "vgc.exe",
  ].map((n) => n.toLowerCase()),
);

const VALID_NAME = /^[A-Za-z0-9 ._+()-]+\.exe$/i;

export function loadBoostConfig(filePath: string): BoostConfig | null {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<BoostConfig>;
    if (typeof raw.enabled !== "boolean" || !Array.isArray(raw.processes)) {
      return null;
    }
    return {
      enabled: raw.enabled,
      trigger: raw.trigger === "gamestart" ? "gamestart" : "launch",
      graceMs:
        typeof raw.graceMs === "number" && raw.graceMs >= 0
          ? Math.min(raw.graceMs, 30_000)
          : 4000,
      processes: raw.processes.filter(
        (p): p is BoostProcess => Boolean(p && typeof p.name === "string"),
      ),
    };
  } catch {
    return null;
  }
}

/** Pure planning step, unit-tested: decide what would be closed. */
export function planBoost(config: BoostConfig, runningImages: string[]): BoostPlan {
  const running = new Set(runningImages.map((n) => n.toLowerCase()));
  const plan: BoostPlan = {
    toKill: [],
    protectedSkipped: [],
    invalidSkipped: [],
    notRunning: [],
  };
  const seen = new Set<string>();
  for (const proc of config.processes) {
    const key = proc.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (!VALID_NAME.test(proc.name)) {
      plan.invalidSkipped.push(proc.name);
    } else if (NEVER_KILL.has(key)) {
      plan.protectedSkipped.push(proc.name);
    } else if (!running.has(key)) {
      plan.notRunning.push(proc.name);
    } else {
      plan.toKill.push(proc);
    }
  }
  return plan;
}

function execFileP(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true }, (_err, stdout) =>
      resolve(stdout ?? ""),
    );
  });
}

/** List running process image names via tasklist. */
export async function listRunningImages(): Promise<string[]> {
  const csv = await execFileP("tasklist", ["/FO", "CSV", "/NH"]);
  const names: string[] = [];
  for (const line of csv.split(/\r?\n/)) {
    const match = line.match(/^"([^"]+)"/);
    if (match) names.push(match[1]);
  }
  return names;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Execute the boost. Returns a summary for the overlay/status line. */
export async function runBoost(
  config: BoostConfig,
  dryRun: boolean,
  log: (msg: string) => void,
): Promise<BoostSummary> {
  if (process.platform !== "win32") {
    log("[boost] game-mode boost is Windows-only — skipping.");
    return { closed: [], forced: [], protectedSkipped: [], dryRun };
  }

  const plan = planBoost(config, await listRunningImages());
  for (const name of plan.protectedSkipped) {
    log(`[boost] refusing to touch protected process: ${name}`);
  }
  for (const name of plan.invalidSkipped) {
    log(`[boost] invalid process name in boost.json, skipping: ${name}`);
  }

  if (dryRun) {
    log(
      `[boost] DRY RUN — would close: ${plan.toKill.map((p) => p.name).join(", ") || "(nothing running from the list)"}`,
    );
    return {
      closed: plan.toKill.map((p) => p.name),
      forced: [],
      protectedSkipped: plan.protectedSkipped,
      dryRun: true,
    };
  }

  // Pass 1: graceful close (window-close request; apps may prompt to save).
  for (const proc of plan.toKill) {
    log(`[boost] closing ${proc.name}…`);
    await execFileP("taskkill", ["/IM", proc.name]);
  }

  // Pass 2: force only the explicitly opted-in stragglers.
  const forced: string[] = [];
  const forceable = plan.toKill.filter((p) => p.force);
  if (forceable.length > 0) {
    await sleep(config.graceMs);
    const stillRunning = new Set(
      (await listRunningImages()).map((n) => n.toLowerCase()),
    );
    for (const proc of forceable) {
      if (stillRunning.has(proc.name.toLowerCase())) {
        log(`[boost] force-terminating ${proc.name} (marked force:true)…`);
        await execFileP("taskkill", ["/F", "/T", "/IM", proc.name]);
        forced.push(proc.name);
      }
    }
  }

  return {
    closed: plan.toKill.map((p) => p.name),
    forced,
    protectedSkipped: plan.protectedSkipped,
    dryRun: false,
  };
}
