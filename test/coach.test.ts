import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadCoachProfile,
  profilePromptBlock,
  type CoachProfile,
} from "../src/coach/profile";
import { buildStage1Message, buildStage2Message, RUBRIC } from "../src/planner/prompt";
import type { PlanInput } from "../src/types";

const profile: CoachProfile = {
  riotId: "NoRights4Laners#512",
  identity: "Snowball assassin jungler; wins by making early leads terminal.",
  summary: "High-mechanics pool, results swing on early game and mental reset.",
  focusAreas: [
    {
      leak: "Continues queueing through loss streaks",
      inGameCue: "First death before level 6",
      planDirective:
        "Every plan must include a concrete 'when behind' pivot that does not rely on outplaying.",
    },
    {
      leak: "Feast-or-famine champion pool",
      planDirective: "Name the stabilizer item breakpoint for the chosen champion.",
    },
  ],
  championNotes: { Qiyana: "1.1M mastery; the comfort pick under pressure." },
};

function tmpFile(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-coach-"));
  const file = path.join(dir, "profile.json");
  fs.writeFileSync(file, content);
  return file;
}

describe("loadCoachProfile", () => {
  it("loads a valid profile", () => {
    const loaded = loadCoachProfile(tmpFile(JSON.stringify(profile)));
    expect(loaded?.focusAreas).toHaveLength(2);
    expect(loaded?.riotId).toBe("NoRights4Laners#512");
  });

  it("returns null for missing files, junk JSON, and empty focus areas", () => {
    expect(loadCoachProfile("/nonexistent/profile.json")).toBeNull();
    expect(loadCoachProfile(tmpFile("not json"))).toBeNull();
    expect(
      loadCoachProfile(tmpFile(JSON.stringify({ focusAreas: [] }))),
    ).toBeNull();
    expect(
      loadCoachProfile(
        tmpFile(JSON.stringify({ focusAreas: [{ leak: "x" }] })), // no directive
      ),
    ).toBeNull();
  });
});

describe("profilePromptBlock", () => {
  it("formats identity, leaks, directives, and champion notes", () => {
    const block = profilePromptBlock(profile);
    expect(block).toContain("PLAYER PROFILE");
    expect(block).toContain("Snowball assassin jungler");
    expect(block).toContain("loss streaks");
    expect(block).toContain("Plan directive:");
    expect(block).toContain("Qiyana: 1.1M mastery");
  });
});

describe("profile injection into prompts", () => {
  const input: PlanInput = {
    queue: "Ranked Solo/Duo",
    allies: [
      { championId: 103, championName: "Ahri", position: "middle", isMe: true },
    ],
    enemies: [
      { championId: 122, championName: "Darius", position: "top", isMe: false },
    ],
    bans: [],
    me: { championId: 103, championName: "Ahri", position: "middle", isMe: true },
  };

  it("appears in both stages when provided, in neither when absent", () => {
    const block = profilePromptBlock(profile);
    expect(buildStage1Message(input, block)).toContain("PLAYER PROFILE");
    expect(buildStage2Message(input, null, block)).toContain("PLAYER PROFILE");
    expect(buildStage1Message(input)).not.toContain("PLAYER PROFILE");
    expect(buildStage2Message(input, null)).not.toContain("PLAYER PROFILE");
  });

  it("rubric carries the FOCUS output contract", () => {
    expect(RUBRIC).toContain("## FOCUS");
    expect(RUBRIC).toContain("PLAYER PROFILE");
  });
});
