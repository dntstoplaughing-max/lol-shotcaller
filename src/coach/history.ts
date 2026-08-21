// Post-game archive: every finished game's end-of-game stats block, appended
// to a local JSONL history (INDEX roadmap: "local history → profile refresh
// from ground truth instead of scrapes").
//
// Design: the record carries the RAW block untouched — the EOG payload drifts
// across client versions and the profile-regeneration method recomputes every
// number adversarially, so curating fields here would silently discard
// evidence we can't know we'll need. A small derived header (win, K/D/A, KP,
// control wards…) rides along for quick greps and the console line; anything
// the header can't state confidently it omits, because `raw` is the truth.

import * as fs from "node:fs";
import * as path from "node:path";
import { parseEogStats } from "../lcu/eog";
import type { CurrentSummoner } from "../types";

export interface GameRecord {
  archivedAt: string;
  gameId: number | null;
  queueId: number | null;
  queueType: string | null;
  ranked: boolean;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  championId?: number;
  championName?: string;
  /** 0–1; present only when every teammate's kill stat is in the block. */
  killParticipation?: number;
  controlWardsBought?: number;
  cs?: number;
  visionScore?: number;
  goldEarned?: number;
  /** The untouched EOG stats block — ground truth for profile regens. */
  raw: unknown;
}

interface EogPlayer {
  summonerId?: number;
  puuid?: string;
  championId?: number;
  championName?: string;
  stats?: Record<string, unknown>;
}

interface EogTeam {
  players?: EogPlayer[];
}

function stat(stats: Record<string, unknown> | undefined, keys: string[]): number | null {
  for (const key of keys) {
    const value = stats?.[key];
    if (typeof value === "number") return value;
  }
  return null;
}

function findMyTeamAndSlot(
  block: { localPlayer?: EogPlayer; teams?: EogTeam[] },
  me: CurrentSummoner | null,
): { team: EogTeam | null; slot: EogPlayer | null } {
  for (const team of block.teams ?? []) {
    for (const player of team.players ?? []) {
      const matchesMe =
        (me?.summonerId && player.summonerId === me.summonerId) ||
        (me?.puuid && player.puuid === me.puuid);
      const matchesLocal =
        (block.localPlayer?.summonerId &&
          player.summonerId === block.localPlayer.summonerId) ||
        (block.localPlayer?.puuid && player.puuid === block.localPlayer.puuid);
      if (matchesMe || matchesLocal) return { team, slot: player };
    }
  }
  return { team: null, slot: block.localPlayer ?? null };
}

/**
 * Build an archive record from a raw EOG block. Returns null exactly when
 * parseEogStats does (garbage, remake leftovers, drifted-beyond-recognition
 * payloads) — the archive and the gate agree on what counts as a game.
 */
export function buildGameRecord(
  raw: unknown,
  me: CurrentSummoner | null,
  archivedAt: string,
): GameRecord | null {
  const result = parseEogStats(raw, me);
  if (!result) return null;
  const block = raw as {
    gameId?: unknown;
    queueId?: unknown;
    queueType?: unknown;
    localPlayer?: EogPlayer;
    teams?: EogTeam[];
  };

  const record: GameRecord = {
    archivedAt,
    gameId: typeof block.gameId === "number" ? block.gameId : null,
    queueId: typeof block.queueId === "number" ? block.queueId : null,
    queueType: typeof block.queueType === "string" ? block.queueType : null,
    ...result,
    raw,
  };

  const { team, slot } = findMyTeamAndSlot(block, me);
  const stats = slot?.stats ?? block.localPlayer?.stats;

  if (typeof slot?.championId === "number") record.championId = slot.championId;
  if (typeof slot?.championName === "string") record.championName = slot.championName;

  // Kill participation only when the whole team's kills are on record — a
  // partial sum would understate the denominator and flatter the number.
  const teammates = team?.players ?? [];
  if (teammates.length >= 2) {
    const killCounts = teammates.map((p) => stat(p.stats, ["CHAMPIONS_KILLED", "kills"]));
    if (killCounts.every((k): k is number => k !== null)) {
      const teamKills = killCounts.reduce((a, b) => a + b, 0);
      if (teamKills > 0) {
        record.killParticipation =
          Math.round(((result.kills + result.assists) / teamKills) * 1000) / 1000;
      }
    }
  }

  const controlWards = stat(stats, ["VISION_WARDS_BOUGHT_IN_GAME", "visionWardsBoughtInGame"]);
  if (controlWards !== null) record.controlWardsBought = controlWards;
  const lane = stat(stats, ["MINIONS_KILLED", "minionsKilled"]);
  const jungle = stat(stats, ["NEUTRAL_MINIONS_KILLED", "neutralMinionsKilled"]);
  if (lane !== null || jungle !== null) record.cs = (lane ?? 0) + (jungle ?? 0);
  const vision = stat(stats, ["VISION_SCORE", "visionScore"]);
  if (vision !== null) record.visionScore = vision;
  const gold = stat(stats, ["GOLD_EARNED", "goldEarned"]);
  if (gold !== null) record.goldEarned = gold;

  return record;
}

