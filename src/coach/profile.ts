// The coach profile: the player's verified long-term tendencies, produced by
// an offline multi-agent diagnosis of their public ranked history (see
// coach/diagnosis.md). When coach/profile.json exists, every game plan is
// personalized: plan directives steer each section, and the plan gains a
// final ## FOCUS section naming the leaks this specific game will test.

import * as fs from "node:fs";

export interface FocusArea {
  /** The long-term leak, e.g. "keeps fighting through mid-game deficits". */
  leak: string;
  /** The numbers behind it, for the player's benefit. */
  evidence?: string;
  /** The in-game moment when the leak fires, e.g. "first death before 6". */
  inGameCue?: string;
  /** Standing instruction to the coach preparing any single game. */
  planDirective: string;
}

export interface CoachProfile {
  riotId?: string;
  region?: string;
  rank?: string;
  sampleSize?: string;
  /** Two sentences on who this player is on the Rift. */
  summary?: string;
  /** One line: how this player tries to win. */
  identity?: string;
  focusAreas: FocusArea[];
  /** One-line note per pool champion. */
  championNotes?: Record<string, string>;
  /**
   * The agreed ranked pool plan: default to main; switch to stabilizer when
   * the comp needs frontline or the main is unavailable. Drives champ-select
   * pick hints and is stated to the planner.
   */
  pool?: { main?: string; stabilizer?: string };
  caveats?: string;
  generatedAt?: string;
}

/** Load and minimally validate a profile; null (never throw) on any problem. */
export function loadCoachProfile(filePath: string): CoachProfile | null {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as CoachProfile;
    if (!Array.isArray(raw.focusAreas) || raw.focusAreas.length === 0) {
      return null;
    }
    if (!raw.focusAreas.every((f) => f?.leak && f?.planDirective)) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

/**
 * Format the profile as the PLAYER PROFILE block the rubric knows how to
 * coach against. Lives in the (uncached) user message, so profile edits
 * never invalidate the cached system rubric.
 */
export function profilePromptBlock(profile: CoachProfile): string {
  const lines: string[] = [];
  lines.push(
    "PLAYER PROFILE (verified long-term tendencies from this player's ranked history — coach against these):",
  );
  if (profile.identity) lines.push(`Identity: ${profile.identity}`);
  if (profile.summary) lines.push(`Summary: ${profile.summary}`);
  if (profile.pool?.main) {
    const stab = profile.pool.stabilizer
      ? `; switches to ${profile.pool.stabilizer} when the team lacks frontline or the main is unavailable`
      : "";
    lines.push(
      `Ranked pool plan: mains ${profile.pool.main}${stab}. Coach the chosen champion accordingly.`,
    );
  }
  profile.focusAreas.forEach((f, i) => {
    lines.push(`${i + 1}. Leak: ${f.leak}`);
    if (f.inGameCue) lines.push(`   Fires when: ${f.inGameCue}`);
    lines.push(`   Plan directive: ${f.planDirective}`);
  });
  const notes = Object.entries(profile.championNotes ?? {});
  if (notes.length > 0) {
    lines.push("Champion pool notes:");
    for (const [champ, note] of notes) lines.push(`- ${champ}: ${note}`);
  }
  return lines.join("\n");
}
