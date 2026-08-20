// The session gate: the stop-loss rule from the coach profile, enforced as
// overlay UI. Advisory by design — it never touches the queue or declines
// anything (input automation is both against Riot's third-party rules and
// not the point; the escape hatch is restarting the app, which is exactly
// the deliberate pause the rule wants).
//
// Rules (from coach/diagnosis.md, focus area "Stop-loss the session"):
// - Two consecutive ranked losses  -> gate CLOSED for this app session.
// - Any "rough game" — a loss with (kills+assists) <= deaths, any queue —
//   -> 15-minute COOLDOWN before the next queue.
// - A ranked win reopens everything (if you queued through the gate and
//   won anyway, the rule resets rather than nags).

import type { GameResult } from "../types";

export type GateStatus =
  | { state: "open" }
  | { state: "cooldown"; untilTs: number; reason: string }
  | { state: "closed"; reason: string };

export const GATE_COOLDOWN_MS = 15 * 60_000;

export function isRoughGame(result: GameResult): boolean {
  return !result.win && result.kills + result.assists <= result.deaths;
}

export class SessionGate {
  private rankedLossStreak = 0;
  private status: GateStatus = { state: "open" };

  constructor(
    private readonly cooldownMs: number = GATE_COOLDOWN_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Feed one finished game; returns the resulting gate status. */
  record(result: GameResult): GateStatus {
    if (result.win) {
      if (result.ranked) this.rankedLossStreak = 0;
      this.status = { state: "open" };
      return this.current();
    }

    if (result.ranked) this.rankedLossStreak += 1;

    if (this.rankedLossStreak >= 2) {
      this.status = {
        state: "closed",
        reason: `${this.rankedLossStreak} straight ranked losses — done for today (your rule). Restart Shotcaller to override.`,
      };
    } else if (isRoughGame(result) && this.status.state !== "closed") {
      this.status = {
        state: "cooldown",
        untilTs: this.now() + this.cooldownMs,
        reason:
          "Rough one. 15-minute reset before the next queue — write one line about what happened.",
      };
    }
    return this.current();
  }

  /** Current status, resolving expired cooldowns to open. */
  current(): GateStatus {
    if (this.status.state === "cooldown" && this.status.untilTs <= this.now()) {
      this.status = { state: "open" };
    }
    return this.status;
  }
}
