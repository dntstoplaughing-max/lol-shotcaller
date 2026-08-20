import { describe, expect, it } from "vitest";
import {
  bumpGamesSinceProfile,
  clampToWorkAreas,
  parseSavedPosition,
  PROFILE_STALE_GAMES,
  profileStaleNoteText,
  updateNoteText,
} from "../src/system/housekeeping";

const SIZE = { width: 400, height: 640 };
const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 }; // work area (taskbar clipped)
const SECOND = { x: 1920, y: -200, width: 2560, height: 1400 };

describe("parseSavedPosition", () => {
  it("accepts a well-formed position and rounds it", () => {
    expect(parseSavedPosition('{"x": 100.6, "y": 24}')).toEqual({ x: 101, y: 24 });
  });

  it("rejects null, corrupt JSON, wrong types, and non-finite values", () => {
    expect(parseSavedPosition(null)).toBeNull();
    expect(parseSavedPosition("{oops")).toBeNull();
    expect(parseSavedPosition('{"x": "12", "y": 5}')).toBeNull();
    expect(parseSavedPosition('{"y": 5}')).toBeNull();
    expect(parseSavedPosition('{"x": null, "y": 5}')).toBeNull();
  });
});

describe("clampToWorkAreas", () => {
  it("keeps a position fully on the primary display", () => {
    const pos = { x: 1496, y: 96 };
    expect(clampToWorkAreas(pos, SIZE, [PRIMARY])).toEqual(pos);
  });

  it("keeps a position on a secondary display (including negative y)", () => {
    const pos = { x: 2200, y: -100 };
    expect(clampToWorkAreas(pos, SIZE, [PRIMARY, SECOND])).toEqual(pos);
  });

  it("rejects a position on a display that no longer exists", () => {
    // Saved while the second monitor was attached; now only the primary is.
    expect(clampToWorkAreas({ x: 2200, y: 100 }, SIZE, [PRIMARY])).toBeNull();
  });

  it("rejects a header strip pushed above the work area", () => {
    // The header is the drag handle — if it's off the top, the overlay can
    // never be grabbed again.
    expect(clampToWorkAreas({ x: 100, y: -10 }, SIZE, [PRIMARY])).toBeNull();
  });

  it("rejects a position with only a sliver visible horizontally", () => {
    expect(clampToWorkAreas({ x: 1920 - 40, y: 100 }, SIZE, [PRIMARY])).toBeNull();
  });

  it("accepts a position hanging off the bottom (header still grabbable)", () => {
    expect(clampToWorkAreas({ x: 100, y: 990 }, SIZE, [PRIMARY])).toEqual({
      x: 100,
      y: 990,
    });
  });

  it("passes through null", () => {
    expect(clampToWorkAreas(null, SIZE, [PRIMARY])).toBeNull();
  });
});

describe("bumpGamesSinceProfile", () => {
  const STAMP = "2026-08-20";

  it("starts at 1 with no prior counter", () => {
    expect(bumpGamesSinceProfile(null, STAMP)).toEqual({
      profileGeneratedAt: STAMP,
      games: 1,
    });
  });

  it("increments an existing counter for the same profile stamp", () => {
    const first = bumpGamesSinceProfile(null, STAMP);
    const second = bumpGamesSinceProfile(JSON.stringify(first), STAMP);
    expect(second.games).toBe(2);
  });

  it("resets when the profile was regenerated (new stamp)", () => {
    const old = JSON.stringify({ profileGeneratedAt: "2026-05-01", games: 44 });
    expect(bumpGamesSinceProfile(old, STAMP)).toEqual({
      profileGeneratedAt: STAMP,
      games: 1,
    });
  });

  it("resets on corrupt or nonsensical counter data", () => {
    expect(bumpGamesSinceProfile("{oops", STAMP).games).toBe(1);
    expect(
      bumpGamesSinceProfile(
        JSON.stringify({ profileGeneratedAt: STAMP, games: -3 }),
        STAMP,
      ).games,
    ).toBe(1);
    expect(
      bumpGamesSinceProfile(
        JSON.stringify({ profileGeneratedAt: STAMP, games: 2.7 }),
        STAMP,
      ).games,
    ).toBe(1);
  });

  it("reaches the stale threshold after PROFILE_STALE_GAMES bumps", () => {
    let raw: string | null = null;
    let count = 0;
    for (let i = 0; i < PROFILE_STALE_GAMES; i++) {
      const bumped = bumpGamesSinceProfile(raw, STAMP);
      raw = JSON.stringify(bumped);
      count = bumped.games;
    }
    expect(count).toBe(PROFILE_STALE_GAMES);
  });
});

describe("nudge texts", () => {
  it("update note names the command and pluralizes", () => {
    expect(updateNoteText(1)).toContain("(1 new commit)");
    expect(updateNoteText(3)).toContain("(3 new commits)");
    expect(updateNoteText(3)).toContain("npm run update");
  });

  it("profile note names the game count and the protocol", () => {
    const text = profileStaleNoteText(34);
    expect(text).toContain("34 games");
    expect(text).toContain("INDEX.md");
  });
});
