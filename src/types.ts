// Shared domain types for Shotcaller.

/** Champion id -> display info, built from Data Dragon. */
export type ChampMap = Map<number, ChampInfo>;

export interface ChampInfo {
  /** Data Dragon string id, e.g. "Aatrox" */
  id: string;
  /** Display name, e.g. "Aatrox" */
  name: string;
  /** e.g. "the Darkin Blade" */
  title: string;
  /** Data Dragon class tags, e.g. ["Fighter", "Tank"] */
  tags: string[];
}

/** One player slot as known during champ select or at game start. */
export interface PlayerSlot {
  championId: number;
  championName: string;
  /** top | jungle | middle | bottom | utility | "" when unknown */
  position: string;
  isMe: boolean;
}

/** What we know about the game so far — input to the planner. */
export interface PlanInput {
  queue: string;
  allies: PlayerSlot[];
  enemies: PlayerSlot[];
  bans: string[];
  /** The user's own slot, when known. */
  me: PlayerSlot | null;
}

/** Events emitted by the Shotcaller state machine, consumed by the overlay. */
export type ShotcallerEvent =
  | { kind: "status"; text: string; state: StatusState }
  | { kind: "lobby"; allies: PlayerSlot[]; bans: string[] }
  | { kind: "matchup"; allies: PlayerSlot[]; enemies: PlayerSlot[] }
  | { kind: "plan-stage"; stage: 1 | 2 }
  | { kind: "plan-token"; stage: 1 | 2; text: string }
  | { kind: "plan-done"; stage: 1 | 2; full: string }
  | { kind: "plan-error"; message: string }
  | { kind: "clock"; gameTimeSec: number }
  | { kind: "reset" };

export type StatusState =
  | "waiting"
  | "champselect"
  | "planning"
  | "live"
  | "done"
  | "error";

/** Minimal shape of the LCU champ select session we consume. */
export interface ChampSelectSession {
  localPlayerCellId?: number;
  myTeam?: ChampSelectCell[];
  theirTeam?: ChampSelectCell[];
  bans?: { myTeamBans?: number[]; theirTeamBans?: number[] };
  actions?: ChampSelectAction[][];
  timer?: { phase?: string };
}

export interface ChampSelectCell {
  cellId: number;
  championId: number;
  assignedPosition?: string;
  summonerId?: number;
  puuid?: string;
}

export interface ChampSelectAction {
  type?: string;
  championId?: number;
  completed?: boolean;
  isAllyAction?: boolean;
}

/** Minimal shape of the LCU gameflow session we consume. */
export interface GameflowSession {
  phase?: string;
  gameData?: {
    queue?: { id?: number; description?: string };
    teamOne?: GameflowPlayer[];
    teamTwo?: GameflowPlayer[];
  };
}

export interface GameflowPlayer {
  championId?: number;
  summonerId?: number;
  puuid?: string;
  summonerName?: string;
  gameName?: string;
  selectedPosition?: string;
}

export interface CurrentSummoner {
  summonerId?: number;
  puuid?: string;
  gameName?: string;
  displayName?: string;
}

/** The planner contract. ClaudePlanner implements it; DryRunPlanner fakes it. */
export interface Planner {
  /** Stage 1: ally-side brief, fired when our five picks lock in champ select. */
  allyBrief(
    input: PlanInput,
    onToken: (text: string) => void,
    signal: AbortSignal,
  ): Promise<string>;
  /** Stage 2: full plan, fired at loading screen when all ten champs are known. */
  fullPlan(
    input: PlanInput,
    allyBrief: string | null,
    onToken: (text: string) => void,
    signal: AbortSignal,
  ): Promise<string>;
}