// How much of the file's tail to scan for duplicate gameIds. Cross-session
// duplicates come from reconnecting while the client still sits on the
// end-of-game screen, so the collision is always within the last few games.
const DEDUPE_TAIL_BYTES = 64 * 1024;

function recentGameIds(filePath: string): Set<number> {
  const ids = new Set<number>();
  let fd: number | null = null;
  try {
    const size = fs.statSync(filePath).size;
    const start = Math.max(0, size - DEDUPE_TAIL_BYTES);
    fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    for (const line of buf.toString("utf8").split("\n")) {
      try {
        const rec = JSON.parse(line) as { gameId?: unknown };
        if (typeof rec.gameId === "number") ids.add(rec.gameId);
      } catch {
        // partial first line of the tail window, or a corrupt line — skip
      }
    }
  } catch {
    // no file yet (or unreadable) — nothing to dedupe against
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
  return ids;
}

/** Append a record unless its gameId is already in the file's tail. */
export function appendGameRecord(
  filePath: string,
  record: GameRecord,
): "appended" | "duplicate" {
  if (record.gameId !== null && recentGameIds(filePath).has(record.gameId)) {
    return "duplicate";
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(record) + "\n");
  return "appended";
}

// ---------------------------------------------------------------- plan log

/**
 * Every generated plan, logged next to the game archive. This is how "the
 * plan felt repetitive/slow/wrong" becomes debuggable after the fact — the
 * overlay's copy dies with the app, this line doesn't. Also the receipt for
 * model A/B: each record carries the model and effort that produced it.
 */
export interface PlanLogRecord {
  archivedAt: string;
  stage: 1 | 2;
  /** Configured model ("dry-run" when no API key / --dry-run). */
  model: string;
  effort: string;
  /** Wall-clock from stage start to complete, as the player experienced it. */
  msToComplete: number | null;
  allies: string[];
  enemies: string[];
  text?: string;
  error?: string;
}

/** Append a plan record. Plans are never deduped — every attempt is data. */
export function appendPlanRecord(filePath: string, record: PlanLogRecord): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(record) + "\n");
}

/** One console line per archived game. */
export function describeRecord(record: GameRecord): string {
  const kda = `${record.kills}/${record.deaths}/${record.assists}`;
  const parts = [
    record.win ? "W" : "L",
    kda,
    record.championName ?? null,
    record.ranked ? "ranked" : (record.queueType ?? "non-ranked"),
    record.killParticipation !== undefined
      ? `KP ${Math.round(record.killParticipation * 100)}%`
      : null,
    record.controlWardsBought !== undefined
      ? `${record.controlWardsBought} control ward${record.controlWardsBought === 1 ? "" : "s"}`
      : null,
  ].filter((p): p is string => p !== null);
  return `archived game ${record.gameId ?? "?"} — ${parts.join(", ")}`;
}
