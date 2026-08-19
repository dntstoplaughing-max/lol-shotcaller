// The Shotcaller state machine. Feed it LCU facts (gameflow phase changes,
// champ select snapshots, game-start rosters, the in-game clock); it decides
// when to fire each planning stage and emits UI events for the overlay.
//
// Timeline it models (ranked/draft):
//   ChampSelect  — ally picks + bans stream in. When all five allies lock
//                  (timer phase FINALIZATION), fire stage 1: the ally brief.
//   GameStart    — loading screen. The gameflow session now carries both
//                  teams; fire stage 2: the full plan (aborting stage 1 if
//                  it is still streaming — its partial text is still used).
//   InProgress   — live game. The clock drives which plan section is "now".

import { EventEmitter } from "node:events";
import type {
  ChampMap,
  ChampSelectSession,
  CurrentSummoner,
  GameflowPlayer,
  GameflowSession,
  Planner,
  PlanInput,
  PlayerSlot,
  ShotcallerEvent,
  StatusState,
} from "../types";

const POSITION_LABELS: Record<string, string> = {
  top: "top",
  jungle: "jungle",
  middle: "middle",
  mid: "middle",
  bottom: "bottom",
  bot: "bottom",
  utility: "utility",
  support: "utility",
};

export class Shotcaller extends EventEmitter {
  private stage1Fired = false;
  private stage2Fired = false;
  private allyBriefText: string | null = null;
  private lastLobby: { allies: PlayerSlot[]; bans: string[] } | null = null;
  private currentAbort: AbortController | null = null;

  constructor(
    private readonly champs: ChampMap,
    private readonly planner: Planner,
    private me: CurrentSummoner | null = null,
  ) {
    super();
  }

  override emit(event: "event", payload: ShotcallerEvent): boolean {
    return super.emit(event, payload);
  }

  onEvent(listener: (evt: ShotcallerEvent) => void): void {
    this.on("event", listener);
  }

  /** Set/refresh the logged-in summoner (used to pick our side of the roster). */
  setCurrentSummoner(me: CurrentSummoner): void {
    this.me = me;
  }

  /** Publish a status line to the overlay (also used by connectors). */
  announce(state: StatusState, text: string): void {
    this.emit("event", { kind: "status", state, text });
  }

  private status(state: StatusState, text: string): void {
    this.announce(state, text);
  }

  private championName(id: number | undefined): string {
    if (!id || id <= 0) return "";
    return this.champs.get(id)?.name ?? `Champion #${id}`;
  }

  // ---------------------------------------------------------------- gameflow

