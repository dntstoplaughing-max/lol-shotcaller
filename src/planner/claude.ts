// The Claude-backed planner (plus a dry-run stand-in used in tests, CI, and
// when no API key is configured).
//
// Latency notes, because the whole point is fitting the loading screen:
// - Both stages share one system rubric with a 1h-TTL cache breakpoint. The
//   stage-1 call (fired ~a minute earlier in champ select) writes the cache;
//   stage 2 reads it, cutting time-to-first-token and cost.
// - Streaming: tokens hit the overlay as they arrive; the full plan lands in
//   seconds while the loading screen runs 30-60s.
// - Default effort is "low": the rubric makes the task formulaic, and lower
//   effort means less pre-answer reasoning latency. Raise SHOTCALLER_EFFORT
//   if you would rather trade seconds for depth.

import * as path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { loadCoachProfile, profilePromptBlock } from "../coach/profile";
import type { Planner, PlanInput } from "../types";
import { buildStage1Message, buildStage2Message, RUBRIC } from "./prompt";

const DEFAULT_MODEL = "claude-opus-5";

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

export class ClaudePlanner implements Planner {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly effort: "low" | "medium" | "high";
  private readonly profileBlock: string | null;

  constructor() {
    this.client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
    this.model = process.env.SHOTCALLER_MODEL || DEFAULT_MODEL;
    const effort = process.env.SHOTCALLER_EFFORT;
    this.effort =
      effort === "medium" || effort === "high" ? effort : "low";

    // Personal coaching profile (see coach/README in the repo). Lives in the
    // user message, so it never invalidates the cached system rubric.
    const profilePath =
      process.env.SHOTCALLER_PROFILE ||
      path.resolve(process.cwd(), "coach/profile.json");
    const profile = loadCoachProfile(profilePath);
    this.profileBlock = profile ? profilePromptBlock(profile) : null;
    if (profile) {
      console.log(
        `[planner] coach profile loaded (${profile.focusAreas.length} focus areas) from ${profilePath}`,
      );
    }
  }

  allyBrief(
    input: PlanInput,
    onToken: (text: string) => void,
    signal: AbortSignal,
  ): Promise<string> {
    return this.run(
      buildStage1Message(input, this.profileBlock),
      3000,
      onToken,
      signal,
    );
  }

  fullPlan(
    input: PlanInput,
    allyBrief: string | null,
    onToken: (text: string) => void,
    signal: AbortSignal,
  ): Promise<string> {
    return this.run(
      buildStage2Message(input, allyBrief, this.profileBlock),
      envInt("SHOTCALLER_MAX_PLAN_TOKENS", 4000),
      onToken,
      signal,
    );
  }

  private async run(
    userMessage: string,
    maxTokens: number,
    onToken: (text: string) => void,
    signal: AbortSignal,
  ): Promise<string> {
    const startedAt = Date.now();
    // Effort is supported on the Opus 4.6+/Sonnet 4.6+/Opus 5/Fable 5 line;
    // refusal fallbacks exist on Opus 5/Fable 5. Older/smaller models
    // (e.g. claude-haiku-4-5 via SHOTCALLER_MODEL) get a plain request.
    const supportsEffort =
      /claude-(fable-5|opus-5|sonnet-5|opus-4-[678]|sonnet-4-6)/.test(
        this.model,
      );
    const supportsFallbacks = /claude-(opus-5|fable-5)/.test(this.model);

    const stream = this.client.beta.messages.stream(
      {
        model: this.model,
        max_tokens: maxTokens,
        ...(supportsEffort
          ? { output_config: { effort: this.effort } }
          : {}),
        ...(supportsFallbacks
          ? {
              betas: ["server-side-fallback-2026-06-01"],
              fallbacks: [{ model: "claude-opus-4-8" }],
            }
          : {}),
        system: [
          {
            type: "text",
            text: RUBRIC,
            cache_control: { type: "ephemeral", ttl: "1h" },
          },
        ],
        messages: [{ role: "user", content: userMessage }],
      },
      { signal },
    );

    stream.on("text", (delta) => onToken(delta));

    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      throw new Error("The model declined to produce a plan for this input.");
    }

    const usage = final.usage;
    console.log(
      `[planner] ${this.model} ms=${Date.now() - startedAt} ` +
        `out=${usage.output_tokens} ` +
        `cache_read=${usage.cache_read_input_tokens ?? 0} ` +
        `cache_write=${usage.cache_creation_input_tokens ?? 0}`,
    );

