// Data Dragon: Riot's official, key-less static data CDN.
// We only need the champion id -> name/tags map. Cached on disk per patch
// version so a normal launch does zero network work after the first run.

import * as fs from "node:fs";
import * as path from "node:path";
import type { ChampMap } from "../types";

const VERSIONS_URL = "https://ddragon.leagueoflegends.com/api/versions.json";

interface DdragonChampionFile {
  version?: string;
  data: Record<
    string,
    { key: string; id: string; name: string; title?: string; tags?: string[] }
  >;
}

/** Parse a raw ddragon champion.json payload into our ChampMap. */
export function parseChampionFile(raw: DdragonChampionFile): ChampMap {
  const map: ChampMap = new Map();
  for (const entry of Object.values(raw.data)) {
    const numericId = Number(entry.key);
    if (!Number.isFinite(numericId)) continue;
    map.set(numericId, {
      id: entry.id,
      name: entry.name,
      title: entry.title ?? "",
      tags: entry.tags ?? [],
    });
  }
  return map;
}

function cachedChampionFiles(cacheDir: string): string[] {
  if (!fs.existsSync(cacheDir)) return [];
  return fs
    .readdirSync(cacheDir)
    .filter((f) => /^champions-.+\.json$/.test(f))
    .map((f) => path.join(cacheDir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

/**
 * Load the champion map: live fetch (then cache) with fallback to the newest
 * on-disk cache when offline. Throws only if both paths fail.
 */
export async function ensureChampMap(cacheDir: string): Promise<ChampMap> {
  try {
    const versions = (await (await fetch(VERSIONS_URL)).json()) as string[];
    const version = versions[0];
    const cacheFile = path.join(cacheDir, `champions-${version}.json`);
    if (fs.existsSync(cacheFile)) {
      return parseChampionFile(JSON.parse(fs.readFileSync(cacheFile, "utf8")));
    }
    const url = `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`;
    const raw = (await (await fetch(url)).json()) as DdragonChampionFile;
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(raw));
    return parseChampionFile(raw);
  } catch (err) {
    const fallback = cachedChampionFiles(cacheDir)[0];
    if (fallback) {
      return parseChampionFile(JSON.parse(fs.readFileSync(fallback, "utf8")));
    }
    throw new Error(
      `Could not fetch champion data from Data Dragon and no local cache exists. ` +
        `Connect to the internet once so the champion list can be downloaded. (${String(err)})`,
    );
  }
}
