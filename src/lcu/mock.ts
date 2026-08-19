// Fixture-driven replay of a full session, for developing without League
// running (and for the headless simulate/CI smoke test). Feeds the state
// machine the same call sequence the real connector would.

import * as fs from "node:fs";
import * as path from "node:path";
import type { Shotcaller } from "../planner/state";
import type {
  ChampSelectSession,
  GameflowSession,
  ShotcallerEvent,
} from "../types";

// Compiled location is dist/lcu/mock.js; fixtures stay at the repo root.
export const FIXTURES_DIR = path.resolve(__dirname, "../../fixtures");

export function loadFixture<T>(name: string): T {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, name), "utf8"),
  ) as T;
}

/** Resolve when the state machine emits an event matching the predicate. */
export function waitForEvent(
  sc: Shotcaller,
  predicate: (evt: ShotcallerEvent) => boolean,
  timeoutMs = 30_000,
): Promise<ShotcallerEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out waiting for event")),
      timeoutMs,
    );
    const listener = (evt: ShotcallerEvent): void => {
      if (predicate(evt)) {
        clearTimeout(timer);
        sc.removeListener("event", listener);
        resolve(evt);
      }
    };
    sc.on("event", listener);
  });
}

export interface MockOptions {
  /** Compress the timeline (tests/CI) instead of human-watchable pacing. */
  fast?: boolean;
}

export async function runMockSession(
  sc: Shotcaller,
  options: MockOptions = {},
): Promise<void> {
  const pace = options.fast ? 5 : 900;
  const champSelectSnapshots = loadFixture<ChampSelectSession[]>(
    "champselect-events.json",
  );
  const gameStart = loadFixture<GameflowSession>(
    "gameflow-session-gamestart.json",
  );

  sc.setCurrentSummoner({ summonerId: 310001, puuid: "puuid-me" });
  sc.onGameflowPhase("Lobby");
  await sleep(pace);
  sc.onGameflowPhase("ChampSelect");

  for (const snapshot of champSelectSnapshots) {
    await sleep(pace);
    sc.onChampSelect(snapshot);
  }

  // Ally brief (stage 1) is streaming now; let it land before "loading".
  await waitForEvent(sc, (e) => e.kind === "plan-done" && e.stage === 1);

  await sleep(pace);
  sc.onGameflowPhase("GameStart");
  await sleep(pace);
  sc.onGameStartData(gameStart);
  await waitForEvent(sc, (e) => e.kind === "plan-done" && e.stage === 2);

  sc.onGameflowPhase("InProgress");
  for (const t of options.fast ? [95] : [95, 480, 950, 1580]) {
    await sleep(pace);
    sc.onClock(t);
  }

  await sleep(pace);
  sc.onGameflowPhase("WaitingForStats");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
