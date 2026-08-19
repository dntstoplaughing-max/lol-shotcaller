import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parseChampionFile } from "../src/data/ddragon";
import { Shotcaller } from "../src/planner/state";
import type {
  ChampSelectSession,
  GameflowSession,
  Planner,
  PlanInput,
  ShotcallerEvent,
} from "../src/types";

function fixture<T>(name: string): T {
  return JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), "fixtures", name), "utf8"),
  ) as T;
}

const champs = parseChampionFile(fixture("ddragon-champion.slim.json"));
const champSelectSnapshots = fixture<ChampSelectSession[]>(
  "champselect-events.json",
);
const gameStart = fixture<GameflowSession>("gameflow-session-gamestart.json");

class FakePlanner implements Planner {
  briefInputs: PlanInput[] = [];
  planInputs: { input: PlanInput; brief: string | null }[] = [];

  async allyBrief(
    input: PlanInput,
    onToken: (t: string) => void,
  ): Promise<string> {
    this.briefInputs.push(input);
    const text = "## COMP IDENTITY\n" + "scaling teamfight comp. ".repeat(12);
    onToken(text);
    return text;
  }

  async fullPlan(
    input: PlanInput,
    brief: string | null,
    onToken: (t: string) => void,
  ): Promise<string> {
    this.planInputs.push({ input, brief });
    const text = "## WIN CONDITION\ngroup and win";
    onToken(text);
    return text;
  }
}

function harness() {
  const planner = new FakePlanner();
  const sc = new Shotcaller(champs, planner);
  sc.setCurrentSummoner({ summonerId: 310001, puuid: "puuid-me" });
  const events: ShotcallerEvent[] = [];
  sc.onEvent((e) => events.push(e));
  return { sc, planner, events };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("champ select", () => {
  it("emits lobby updates with resolved names and bans", () => {
    const { sc, events } = harness();
    sc.onGameflowPhase("ChampSelect");
    sc.onChampSelect(champSelectSnapshots[0]);

    const lobby = events.find((e) => e.kind === "lobby");
    expect(lobby && lobby.kind === "lobby").toBeTruthy();
    if (lobby?.kind !== "lobby") return;
    expect(lobby.allies.map((a) => a.championName)).toContain("Malphite");
    expect(lobby.bans).toContain("Zed");
    expect(lobby.bans).toContain("Blitzcrank");
  });

  it("fires stage 1 exactly once, at finalization with all picks locked", async () => {
    const { sc, planner } = harness();
    sc.onGameflowPhase("ChampSelect");
    for (const snapshot of champSelectSnapshots) sc.onChampSelect(snapshot);
    sc.onChampSelect(champSelectSnapshots[2]); // duplicate finalization tick
    await flush();

    expect(planner.briefInputs).toHaveLength(1);
    const input = planner.briefInputs[0];
    expect(input.me?.championName).toBe("Ahri");
    expect(input.me?.position).toBe("middle");
    expect(input.allies).toHaveLength(5);
    expect(input.enemies).toHaveLength(0);
  });

  it("does not fire stage 1 before all five allies lock", async () => {
    const { sc, planner } = harness();
    sc.onGameflowPhase("ChampSelect");
    sc.onChampSelect(champSelectSnapshots[0]);
    sc.onChampSelect(champSelectSnapshots[1]);
    await flush();
    expect(planner.briefInputs).toHaveLength(0);
  });
});

describe("game start", () => {
  it("fires stage 2 with the correct sides and passes the ally brief", async () => {
    const { sc, planner, events } = harness();
    sc.onGameflowPhase("ChampSelect");
    for (const snapshot of champSelectSnapshots) sc.onChampSelect(snapshot);
    await flush();

    sc.onGameflowPhase("GameStart");
    expect(sc.onGameStartData(gameStart)).toBe(true);
    await flush();

    expect(planner.planInputs).toHaveLength(1);
    const { input, brief } = planner.planInputs[0];
    expect(input.enemies.map((e) => e.championName)).toEqual([
      "Darius",
      "Lee Sin",
      "Syndra",
      "Caitlyn",
      "Leona",
    ]);
    expect(input.me?.championName).toBe("Ahri");
    expect(input.me?.isMe).toBe(true);
    expect(input.bans).toContain("Teemo");
    expect(brief).not.toBeNull();

    const matchup = events.find((e) => e.kind === "matchup");
    expect(matchup && matchup.kind === "matchup").toBeTruthy();
    if (matchup?.kind !== "matchup") return;
    expect(matchup.allies).toHaveLength(5);
    expect(matchup.enemies).toHaveLength(5);

    const done = events.find((e) => e.kind === "plan-done" && e.stage === 2);
    expect(done).toBeTruthy();
  });

  it("returns false while the roster is still empty, true after planning", async () => {
    const { sc } = harness();
    expect(
      sc.onGameStartData({
        phase: "GameStart",
        gameData: { teamOne: [], teamTwo: [] },
      }),
    ).toBe(false);
    expect(sc.onGameStartData(gameStart)).toBe(true);
    await flush();
    expect(sc.onGameStartData(gameStart)).toBe(true); // idempotent
  });

  it("handles a cold start mid-game (no champ select seen) via summoner id", async () => {
    const { sc, planner } = harness();
    sc.onGameflowPhase("InProgress");
    expect(sc.onGameStartData(gameStart)).toBe(true);
    await flush();

    const { input } = planner.planInputs[0];
    expect(input.allies.map((a) => a.championName)).toContain("Ahri");
    expect(input.enemies.map((e) => e.championName)).toContain("Darius");
  });

  it("picks the right side when we are on teamTwo", async () => {
    const { sc, planner } = harness();
    const swapped: GameflowSession = {
      phase: "GameStart",
      gameData: {
        queue: gameStart.gameData?.queue,
        teamOne: gameStart.gameData?.teamTwo,
        teamTwo: gameStart.gameData?.teamOne,
      },
    };
    expect(sc.onGameStartData(swapped)).toBe(true);
    await flush();

    const { input } = planner.planInputs[0];
    expect(input.allies.map((a) => a.championName)).toContain("Ahri");
    expect(input.enemies.map((e) => e.championName)).toContain("Darius");
  });
});

describe("session lifecycle", () => {
  it("resets on a new champ select so the next game plans again", async () => {
    const { sc, planner } = harness();
    sc.onGameflowPhase("ChampSelect");
    for (const snapshot of champSelectSnapshots) sc.onChampSelect(snapshot);
    await flush();
    sc.onGameStartData(gameStart);
    await flush();
    sc.onGameflowPhase("WaitingForStats");

    sc.onGameflowPhase("ChampSelect"); // next queue
    for (const snapshot of champSelectSnapshots) sc.onChampSelect(snapshot);
    await flush();
    sc.onGameStartData(gameStart);
    await flush();

    expect(planner.briefInputs).toHaveLength(2);
    expect(planner.planInputs).toHaveLength(2);
  });

  it("emits clock events for the overlay", () => {
    const { sc, events } = harness();
    sc.onClock(942);
    const clock = events.find((e) => e.kind === "clock");
    expect(clock && clock.kind === "clock" && clock.gameTimeSec).toBe(942);
  });
});