    return final.content
      .filter(
        (block): block is Extract<typeof block, { type: "text" }> =>
          block.type === "text",
      )
      .map((block) => block.text)
      .join("");
  }
}

// --------------------------------------------------------------------------

const DRY_RUN_BRIEF = `## COMP IDENTITY
Front-to-back teamfight comp with a hard-engage tank line and two hypercarry scalers.
Natural win condition: reach two items on the carries, then force 5v5s on objective spawns.

## YOUR JOB
- Laning: farm safely, punish only free trades; your comp does not need you to snowball.
- Mid game: rotate on your engage tank's timers; you are the follow-up burst.
- Late game: peel decisions decide fights — hold cooldowns for their dive.

## PLAN SKETCH
- Concede early skirmishes rather than coin-flip; scale to item spikes.
- Group by 20 minutes; take fights only through your engage.
- Ward defensively until the comp comes online.`;

const DRY_RUN_PLAN = `## WIN CONDITION
Survive the early game without feeding their snowball lanes, then force grouped fights after two items — your comp wins every clean 5v5 from 20 minutes on.

## YOUR LANE
- Trade only when their jungler shows elsewhere; your matchup loses extended trades before level 6.
- Your spike windows: level 6 and first completed item. Theirs: level 3 and level 9 — do not fight inside them.
- Keep the wave near your side until you have lane priority; crash before backing.
- Roam danger is real: their mid pushes and moves — ping and match through the map, not the river.

## THREATS
- Enemy jungler — early-game ganker, spikes on first clear; ward the river brush by 2:50.
- Enemy mid — burst assassin, spikes at 6; hold your dash until their engage is down.
- Enemy top — extended-trade bully; never fight in their minion wave.
- Enemy ADC — scaling hypercarry; end before four items or dive them first in fights.
- Enemy support — engage initiator; track their roams when the wave is pushed.

## ITEMS
- Heavy healing on two of their champions: antiheal on your second item.
- Their kill threat is a single spell chain: consider cleanse or a QSS pivot.
- Fed AD threat: slot an armor component early, even off-build.

## MID GAME
- Group as five from 14 minutes; your comp outfights theirs when nobody is caught.
- Trade the first baron dance for bot-side waves and dragons.
- Play through your engage tank; do not start fights yourself.

## LATE GAME
- One death loses the game past 30 minutes — clear vision as five before every objective.
- Force nothing: your comp wins stalled games; let them make the mistake.

## IF BEHIND
Trade map pressure for time: give uncontested objectives, defend towers as five, and scale — your comp outperforms theirs at full build regardless of gold deficit.`;

/**
 * Used when no ANTHROPIC_API_KEY is set, under --dry-run, in tests, and in
 * CI: streams a canned but structurally-correct plan so the whole pipeline
 * (state machine -> events -> overlay parsing) can run without the API.
 */
export class DryRunPlanner implements Planner {
  constructor(private readonly chunkDelayMs: number = 4) {}

  async allyBrief(
    _input: PlanInput,
    onToken: (text: string) => void,
    signal: AbortSignal,
  ): Promise<string> {
    return this.stream(DRY_RUN_BRIEF, onToken, signal);
  }

  async fullPlan(
    _input: PlanInput,
    _allyBrief: string | null,
    onToken: (text: string) => void,
    signal: AbortSignal,
  ): Promise<string> {
    return this.stream(DRY_RUN_PLAN, onToken, signal);
  }

  private async stream(
    text: string,
    onToken: (t: string) => void,
    signal: AbortSignal,
  ): Promise<string> {
    const words = text.split(/(?<=\s)/);
    let out = "";
    for (const word of words) {
      if (signal.aborted) throw new Error("aborted");
      out += word;
      onToken(word);
      if (this.chunkDelayMs > 0) {
        await new Promise((r) => setTimeout(r, this.chunkDelayMs));
      }
    }
    return out;
  }
}

/** Pick the real planner when a key is configured, else the dry-run one. */
export function makePlanner(forceDryRun: boolean): Planner {
  if (forceDryRun || !process.env.ANTHROPIC_API_KEY) {
    return new DryRunPlanner();
  }
  return new ClaudePlanner();
}
