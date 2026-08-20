// Zero-upkeep housekeeping: the pure logic behind "the app remembers so the
// player doesn't" — overlay position restore, and counting finished games
// against the coach profile's generatedAt stamp. Kept free of Electron/fs so
// it unit-tests like the rest of the pure modules.

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// A saved position is only trusted if the overlay's drag handle (its header
// strip) is still reachable: at least this much of the top of the window must
// land on some display's work area. Monitors get unplugged/rearranged between
// sessions; a stranded off-screen overlay with no taskbar entry would be
// invisible AND ungrabbable.
const MIN_VISIBLE_W = 80;
const HEADER_STRIP_H = 40;

/** Parse the persisted overlay position file; null on any malformed input. */
export function parseSavedPosition(raw: string | null): Point | null {
  if (!raw) return null;
  try {
    const val = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (typeof val?.x === "number" && Number.isFinite(val.x) &&
        typeof val?.y === "number" && Number.isFinite(val.y)) {
      return { x: Math.round(val.x), y: Math.round(val.y) };
    }
  } catch {
    // fall through — a corrupt file just means "use the default corner"
  }
  return null;
}

/**
 * Accept a saved position only if the window's header strip lands on one of
 * the given work areas (see MIN_VISIBLE_W / HEADER_STRIP_H). Returns null
 * when the caller should fall back to the default position.
 */
export function clampToWorkAreas(
  pos: Point | null,
  size: { width: number; height: number },
  workAreas: Rect[],
): Point | null {
  if (!pos) return null;
  for (const area of workAreas) {
    const visibleW =
      Math.min(pos.x + size.width, area.x + area.width) - Math.max(pos.x, area.x);
    const stripTop = Math.max(pos.y, area.y);
    const stripBottom = Math.min(pos.y + HEADER_STRIP_H, area.y + area.height);
    if (visibleW >= MIN_VISIBLE_W && stripBottom - stripTop >= HEADER_STRIP_H) {
      return pos;
    }
  }
  return null;
}

/** After this many finished games, the coach profile is due for the INDEX.md
 *  regeneration protocol (it describes the player, and the player changes). */
export const PROFILE_STALE_GAMES = 30;

export interface ProfileGameCount {
  /** The profile's generatedAt this count belongs to; a new stamp resets it. */
  profileGeneratedAt: string;
  games: number;
}

/**
 * Bump the persisted finished-game counter. The count is keyed to the
 * profile's generatedAt stamp, so regenerating the profile (per INDEX.md)
 * restarts the count automatically — no state to clean up by hand.
 */
export function bumpGamesSinceProfile(
  raw: string | null,
  profileGeneratedAt: string,
): ProfileGameCount {
  let games = 0;
  if (raw) {
    try {
      const val = JSON.parse(raw) as Partial<ProfileGameCount>;
      if (
        val?.profileGeneratedAt === profileGeneratedAt &&
        typeof val.games === "number" &&
        Number.isInteger(val.games) &&
        val.games >= 0
      ) {
        games = val.games;
      }
    } catch {
      // corrupt counter — restart from zero rather than guessing
    }
  }
  return { profileGeneratedAt, games: games + 1 };
}

/** Overlay note shown when the git checkout is behind its upstream. */
export function updateNoteText(commitsBehind: number): string {
  const s = commitsBehind === 1 ? "" : "s";
  return (
    `Update available (${commitsBehind} new commit${s}) — ` +
    `run "npm run update", then restart Shotcaller.`
  );
}

/** Overlay note shown when the profile has PROFILE_STALE_GAMES games on it. */
export function profileStaleNoteText(games: number): string {
  return (
    `Coach profile is ${games} games old — worth regenerating ` +
    `(INDEX.md protocol) so FOCUS keeps up with your play.`
  );
}
