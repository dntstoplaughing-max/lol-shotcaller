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
import { SessionGate, type GateStatus } from "../coach/gate";
import type { CoachProfile } from "../coach/profile";
import type {
  ChampMap,
  ChampSelectSession,
  CurrentSummoner,
  GameflowPlayer,
  GameflowSession,
  GameResult,
  Planner,
  PlanInput,
  PlayerSlot,
  ShotcallerEvent,
  StatusState,
} from "../types";

export interface ShotcallerOptions {
  /** Coach profile, used for champ-select pick hints (pool plan). */
  profile?: CoachProfile | null;
  /** Champ-select pick hints on/off (default on). */
  hints?: boolean;
  /** Session stop-loss gate on/off (default on). */
  gate?: boolean;
}

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
  private me: CurrentSummoner | null = null;
  private readonly profile: CoachProfile | null;
  private readonly hintsEnabled: boolean;
  private readonly gate: SessionGate | null;
  private lastHint: string | null = null;

  constructor(
    private readonly champs: ChampMap,
    private readonly planner: Planner,
    options: ShotcallerOptions = {},
  ) {
    super();
    this.profile = options.profile ?? null;
    this.hintsEnabled = options.hints !== false;
    this.gate = options.gate !== false ? new SessionGate() : null;
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
        this.emitGate(); // re-surface a closed/cooldown gate on a new queue
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
    const banIds = this.collectBanIds(session);
    const bans = banIds.map((id) => this.championName(id));

    this.lastLobby = { allies, bans };
    this.emit("event", { kind: "lobby", allies, bans });
    this.updatePickHint(session, allies, banIds);

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

  private collectBanIds(session: ChampSelectSession): number[] {
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
    return [...ids].filter((id) => id > 0);
  }

  // -------------------------------------------------------------- pick hints

  private championIdByName(name: string): number | null {
    const wanted = name.toLowerCase();
    for (const [id, info] of this.champs) {
      if (info.name.toLowerCase() === wanted) return id;
    }
    return null;
  }

  /**
   * Live champ-select advice from the profile's pool plan: is the main
   * available, and does the comp taking shape need the stabilizer instead?
   * Frontline detection is a heuristic (Data Dragon "Tank" tag).
   */
  private computePickHint(
    session: ChampSelectSession,
    allies: PlayerSlot[],
    banIds: number[],
  ): string | null {
    const me = allies.find((a) => a.isMe);
    if (!me || me.championId > 0) return null; // already locked — hint is moot

    const mainName = this.profile?.pool?.main;
    const stabName = this.profile?.pool?.stabilizer;
    const mainId = mainName ? this.championIdByName(mainName) : null;

    if (mainId) {
      const lockStab = stabName ? `lock ${stabName}` : "pick a frontline jungler";
      if (banIds.includes(mainId)) {
        return `${mainName} is banned — stabilizer game: ${lockStab}.`;
      }
      if (allies.some((a) => !a.isMe && a.championId === mainId)) {
        return `${mainName} is taken — stabilizer game: ${lockStab}.`;
      }
    }

    const locked = allies.filter((a) => !a.isMe && a.championId > 0);
    if (locked.length < 2) return null; // too early to read the comp
    const hasFrontline = locked.some((a) =>
      this.champs.get(a.championId)?.tags?.includes("Tank"),
    );
    if (!hasFrontline) {
      return stabName
        ? `No frontline locked yet — lean ${stabName}.`
        : "No frontline locked yet — consider a tank/engage pick.";
    }
    return mainName ? `Frontline covered — ${mainName} game.` : null;
  }

  private updatePickHint(
    session: ChampSelectSession,
    allies: PlayerSlot[],
    banIds: number[],
  ): void {
    if (!this.hintsEnabled) return;
    const hint = this.computePickHint(session, allies, banIds);
    if (hint !== this.lastHint) {
      this.lastHint = hint;
      this.emit("event", { kind: "pick-hint", text: hint });
    }
  }

  // ------------------------------------------------------------ session gate

  /** Feed a finished game's outcome into the stop-loss gate. */
  onGameResult(result: GameResult): void {
    // Every finished game is announced, gate or no gate — main.ts keeps the
    // games-since-profile count from it. The overlay ignores this kind.
    this.emit("event", { kind: "game-result", result });
    if (!this.gate) return;
    this.gate.record(result);
    this.emitGate();
  }

  private emitGate(): void {
    if (!this.gate) return;
    const status: GateStatus = this.gate.current();
    if (status.state === "open") {
      this.emit("event", { kind: "gate", state: "open" });
    } else if (status.state === "cooldown") {
      this.emit("event", {
        kind: "gate",
        state: "cooldown",
        reason: status.reason,
        untilTs: status.untilTs,
      });
    } else {
      this.emit("event", { kind: "gate", state: "closed", reason: status.reason });
    }
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
    this.lastHint = null;
    this.emit("event", { kind: "reset" });
  }
}
