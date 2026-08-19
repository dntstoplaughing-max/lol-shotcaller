import { describe, expect, it } from "vitest";
import {
  buildStage1Message,
  buildStage2Message,
  RUBRIC,
} from "../src/planner/prompt";
import type { PlanInput } from "../src/types";

const input: PlanInput = {
  queue: "Ranked Solo/Duo",
  allies: [
    { championId: 54, championName: "Malphite", position: "top", isMe: false },
    { championId: 254, championName: "Vi", position: "jungle", isMe: false },
    { championId: 103, championName: "Ahri", position: "middle", isMe: true },
    { championId: 222, championName: "Jinx", position: "bottom", isMe: false },
    { championId: 412, championName: "Thresh", position: "utility", isMe: false },
  ],
  enemies: [
    { championId: 122, championName: "Darius", position: "top", isMe: false },
    { championId: 64, championName: "Lee Sin", position: "jungle", isMe: false },
    { championId: 134, championName: "Syndra", position: "middle", isMe: false },
    { championId: 51, championName: "Caitlyn", position: "bottom", isMe: false },
    { championId: 89, championName: "Leona", position: "utility", isMe: false },
  ],
  bans: ["Zed", "Yasuo"],
  me: { championId: 103, championName: "Ahri", position: "middle", isMe: true },
};

describe("rubric", () => {
  it("is long enough for the prompt-cache minimum (~1024 tokens)", () => {
    // ~4 chars/token; the cache silently no-ops below the minimum prefix,
    // which would put the full rubric cost on the latency-critical call.
    expect(RUBRIC.length).toBeGreaterThan(4500);
  });

  it("pins the exact section headers both stages must emit", () => {
    for (const header of [
      "## WIN CONDITION",
      "## YOUR LANE",
      "## THREATS",
      "## ITEMS",
      "## MID GAME",
      "## LATE GAME",
      "## IF BEHIND",
      "## COMP IDENTITY",
      "## YOUR JOB",
      "## PLAN SKETCH",
    ]) {
      expect(RUBRIC).toContain(header);
    }
  });
});

describe("stage 1 message", () => {
  it("names the roster, the player, and the bans — but no enemies", () => {
    const msg = buildStage1Message(input);
    expect(msg).toContain("Ahri");
    expect(msg).toContain("THIS IS THE PLAYER");
    expect(msg).toContain("Zed, Yasuo");
    expect(msg).toContain("Enemy picks are hidden");
    expect(msg).not.toContain("Darius");
  });
});

describe("stage 2 message", () => {
  it("includes both rosters and the player marker", () => {
    const msg = buildStage2Message(input, null);
    expect(msg).toContain("Our team:");
    expect(msg).toContain("Enemy team:");
    expect(msg).toContain("Darius");
    expect(msg).toContain("Leona");
    expect(msg).toContain("THIS IS THE PLAYER");
    expect(msg).not.toContain("ally-side analysis");
  });

  it("carries the stage-1 brief forward when available", () => {
    const msg = buildStage2Message(input, "## COMP IDENTITY\nfront to back");
    expect(msg).toContain("ally-side analysis");
    expect(msg).toContain("front to back");
  });
});
