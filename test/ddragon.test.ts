import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureChampMap, parseChampionFile } from "../src/data/ddragon";

const fixturePath = path.resolve(
  process.cwd(),
  "fixtures/ddragon-champion.slim.json",
);
const fixtureRaw = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseChampionFile", () => {
  it("maps numeric champion keys to display info", () => {
    const map = parseChampionFile(fixtureRaw);
    expect(map.get(266)?.name).toBe("Aatrox");
    expect(map.get(64)?.name).toBe("Lee Sin"); // ddragon id "LeeSin", name has the space
    expect(map.get(103)?.tags).toContain("Mage");
  });
});

describe("ensureChampMap", () => {
  it("fetches, caches to disk, then serves later calls from the cache", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-ddragon-"));
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("versions.json")) {
        return { json: async () => ["99.9.9"] } as Response;
      }
      return { json: async () => fixtureRaw } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const map = await ensureChampMap(dir);
    expect(map.get(122)?.name).toBe("Darius");
    expect(fs.existsSync(path.join(dir, "champions-99.9.9.json"))).toBe(true);

    await ensureChampMap(dir);
    // Second call hits versions.json but not the champion payload again.
    const championFetches = fetchMock.mock.calls.filter(([u]) =>
      String(u).includes("champion.json"),
    );
    expect(championFetches).toHaveLength(1);
  });

  it("falls back to the newest on-disk cache when offline", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-ddragon-"));
    fs.writeFileSync(
      path.join(dir, "champions-1.0.0.json"),
      JSON.stringify(fixtureRaw),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );

    const map = await ensureChampMap(dir);
    expect(map.get(412)?.name).toBe("Thresh");
  });

  it("throws a readable error when offline with no cache", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-ddragon-"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    await expect(ensureChampMap(dir)).rejects.toThrow(/champion data/i);
  });
});
