import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { isRoughGame, SessionGate } from "../src/coach/gate";
import { parseEogStats } from "../src/lcu/eog";
import { parseChampionFile } from "../src/data/ddragon";
import { Shotcaller } from "../src/planner/state";
import type { CoachProfile } from "../src/coach/profile";
import type {
  ChampSelectSession,
  Planner,
  ShotcallerEvent,
} from "../src/types";

const win = { ranked: true, win: true, kills: 8, deaths: 2, assists: 9 };
const cleanLoss = { ranked: true, win: false, kills: 7, deaths: 5, assists: 10 };
const roughLoss = { ranked: true, win: false, kills: 4, deaths: 9, assists: 5 };
const roughNormalLoss = { ranked: false, win: false, kills: 2, deaths: 9, assists: 2 };

describe("SessionGate", () => {
  function gateAt(startMs: number) {
    let now = startMs;
    const gate = new SessionGate(15 * 60_000, () => now);
    return { gate, advance: (ms: number) => (now += ms) };
  }

  it("closes after two consecutive ranked losses", () => {
    const { gate } = gateAt(0);
    expect(gate.record(cleanLoss).state).toBe("open");
    const status = gate.record(cleanLoss);
    expect(status.state).toBe("closed");
    expect(gate.current().state).toBe("closed"); // stays closed
  });

  it("a rough loss triggers a 15-minute cooldown that expires", () => {
    const { gate, advance } = gateAt(1000);
    const status = gate.record(roughLoss);
    expect(status.state).toBe("cooldown");
    if (status.state === "cooldown") {
      expect(status.untilTs).toBe(1000 + 15 * 60_000);
    }
    advance(14 * 60_000);
    expect(gate.current().state).toBe("cooldown");
    advance(2 * 60_000);
    expect(gate.current().state).toBe("open");
  });

  it("a ranked win resets the streak and reopens the gate", () => {
    const { gate } = gateAt(0);
    gate.record(cleanLoss);
    gate.record(cleanLoss);
    expect(gate.current().state).toBe("closed");
    gate.record(win);
    expect(gate.current().state).toBe("open");
    expect(gate.record(cleanLoss).state).toBe("open"); // streak restarted at 1
  });

  it("normal-queue losses do not advance the ranked streak, but rough ones cool down", () => {
    const { gate } = gateAt(0);
    expect(gate.record({ ...cleanLoss, ranked: false }).state).toBe("open");
    expect(gate.record(roughNormalLoss).state).toBe("cooldown");
    // Still only takes TWO ranked losses from here — normals never counted.
    gate.record(win);
    gate.record(cleanLoss);
    expect(gate.record(cleanLoss).state).toBe("closed");
  });

  it("rough-game detection is (kills + assists) <= deaths on a loss", () => {
    expect(isRoughGame(roughLoss)).toBe(true); // 4+5 <= 9
    expect(isRoughGame(cleanLoss)).toBe(false); // 7+10 > 5
    expect(isRoughGame({ ...roughLoss, win: true })).toBe(false);
  });
});

