// Live Client Data API poller (in-game only).
//
// This is Riot's official, documented game-client API: once a match loads,
// the game process serves https://127.0.0.1:2999/liveclientdata/*. We poll
// the tiny /gamestats endpoint for the game clock, which drives which plan
// section the overlay highlights. Localhost-only by design; the certificate
// is Riot's self-signed one, hence rejectUnauthorized: false for this one
// pinned local host.

import * as https from "node:https";

export class LiveClientPoller {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly onClock: (gameTimeSec: number) => void,
    private readonly intervalMs: number = 5000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const req = https.get(
      {
        host: "127.0.0.1",
        port: 2999,
        path: "/liveclientdata/gamestats",
        rejectUnauthorized: false,
        timeout: 3000,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const stats = JSON.parse(body) as { gameTime?: number };
            if (typeof stats.gameTime === "number") {
              this.onClock(stats.gameTime);
            }
          } catch {
            // Non-JSON response while the game is still loading — ignore.
          }
        });
      },
    );
    req.on("error", () => {
      // Game process not up (yet, or anymore) — expected between games.
    });
    req.on("timeout", () => req.destroy());
  }
}
