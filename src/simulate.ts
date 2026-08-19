// Headless end-to-end smoke test: fixtures -> state machine -> (dry-run)
// planner -> event stream. Runs with no League client, no Electron, and no
// API key, so it works in CI and any dev container. Exits non-zero if the
// pipeline doesn't produce a complete stage-2 plan.
//
// With ANTHROPIC_API_KEY set and SHOTCALLER_SIMULATE_LIVE=1 it will make the
// real API calls instead — useful for iterating on the prompt.

import "dotenv/config";
import * as assert from "node:assert";
import { parseChampionFile } from "./data/ddragon";
import { loadFixture, runMockSession } from "./lcu/mock";
import { makePlanner } from "./planner/claude";
import { Shotcaller } from "./planner/state";
import type { ShotcallerEvent } from "./types";

async function main(): Promise<void> {
  const champs = parseChampionFile(loadFixture("ddragon-champion.slim.json"));
  const live = process.env.SHOTCALLER_SIMULATE_LIVE === "1";
  const planner = makePlanner(!live);

  const sc = new Shotcaller(champs, planner);
  const events: ShotcallerEvent[] = [];
  let planText = "";

  sc.onEvent((evt) => {
    events.push(evt);
    switch (evt.kind) {
      case "status":
        console.log(`[status:${evt.state}] ${evt.text}`);
        break;
      case "lobby":
        console.log(
          `[lobby] allies: ${evt.allies.map((a) => a.championName || "?").join(", ")}` +
            (evt.bans.length ? ` | bans: ${evt.bans.join(", ")}` : ""),
        );
        break;
      case "matchup":
        console.log(
          `[matchup] ${evt.allies.map((a) => a.championName).join(", ")}  VS  ` +
            evt.enemies.map((e) => e.championName).join(", "),
        );
        break;
      case "plan-stage":
        console.log(`[plan] stage ${evt.stage} started`);
        break;
      case "plan-token":
        if (evt.stage === 2) {
          planText += evt.text;
          if (live) process.stdout.write(evt.text);
        }
        break;
      case "plan-done":
        console.log(`\n[plan] stage ${evt.stage} done (${evt.full.length} chars)`);
        break;
      case "plan-error":
        console.error(`[plan-error] ${evt.message}`);
        break;
      case "clock":
        console.log(`[clock] ${Math.floor(evt.gameTimeSec / 60)}:${String(Math.floor(evt.gameTimeSec % 60)).padStart(2, "0")}`);
        break;
      case "reset":
        console.log(`[reset]`);
        break;
    }
  });

  await runMockSession(sc, { fast: true });

  // The contract the overlay depends on:
  assert.ok(
    events.some((e) => e.kind === "plan-done" && e.stage === 1),
    "stage 1 (ally brief) should complete during champ select",
  );
  assert.ok(
    events.some((e) => e.kind === "plan-done" && e.stage === 2),
    "stage 2 (full plan) should complete at loading screen",
  );
  const matchup = events.find((e) => e.kind === "matchup");
  assert.ok(matchup && matchup.kind === "matchup", "matchup event emitted");
  assert.ok(
    matchup.enemies.some((e) => e.championName === "Darius"),
    "enemy roster resolved to champion names",
  );
  for (const header of ["## WIN CONDITION", "## YOUR LANE", "## THREATS", "## IF BEHIND"]) {
    assert.ok(planText.includes(header), `plan contains ${header}`);
  }

  console.log("\nsimulate: OK — full pipeline produced a structured plan.");
  console.log("\n--- stage 2 plan ---\n");
  console.log(planText.length > 1200 && !live ? planText.slice(0, 1200) + "\n[…]" : planText);
}

main().catch((err) => {
  console.error("simulate: FAILED");
  console.error(err);
  process.exit(1);
});
