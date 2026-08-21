import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendGameRecord,
  appendPlanRecord,
  buildGameRecord,
  describeRecord,
  type GameRecord,
} from "../src/coach/history";
import type { CurrentSummoner } from "../src/types";

const ME: CurrentSummoner = { summonerId: 310001, puuid: "puuid-me" };
const NOW = "2026-08-20T22:00:00.000Z";

function fixtureBlock(): unknown {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "../fixtures/eog-stats-block.json"), "utf8"),
  );
}

// A fuller block, shaped like what the live client actually sends: stats for
// every player, champion identity, ward/cs/gold/vision numbers.
function richBlock(): unknown {
  const player = (
    id: number,
    kills: number,
    extra: Record<string, unknown> = {},
  ) => ({
    summonerId: id,
    puuid: `puuid-${id}`,
    championId: 246,
    championName: "Qiyana",
    stats: { CHAMPIONS_KILLED: kills, NUM_DEATHS: 3, ASSISTS: 4, ...extra },
  });
  return {
    gameId: 777,
    queueId: 420,
    queueType: "RANKED_SOLO_5x5",
    localPlayer: player(310001, 8),
    teams: [
      {
        isWinningTeam: true,
        players: [
          player(310001, 8, {
            VISION_WARDS_BOUGHT_IN_GAME: 3,
            MINIONS_KILLED: 40,
            NEUTRAL_MINIONS_KILLED: 150,
            VISION_SCORE: 31,
            GOLD_EARNED: 13250,
          }),
          player(310002, 2),
          player(310003, 5),
          player(310004, 4),
          player(310005, 1),
        ],
      },
      { isWinningTeam: false, players: [player(320001, 3)] },
    ],
  };
}

describe("buildGameRecord", () => {
  it("builds the derived header from the repo fixture and keeps raw intact", () => {
    const raw = fixtureBlock();
    const rec = buildGameRecord(raw, ME, NOW);
    expect(rec).not.toBeNull();
    expect(rec).toMatchObject({
      archivedAt: NOW,
      gameId: 5624190933,
      queueId: 420,
      queueType: "RANKED_SOLO_5x5",
      ranked: true,
      win: false,
      kills: 4,
      deaths: 9,
      assists: 5,
    });
    expect(rec?.raw).toEqual(raw);
    // A teammate in the fixture has no stats — a partial team-kill sum would
    // flatter KP, so it must be omitted, not guessed.
    expect(rec?.killParticipation).toBeUndefined();
  });

  it("derives KP, champion, wards, cs, vision, gold from a full block", () => {
    const rec = buildGameRecord(richBlock(), ME, NOW);
    expect(rec).toMatchObject({
      gameId: 777,
      win: true,
      kills: 8,
      championId: 246,
      championName: "Qiyana",
      controlWardsBought: 3,
      cs: 190,
      visionScore: 31,
      goldEarned: 13250,
    });
    // team kills 8+2+5+4+1 = 20; me (8 kills + 4 assists) / 20 = 0.6
    expect(rec?.killParticipation).toBe(0.6);
  });

  it("returns null exactly when the gate parser would (garbage in)", () => {
    expect(buildGameRecord(null, ME, NOW)).toBeNull();
    expect(buildGameRecord({ teams: [] }, ME, NOW)).toBeNull();
    expect(
      buildGameRecord({ localPlayer: { stats: { CHAMPIONS_KILLED: 1 } } }, ME, NOW),
    ).toBeNull();
  });

  it("tolerates a block with no gameId (archives with gameId null)", () => {
    const raw = fixtureBlock() as { gameId?: number };
    delete raw.gameId;
    const rec = buildGameRecord(raw, ME, NOW);
    expect(rec?.gameId).toBeNull();
    expect(rec?.win).toBe(false);
  });
});

describe("appendGameRecord", () => {
  function tmpHistory(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-history-"));
    return path.join(dir, "history", "games.jsonl"); // parent dir must be created
  }

  function record(gameId: number | null): GameRecord {
    return buildGameRecord(
      { ...(fixtureBlock() as object), gameId: gameId ?? undefined },
      ME,
      NOW,
    ) as GameRecord;
  }

  it("creates the directory and appends one JSON line per game", () => {
    const file = tmpHistory();
    expect(appendGameRecord(file, record(1))).toBe("appended");
    expect(appendGameRecord(file, record(2))).toBe("appended");
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).gameId).toBe(1);
    expect(JSON.parse(lines[1]).gameId).toBe(2);
  });

  it("refuses a duplicate gameId (reconnect on the end-of-game screen)", () => {
    const file = tmpHistory();
    expect(appendGameRecord(file, record(42))).toBe("appended");
    expect(appendGameRecord(file, record(42))).toBe("duplicate");
    expect(fs.readFileSync(file, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("still appends records without a gameId, and past corrupt lines", () => {
    const file = tmpHistory();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{not json}\n");
    expect(appendGameRecord(file, record(null))).toBe("appended");
    expect(appendGameRecord(file, record(null))).toBe("appended");
    expect(fs.readFileSync(file, "utf8").trim().split("\n")).toHaveLength(3);
  });
});

describe("appendPlanRecord", () => {
  it("appends every plan without dedupe (each attempt is data)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-plans-"));
    const file = path.join(dir, "history", "plans.jsonl");
    const record = {
      archivedAt: NOW,
      stage: 2 as const,
      model: "claude-opus-5",
      effort: "low",
      msToComplete: 9200,
      allies: ["Qiyana"],
      enemies: ["Lee Sin"],
      text: "## WIN CONDITION\nplay the map",
    };
    appendPlanRecord(file, record);
    appendPlanRecord(file, record);
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ model: "claude-opus-5", stage: 2 });
  });
});

describe("describeRecord", () => {
  it("summarizes the game for the console", () => {
    const line = describeRecord(buildGameRecord(richBlock(), ME, NOW) as GameRecord);
    expect(line).toContain("777");
    expect(line).toContain("W");
    expect(line).toContain("8/3/4");
    expect(line).toContain("Qiyana");
    expect(line).toContain("KP 60%");
    expect(line).toContain("3 control wards");
  });
});
