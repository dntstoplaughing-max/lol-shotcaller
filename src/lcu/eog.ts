// Parse the LCU end-of-game stats block (/lol-end-of-game/v1/eog-stats-block)
// into a GameResult. The payload shape drifts across client versions, so this
// is deliberately defensive: return null rather than guess.

import type { CurrentSummoner, GameResult } from "../types";

interface EogPlayer {
  summonerId?: number;
  puuid?: string;
  stats?: Record<string, unknown>;
}

interface EogTeam {
  isWinningTeam?: boolean;
  players?: EogPlayer[];
}

interface EogStatsBlock {
  queueId?: number;
  queueType?: string;
  localPlayer?: EogPlayer;
  teams?: EogTeam[];
}

function stat(stats: Record<string, unknown> | undefined, keys: string[]): number | null {
  for (const key of keys) {
    const value = stats?.[key];
    if (typeof value === "number") return value;
  }
  return null;
}

function isMe(player: EogPlayer, me: CurrentSummoner | null): boolean {
  if (!me) return false;
  return Boolean(
    (me.summonerId && player.summonerId === me.summonerId) ||
      (me.puuid && player.puuid === me.puuid),
  );
}

export function parseEogStats(
  raw: unknown,
  me: CurrentSummoner | null,
): GameResult | null {
  if (!raw || typeof raw !== "object") return null;
  const block = raw as EogStatsBlock;
  const teams = block.teams ?? [];

  let local = block.localPlayer ?? null;
  let localTeam: EogTeam | null = null;
  for (const team of teams) {
    for (const player of team.players ?? []) {
      if ((local && player === local) || isMe(player, me)) {
        localTeam = team;
        if (!local) local = player;
      }
    }
  }
  if (!local) return null;

  const kills = stat(local.stats, ["CHAMPIONS_KILLED", "kills"]);
  const deaths = stat(local.stats, ["NUM_DEATHS", "deaths"]);
  const assists = stat(local.stats, ["ASSISTS", "assists"]);
  if (kills === null || deaths === null || assists === null) return null;

  let win: boolean | null = null;
  if (localTeam && typeof localTeam.isWinningTeam === "boolean") {
    win = localTeam.isWinningTeam;
  } else {
    const winStat = stat(local.stats, ["WIN", "win"]);
    if (winStat !== null) win = winStat === 1;
  }
  if (win === null) return null;

  const ranked =
    block.queueId === 420 ||
    block.queueId === 440 ||
    (typeof block.queueType === "string" &&
      block.queueType.toUpperCase().startsWith("RANKED"));

  return { ranked, win, kills, deaths, assists };
}
