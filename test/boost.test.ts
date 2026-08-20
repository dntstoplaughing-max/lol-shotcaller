import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadBoostConfig,
  NEVER_KILL,
  planBoost,
  type BoostConfig,
} from "../src/system/boost";
import { parseRiotInstalls } from "../src/system/league";

function tmpJson(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-boost-"));
  const file = path.join(dir, "boost.json");
  fs.writeFileSync(file, content);
  return file;
}

describe("loadBoostConfig", () => {
  it("loads the repo's shipped boost.json (disabled by default)", () => {
    const config = loadBoostConfig(path.resolve(process.cwd(), "boost.json"));
    expect(config).not.toBeNull();
    expect(config?.enabled).toBe(false); // requires an explicit opt-in
    expect(config?.processes.length).toBeGreaterThan(0);
  });

  it("returns null for junk, and defaults trigger/graceMs sanely", () => {
    expect(loadBoostConfig("/nonexistent/boost.json")).toBeNull();
    expect(loadBoostConfig(tmpJson("not json"))).toBeNull();
    expect(loadBoostConfig(tmpJson('{"enabled": "yes"}'))).toBeNull();

    const config = loadBoostConfig(
      tmpJson('{"enabled": true, "processes": [{"name": "a.exe"}], "trigger": "bogus", "graceMs": 999999}'),
    );
    expect(config?.trigger).toBe("launch");
    expect(config?.graceMs).toBe(30000); // capped
  });
});

describe("planBoost", () => {
  const config: BoostConfig = {
    enabled: true,
    trigger: "launch",
    graceMs: 4000,
    processes: [
      { name: "Spotify.exe" },
      { name: "STEAM.EXE", force: true },
      { name: "LeagueClient.exe" }, // protected, must be refused
      { name: "vgc.exe" }, // Vanguard, must be refused
      { name: "explorer.exe" }, // system, must be refused
      { name: "rm -rf; evil" }, // invalid name, must be refused
      { name: "NotRunning.exe" },
      { name: "Spotify.exe" }, // duplicate, ignored
    ],
  };
  const running = ["spotify.exe", "steam.exe", "LeagueClient.exe", "vgc.exe", "explorer.exe"];

  it("kills only running, valid, unprotected processes (case-insensitive)", () => {
    const plan = planBoost(config, running);
    expect(plan.toKill.map((p) => p.name)).toEqual(["Spotify.exe", "STEAM.EXE"]);
    expect(plan.toKill[1].force).toBe(true);
    expect(plan.protectedSkipped).toEqual(["LeagueClient.exe", "vgc.exe", "explorer.exe"]);
    expect(plan.invalidSkipped).toEqual(["rm -rf; evil"]);
    expect(plan.notRunning).toEqual(["NotRunning.exe"]);
  });

  it("never-kill guard covers Riot, Vanguard, and core Windows processes", () => {
    for (const name of ["leagueclientux.exe", "riotclientservices.exe", "vgtray.exe", "lsass.exe", "svchost.exe", "node.exe"]) {
      expect(NEVER_KILL.has(name)).toBe(true);
    }
  });
});

describe("parseRiotInstalls", () => {
  it("pulls rc_default, falls back to rc_live, rejects junk", () => {
    expect(
      parseRiotInstalls('{"rc_default": "C:/Riot Games/Riot Client/RiotClientServices.exe"}'),
    ).toBe("C:/Riot Games/Riot Client/RiotClientServices.exe");
    expect(parseRiotInstalls('{"rc_live": "D:/Riot/RiotClientServices.exe"}')).toBe(
      "D:/Riot/RiotClientServices.exe",
    );
    expect(parseRiotInstalls("not json")).toBeNull();
    expect(parseRiotInstalls("{}")).toBeNull();
  });
});