  onGameflowPhase(phase: string): void {
    switch (phase) {
      case "ChampSelect":
        this.resetForNewGame();
        this.status("champselect", "Champ select — reading picks and bans…");
        break;
      case "GameStart":
        this.status("planning", "Loading screen — enemy comp incoming…");
        break;
      case "InProgress":
        if (!this.stage2Fired) {
          // App launched mid-game or events arrived out of order; the
          // connector will still push the roster via onGameStartData.
          this.status("planning", "Game in progress — building plan…");
        } else {
          this.status("live", "Live — plan follows the game clock.");
        }
        break;
      case "WaitingForStats":
      case "PreEndOfGame":
      case "EndOfGame":
        this.status("done", "Game over. GGs — plan stays up until next queue.");
        break;
      case "Lobby":
      case "Matchmaking":
      case "ReadyCheck":
      case "None":
        this.status("waiting", "Waiting for champ select…");
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------ champ select

  onChampSelect(session: ChampSelectSession): void {
    const myTeam = session.myTeam ?? [];
    if (myTeam.length === 0) return;

    const localCell = session.localPlayerCellId;
    const allies: PlayerSlot[] = myTeam.map((cell) => ({
      championId: cell.championId,
      championName: this.championName(cell.championId),
      position: POSITION_LABELS[cell.assignedPosition ?? ""] ?? "",
      isMe: cell.cellId === localCell,
    }));
    const bans = this.collectBans(session);

    this.lastLobby = { allies, bans };
    this.emit("event", { kind: "lobby", allies, bans });

    const allLocked = myTeam.every((cell) => cell.championId > 0);
    const finalizing = session.timer?.phase === "FINALIZATION";
    if (allLocked && finalizing && !this.stage1Fired) {
      this.stage1Fired = true;
      void this.runStage1({
        queue: "Ranked Solo/Duo (draft)",
        allies,
        enemies: [],
        bans,
        me: allies.find((a) => a.isMe) ?? null,
      });
    }
  }

  private collectBans(session: ChampSelectSession): string[] {
    const ids = new Set<number>();
    for (const id of session.bans?.myTeamBans ?? []) ids.add(id);
    for (const id of session.bans?.theirTeamBans ?? []) ids.add(id);
    // Some queues only expose bans through the action groups.
    for (const group of session.actions ?? []) {
      for (const action of group) {
        if (action.type === "ban" && action.completed && action.championId) {
          ids.add(action.championId);
        }
      }
    }
    return [...ids].filter((id) => id > 0).map((id) => this.championName(id));
  }

  // -------------------------------------------------------------- game start

  /**
   * Called with gameflow session gameData once the game client launches.
   * Returns true once stage 2 has been fired (now or previously), so callers
   * polling an incomplete roster know when to stop retrying.
   */
  onGameStartData(session: GameflowSession): boolean {
    if (this.stage2Fired) return true;
    const teamOne = session.gameData?.teamOne ?? [];
    const teamTwo = session.gameData?.teamTwo ?? [];
    if (teamOne.length === 0 || teamTwo.length === 0) return false;

    const mineIsTeamOne = this.mineIsTeamOne(teamOne, teamTwo);
    const myRoster = mineIsTeamOne ? teamOne : teamTwo;
    const theirRoster = mineIsTeamOne ? teamTwo : teamOne;

    const allies = this.toSlots(myRoster, true);
    const enemies = this.toSlots(theirRoster, false);
    if (enemies.every((e) => !e.championName)) return false; // roster not filled yet

    // Champ select knew our assigned roles; the game-start roster may not.
    for (const ally of allies) {
      if (ally.position) continue;
      const fromLobby = this.lastLobby?.allies.find(
        (a) => a.championId === ally.championId,
      );
      if (fromLobby) {
        ally.position = fromLobby.position;
        ally.isMe = fromLobby.isMe;
      }
    }

    this.stage2Fired = true;
    const input: PlanInput = {
      queue: session.gameData?.queue?.description ?? "Ranked Solo/Duo (draft)",
      allies,
      enemies,
      bans: this.lastLobby?.bans ?? [],
      me: allies.find((a) => a.isMe) ?? null,
    };
    this.emit("event", { kind: "matchup", allies, enemies });
    void this.runStage2(input);
    return true;
  }

  private mineIsTeamOne(
    teamOne: GameflowPlayer[],
    teamTwo: GameflowPlayer[],
  ): boolean {
    const hasMe = (team: GameflowPlayer[]): boolean =>
      team.some(
        (p) =>
          (this.me?.summonerId && p.summonerId === this.me.summonerId) ||
          (this.me?.puuid && p.puuid === this.me.puuid),
      );
    if (this.me) {
      if (hasMe(teamOne)) return true;
      if (hasMe(teamTwo)) return false;
    }
    // Fallback: whichever side shares more picks with our champ select lobby.
    const lobbyIds = new Set(
      (this.lastLobby?.allies ?? []).map((a) => a.championId),
    );
    if (lobbyIds.size > 0) {
      const overlap = (team: GameflowPlayer[]): number =>
        team.filter((p) => lobbyIds.has(p.championId ?? -1)).length;
      return overlap(teamOne) >= overlap(teamTwo);
    }
    return true; // last resort: assume teamOne
  }

  private toSlots(team: GameflowPlayer[], allySide: boolean): PlayerSlot[] {
    return team.map((p) => ({
      championId: p.championId ?? 0,
      championName: this.championName(p.championId),
      position: POSITION_LABELS[p.selectedPosition?.toLowerCase() ?? ""] ?? "",
      isMe:
        allySide &&
        Boolean(
          (this.me?.summonerId && p.summonerId === this.me.summonerId) ||
            (this.me?.puuid && p.puuid === this.me.puuid),
        ),
    }));
  }

  // ------------------------------------------------------------------- clock

  onClock(gameTimeSec: number): void {
    this.emit("event", { kind: "clock", gameTimeSec });
  }

  // ---------------------------------------------------------------- planning

  private async runStage1(input: PlanInput): Promise<void> {
    const abort = this.beginPlanning(1);
    try {
      const text = await this.planner.allyBrief(
        input,
        (t) => this.emit("event", { kind: "plan-token", stage: 1, text: t }),
        abort.signal,
      );
      this.allyBriefText = text;
      this.emit("event", { kind: "plan-done", stage: 1, full: text });
    } catch (err) {
      if (abort.signal.aborted) return; // superseded by stage 2 — expected
      this.emit("event", { kind: "plan-error", message: String(err) });
    }
  }

  private async runStage2(input: PlanInput): Promise<void> {
    const abort = this.beginPlanning(2);
    try {
      const text = await this.planner.fullPlan(
        input,
        this.usableBrief(),
        (t) => this.emit("event", { kind: "plan-token", stage: 2, text: t }),
        abort.signal,
      );
      this.emit("event", { kind: "plan-done", stage: 2, full: text });
      this.status("live", "Plan ready — good luck.");
    } catch (err) {
      if (abort.signal.aborted) return;
      this.emit("event", { kind: "plan-error", message: String(err) });
    }
  }

  private beginPlanning(stage: 1 | 2): AbortController {
    this.currentAbort?.abort();
    const abort = new AbortController();
    this.currentAbort = abort;
    this.emit("event", { kind: "plan-stage", stage });
    return abort;
  }

  /** A partial stage-1 brief is still useful context if it got far enough. */
  private usableBrief(): string | null {
    if (this.allyBriefText && this.allyBriefText.length >= 200) {
      return this.allyBriefText;
    }
    return null;
  }

  private resetForNewGame(): void {
    this.currentAbort?.abort();
    this.currentAbort = null;
    this.stage1Fired = false;
    this.stage2Fired = false;
    this.allyBriefText = null;
    this.lastLobby = null;
    this.emit("event", { kind: "reset" });
  }
}