describe("parseEogStats", () => {
  const raw = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), "fixtures/eog-stats-block.json"), "utf8"),
  );
  const me = { summonerId: 310001, puuid: "puuid-me" };

  it("parses a ranked loss with the local player's line", () => {
    const result = parseEogStats(raw, me);
    expect(result).toEqual({
      ranked: true,
      win: false,
      kills: 4,
      deaths: 9,
      assists: 5,
    });
  });

  it("reads the win from the local player's team", () => {
    const flipped = JSON.parse(JSON.stringify(raw));
    flipped.teams[0].isWinningTeam = true;
    flipped.teams[1].isWinningTeam = false;
    expect(parseEogStats(flipped, me)?.win).toBe(true);
  });

  it("returns null rather than guessing on malformed payloads", () => {
    expect(parseEogStats(null, me)).toBeNull();
    expect(parseEogStats({}, me)).toBeNull();
    expect(parseEogStats({ teams: [] }, me)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

const champs = parseChampionFile(
  JSON.parse(
    fs.readFileSync(
      path.resolve(process.cwd(), "fixtures/ddragon-champion.slim.json"),
      "utf8",
    ),
  ),
);

class NoopPlanner implements Planner {
  async allyBrief(): Promise<string> {
    return "## COMP IDENTITY\n" + "x".repeat(300);
  }
  async fullPlan(): Promise<string> {
    return "## WIN CONDITION\nx";
  }
}

const profile: CoachProfile = {
  focusAreas: [{ leak: "x", planDirective: "y" }],
  pool: { main: "Qiyana", stabilizer: "Zac" },
};

function session(overrides: Partial<ChampSelectSession>): ChampSelectSession {
  return {
    localPlayerCellId: 2,
    timer: { phase: "BAN_PICK" },
    myTeam: [
      { cellId: 0, championId: 254, assignedPosition: "top" }, // Vi (Fighter)
      { cellId: 1, championId: 222, assignedPosition: "bottom" }, // Jinx
      { cellId: 2, championId: 0, assignedPosition: "jungle" }, // me, unlocked
      { cellId: 3, championId: 0 },
      { cellId: 4, championId: 0 },
    ],
    theirTeam: [],
    bans: { myTeamBans: [], theirTeamBans: [] },
    actions: [],
    ...overrides,
  };
}

function hintHarness() {
  const sc = new Shotcaller(champs, new NoopPlanner(), { profile });
  const hints: (string | null)[] = [];
  const events: ShotcallerEvent[] = [];
  sc.onEvent((e) => {
    events.push(e);
    if (e.kind === "pick-hint") hints.push(e.text);
  });
  return { sc, hints, events };
}

describe("pick hints", () => {
  it("flags a comp with no frontline, then flips when a tank locks", () => {
    const { sc, hints } = hintHarness();
    sc.onChampSelect(session({}));
    expect(hints).toEqual(["No frontline locked yet — lean Zac."]);

    const withTank = session({});
    withTank.myTeam![3] = { cellId: 3, championId: 54 }; // Malphite (Tank)
    sc.onChampSelect(withTank);
    expect(hints).toEqual([
      "No frontline locked yet — lean Zac.",
      "Frontline covered — Qiyana game.",
    ]);
  });

  it("calls the stabilizer when the main is banned", () => {
    const { sc, hints } = hintHarness();
    sc.onChampSelect(session({ bans: { myTeamBans: [246], theirTeamBans: [] } }));
    expect(hints).toEqual(["Qiyana is banned — stabilizer game: lock Zac."]);
  });

  it("clears the hint once the player locks, and dedupes repeats", () => {
    const { sc, hints } = hintHarness();
    sc.onChampSelect(session({}));
    sc.onChampSelect(session({})); // identical update — no duplicate event
    const locked = session({});
    locked.myTeam![2] = { cellId: 2, championId: 246 }; // I lock Qiyana
    sc.onChampSelect(locked);
    expect(hints).toEqual(["No frontline locked yet — lean Zac.", null]);
  });

  it("stays quiet without a profile pool when the comp looks fine", () => {
    const sc = new Shotcaller(champs, new NoopPlanner());
    const hints: (string | null)[] = [];
    sc.onEvent((e) => {
      if (e.kind === "pick-hint") hints.push(e.text);
    });
    const withTank = session({});
    withTank.myTeam![3] = { cellId: 3, championId: 54 };
    sc.onChampSelect(withTank);
    expect(hints).toEqual([]); // frontline covered + no pool = nothing to say
  });
});

describe("gate integration in the state machine", () => {
  it("emits gate events on results and re-surfaces the gate at champ select", () => {
    const { sc, events } = hintHarness();
    sc.onGameResult({ ranked: true, win: false, kills: 7, deaths: 5, assists: 10 });
    sc.onGameResult({ ranked: true, win: false, kills: 7, deaths: 5, assists: 10 });
    const closed = events.filter((e) => e.kind === "gate" && e.state === "closed");
    expect(closed.length).toBe(1);

    sc.onGameflowPhase("ChampSelect"); // new queue → gate warning re-emitted
    const closedAfter = events.filter(
      (e) => e.kind === "gate" && e.state === "closed",
    );
    expect(closedAfter.length).toBe(2);
  });

  it("can be disabled via options", () => {
    const sc = new Shotcaller(champs, new NoopPlanner(), { gate: false });
    const gates: ShotcallerEvent[] = [];
    sc.onEvent((e) => {
      if (e.kind === "gate") gates.push(e);
    });
    sc.onGameResult({ ranked: true, win: false, kills: 0, deaths: 9, assists: 0 });
    expect(gates).toEqual([]);
  });
});
