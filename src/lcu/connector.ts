// Real LCU wiring via league-connect.
//
// The League client runs a local HTTPS/WSS server (port + password in its
// lockfile). league-connect handles lockfile discovery, auth, and the Riot
// self-signed certificate. We subscribe to two event feeds and otherwise do
// tiny one-shot GETs — no polling of the client itself.
//
// This surface (the LCU API) is the same one Blitz/Porofessor/Mobalytics are
// built on: reading it is allowed; Riot's line is against memory reading,
// injection, and automation, none of which happens here.

import {
  authenticate,
  createHttp1Request,
  createWebSocketConnection,
  type Credentials,
  type LeagueWebSocket,
} from "league-connect";
import { parseEogStats } from "./eog";
import type { Shotcaller } from "../planner/state";
import type {
  ChampSelectSession,
  CurrentSummoner,
  GameflowSession,
} from "../types";
import type { LiveClientPoller } from "../liveclient/poller";

const ROSTER_RETRIES = 20;
const ROSTER_RETRY_MS = 2000;
const EOG_RETRIES = 8;
const EOG_RETRY_MS = 2000;

export interface LcuConnectorOptions {
  /**
   * Called once per finished game with the raw EOG stats block, after it
   * parsed as a real game (main.ts archives it). Failures are contained
   * here — history can never break the gate or the pipeline.
   */
  onEogStats?: (raw: unknown, me: CurrentSummoner | null) => void;
}

export class LcuConnector {
  private credentials: Credentials | null = null;
  private me: CurrentSummoner | null = null;
  private pullingRoster = false;
  private eogHandled = false;

  constructor(
    private readonly sc: Shotcaller,
    private readonly poller: LiveClientPoller,
    private readonly opts: LcuConnectorOptions = {},
  ) {}

  /** Runs forever: (re)connects whenever the League client (re)starts. */
  async start(): Promise<void> {
    for (;;) {
      this.sc.announce("waiting", "Waiting for the League client…");
      try {
        this.credentials = await authenticate({
          awaitConnection: true,
          pollInterval: 2500,
        });
        const ws = await createWebSocketConnection({
          authenticationOptions: { awaitConnection: true },
          pollInterval: 1000,
          maxRetries: 60,
        });
        this.sc.announce("waiting", "Connected to the League client.");
        await this.hydrateCurrentSummoner();
        this.subscribe(ws);
        await this.syncCurrentState();
        await new Promise<void>((resolve) => ws.on("close", () => resolve()));
        this.poller.stop();
        this.sc.announce("waiting", "League client closed — waiting…");
      } catch (err) {
        this.sc.announce("waiting", `LCU connection retry: ${String(err)}`);
        await sleep(3000);
      }
    }
  }

  private subscribe(ws: LeagueWebSocket): void {
    ws.subscribe("/lol-gameflow/v1/gameflow-phase", (data) => {
      if (typeof data === "string") this.handlePhase(data);
    });
    ws.subscribe("/lol-champ-select/v1/session", (data) => {
      // Champ-select exit arrives as a delete event with null data.
      if (!data) return;
      this.sc.onChampSelect(data as ChampSelectSession);
    });
  }

  private handlePhase(phase: string): void {
    this.sc.onGameflowPhase(phase);
    if (phase === "GameStart" || phase === "InProgress") {
      void this.pullRosterUntilPlanned();
    }
    if (phase === "InProgress") {
      this.poller.start();
    }
    if (["WaitingForStats", "PreEndOfGame", "EndOfGame", "None"].includes(phase)) {
      this.poller.stop();
    }
    if (phase === "WaitingForStats" || phase === "PreEndOfGame" || phase === "EndOfGame") {
      void this.pullEndOfGame();
    }
    if (["ChampSelect", "Lobby", "Matchmaking", "ReadyCheck"].includes(phase)) {
      this.eogHandled = false; // next game's stats are fair game again
    }
  }

  /** Feed the finished game's result into the session gate. */
  private async pullEndOfGame(): Promise<void> {
    if (this.eogHandled) return;
    this.eogHandled = true;
    for (let attempt = 0; attempt < EOG_RETRIES; attempt++) {
      const raw = await this.lcuGet<unknown>("/lol-end-of-game/v1/eog-stats-block");
      const result = raw ? parseEogStats(raw, this.me) : null;
      if (result) {
        try {
          this.opts.onEogStats?.(raw, this.me);
        } catch (err) {
          console.log(`[history] archive hook failed: ${String(err)}`);
        }
        this.sc.onGameResult(result);
        return;
      }
      await sleep(EOG_RETRY_MS);
    }
    // Stats never materialized (remake, client quirk) — the gate just skips
    // this game rather than guessing.
  }

  /** On (re)connect, jump to wherever the client already is. */
  private async syncCurrentState(): Promise<void> {
    const phase = await this.lcuGet<string>("/lol-gameflow/v1/gameflow-phase");
    if (typeof phase === "string" && phase.length > 0) {
      if (phase === "ChampSelect") {
        const session = await this.lcuGet<ChampSelectSession>(
          "/lol-champ-select/v1/session",
        );
        if (session) this.sc.onChampSelect(session);
      }
      this.handlePhase(phase);
    }
  }

  /**
   * The gameflow session's roster fills in as the loading screen starts;
   * retry until the state machine confirms stage 2 fired.
   */
  private async pullRosterUntilPlanned(): Promise<void> {
    if (this.pullingRoster) return;
    this.pullingRoster = true;
    try {
      for (let attempt = 0; attempt < ROSTER_RETRIES; attempt++) {
        const session = await this.lcuGet<GameflowSession>(
          "/lol-gameflow/v1/session",
        );
        if (session && this.sc.onGameStartData(session)) return;
        await sleep(ROSTER_RETRY_MS);
      }
      this.sc.announce(
        "error",
        "Couldn't read the game roster from the client.",
      );
    } finally {
      this.pullingRoster = false;
    }
  }

  private async hydrateCurrentSummoner(): Promise<void> {
    const me = await this.lcuGet<CurrentSummoner>(
      "/lol-summoner/v1/current-summoner",
    );
    if (me) {
      this.me = me;
      this.sc.setCurrentSummoner(me);
    }
  }

  private async lcuGet<T>(url: string): Promise<T | null> {
    if (!this.credentials) return null;
    try {
      const response = await createHttp1Request(
        { method: "GET", url },
        this.credentials,
      );
      return response.json() as T;
    } catch {
      return null;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
