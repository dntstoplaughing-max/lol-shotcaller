// Launch League via the Riot Client when it isn't already running, so one
// Shotcaller shortcut is the whole pre-game routine. Windows-only.

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { listRunningImages } from "./boost";

const LEAGUE_IMAGES = new Set([
  "leagueclient.exe",
  "leagueclientux.exe",
  "league of legends.exe",
]);

const DEFAULT_RIOT_CLIENT =
  "C:\\Riot Games\\Riot Client\\RiotClientServices.exe";
const RIOT_INSTALLS_JSON =
  "C:\\ProgramData\\Riot Games\\RiotClientInstalls.json";

/** Pure and unit-tested: pull the Riot Client path out of Riot's install manifest. */
export function parseRiotInstalls(json: string): string | null {
  try {
    const data = JSON.parse(json) as { rc_default?: string; rc_live?: string };
    const p = data.rc_default || data.rc_live;
    return typeof p === "string" && p.length > 0 ? p : null;
  } catch {
    return null;
  }
}

export function findRiotClientPath(): string | null {
  const fromEnv = process.env.SHOTCALLER_RIOT_CLIENT;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  try {
    if (fs.existsSync(RIOT_INSTALLS_JSON)) {
      const parsed = parseRiotInstalls(fs.readFileSync(RIOT_INSTALLS_JSON, "utf8"));
      if (parsed && fs.existsSync(parsed)) return parsed;
    }
  } catch {
    // fall through to the default path
  }
  return fs.existsSync(DEFAULT_RIOT_CLIENT) ? DEFAULT_RIOT_CLIENT : null;
}

export async function launchLeagueIfNeeded(
  log: (msg: string) => void,
): Promise<void> {
  if (process.platform !== "win32") {
    log("[league] auto-launch is Windows-only — start League yourself.");
    return;
  }
  const running = new Set(
    (await listRunningImages()).map((n) => n.toLowerCase()),
  );
  if ([...LEAGUE_IMAGES].some((img) => running.has(img))) {
    log("[league] League client already running.");
    return;
  }
  const riotClient = findRiotClientPath();
  if (!riotClient) {
    log(
      "[league] Riot Client not found — set SHOTCALLER_RIOT_CLIENT in .env to its full path.",
    );
    return;
  }
  log("[league] launching League of Legends…");
  spawn(
    riotClient,
    ["--launch-product=league_of_legends", "--launch-patchline=live"],
    { detached: true, stdio: "ignore" },
  ).unref();
}
