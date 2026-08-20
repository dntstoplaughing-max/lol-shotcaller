// Overlay renderer. Receives ShotcallerEvent payloads from the main process
// via the preload bridge, and renders the streaming plan. With ?demo=1 (or
// when opened directly in a browser) it drives itself with canned data so
// the UI can be iterated on without League, Electron, or an API key.

/* eslint-env browser */
(() => {
  const el = (id) => document.getElementById(id);
  const pill = el("pill");
  const statusEl = el("status");
  const clockEl = el("clock");
  const teamsEl = el("teams");
  const alliesEl = el("allies");
  const enemiesEl = el("enemies");
  const vsRow = el("vsrow");
  const bansEl = el("bans");
  const planEl = el("plan");

  const POS = { top: "TOP", jungle: "JG", middle: "MID", bottom: "ADC", utility: "SUP" };

  let planBuffer = "";
  let renderQueued = false;
  let activeSection = null; // set by the game clock
  let gateInterval = null; // countdown ticker for cooldown gates

  // Sections that stay visible in compact (collapsed) mode.
  const PINNED = new Set(["WIN CONDITION", "COMP IDENTITY", "FOCUS"]);

  function setStatus(state, text) {
    pill.className = state;
    pill.textContent = state === "champselect" ? "champ select" : state;
    statusEl.textContent = text;
  }

  function chip(slot, enemy) {
    const span = document.createElement("span");
    span.className = "chip" + (slot.isMe ? " me" : "") + (enemy ? " enemy" : "");
    span.textContent = slot.championName || "…";
    if (slot.position && POS[slot.position]) {
      const pos = document.createElement("span");
      pos.className = "pos";
      pos.textContent = POS[slot.position];
      span.appendChild(pos);
    }
    return span;
  }

  function renderTeam(container, slots, enemy) {
    container.replaceChildren(...slots.map((s) => chip(s, enemy)));
  }

  function renderBans(bans) {
    if (!bans || bans.length === 0) {
      bansEl.hidden = true;
      return;
    }
    bansEl.hidden = false;
    bansEl.replaceChildren();
    const label = document.createElement("b");
    label.textContent = "BANS ";
    bansEl.appendChild(label);
    bansEl.appendChild(document.createTextNode(bans.join(" · ")));
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      renderPlan();
    });
  }

  function renderPlan() {
    // Parse "## HEADER\nbody" blocks out of the streamed buffer.
    const parts = planBuffer.split(/^## +/m).filter((p) => p.trim().length > 0);
    const sections = [];
    for (const part of parts) {
      const newline = part.indexOf("\n");
      const header = (newline === -1 ? part : part.slice(0, newline)).trim();
      const body = newline === -1 ? "" : part.slice(newline + 1).trim();
      sections.push({ header, body });
    }
    planEl.replaceChildren(
      ...sections.map(({ header, body }) => {
        const sec = document.createElement("section");
        sec.className = "sec";
        sec.dataset.name = header;
        if (PINNED.has(header)) sec.classList.add("pinned");
        if (activeSection && header === activeSection) sec.classList.add("active");
        const h3 = document.createElement("h3");
        h3.textContent = header;
        const div = document.createElement("div");
        div.className = "body";
        div.textContent = body;
        sec.append(h3, div);
        return sec;
      }),
    );
  }

  function setGate(evt) {
    const gateEl = el("gate");
    const timerEl = el("gatetimer");
    if (gateInterval) {
      clearInterval(gateInterval);
      gateInterval = null;
    }
    if (evt.state === "open") {
      gateEl.hidden = true;
      return;
    }
    gateEl.hidden = false;
    el("gatereason").textContent = evt.reason || "";
    if (evt.state === "cooldown" && evt.untilTs) {
      timerEl.hidden = false;
      const tick = () => {
        const left = Math.max(0, Math.ceil((evt.untilTs - Date.now()) / 1000));
        const m = Math.floor(left / 60);
        const s = String(left % 60).padStart(2, "0");
        timerEl.textContent = `Gate opens in ${m}:${s}`;
        if (left <= 0) {
          clearInterval(gateInterval);
          gateInterval = null;
          gateEl.hidden = true;
        }
      };
      tick();
      gateInterval = setInterval(tick, 1000);
    } else {
      timerEl.hidden = true;
    }
  }

  function setPickHint(text) {
    const hintEl = el("pickhint");
    hintEl.hidden = !text;
    hintEl.textContent = text || "";
  }

  function setClock(gameTimeSec) {
    const m = Math.floor(gameTimeSec / 60);
    const s = String(Math.floor(gameTimeSec % 60)).padStart(2, "0");
    clockEl.hidden = false;
    clockEl.textContent = `${m}:${s}`;
    const next =
      gameTimeSec < 14 * 60 ? "YOUR LANE" : gameTimeSec < 25 * 60 ? "MID GAME" : "LATE GAME";
    const changed = next !== activeSection;
    activeSection = next;
    scheduleRender();
    if (changed) {
      // The overlay is click-through in game, so nobody can scroll it by
      // hand — bring the section the clock points at into view.
      requestAnimationFrame(() => {
        const active = planEl.querySelector(".sec.active");
        if (active) active.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    }
  }

  function handleEvent(evt) {
    switch (evt.kind) {
      case "status":
        setStatus(evt.state, evt.text);
        break;
      case "lobby":
        teamsEl.hidden = false;
        renderTeam(alliesEl, evt.allies, false);
        renderBans(evt.bans);
        break;
      case "matchup":
        teamsEl.hidden = false;
        vsRow.hidden = false;
        renderTeam(alliesEl, evt.allies, false);
        renderTeam(enemiesEl, evt.enemies, true);
        break;
      case "plan-stage":
        planBuffer = "";
        setStatus(
          "planning",
          evt.stage === 1 ? "Reading your comp…" : "Enemy comp revealed — building the plan…",
        );
        scheduleRender();
        break;
      case "plan-token":
        planBuffer += evt.text;
        scheduleRender();
        break;
      case "plan-done":
        planBuffer = evt.full;
        scheduleRender();
        break;
      case "plan-error":
        setStatus("error", evt.message);
        break;
      case "clock":
        setClock(evt.gameTimeSec);
        break;
      case "gate":
        setGate(evt);
        break;
      case "pick-hint":
        setPickHint(evt.text);
        break;
      case "reset":
        planBuffer = "";
        activeSection = null;
        clockEl.hidden = true;
        teamsEl.hidden = true;
        vsRow.hidden = true;
        bansEl.hidden = true;
        setPickHint(null);
        // Gate deliberately NOT cleared here: a closed gate must survive
        // into the next champ select (the state machine re-emits it there).
        alliesEl.replaceChildren();
        enemiesEl.replaceChildren();
        scheduleRender();
        break;
      default:
        break;
    }
  }

  function handleUi(msg) {
    if (msg.type === "interactive") {
      document.body.classList.toggle("interactive", Boolean(msg.value));
      el("hint").textContent = msg.value
        ? "Interactive — drag header to move · Ctrl+Alt+O to release the mouse"
        : "Ctrl+Alt+O — mouse on/off · Ctrl+Alt+K — compact";
    } else if (msg.type === "collapse-toggle") {
      document.body.classList.toggle("collapsed");
    }
  }

  // ------------------------------------------------------------------ wiring

  if (window.shotcaller) {
    window.shotcaller.onEvent(handleEvent);
    window.shotcaller.onUi(handleUi);
    return;
  }

  // No bridge: we're in demo mode (electron --demo, or a plain browser).
  document.body.classList.add("demo");

  const DEMO_ALLIES = [
    { championId: 54, championName: "Malphite", position: "top", isMe: false },
    { championId: 254, championName: "Vi", position: "jungle", isMe: false },
    { championId: 103, championName: "Ahri", position: "middle", isMe: true },
    { championId: 222, championName: "Jinx", position: "bottom", isMe: false },
    { championId: 412, championName: "Thresh", position: "utility", isMe: false },
  ];
  const DEMO_ENEMIES = [
    { championId: 122, championName: "Darius", position: "", isMe: false },
    { championId: 64, championName: "Lee Sin", position: "", isMe: false },
    { championId: 134, championName: "Syndra", position: "", isMe: false },
    { championId: 51, championName: "Caitlyn", position: "", isMe: false },
    { championId: 89, championName: "Leona", position: "", isMe: false },
  ];
  const DEMO_BANS = ["Zed", "Yasuo", "Blitzcrank", "Morgana", "Shaco", "Teemo"];
  const DEMO_PLAN = [
    "## WIN CONDITION",
    "Survive Darius/Lee Sin early pressure, then force grouped fights off Malphite engage after two items — their comp has no answer to a clean wombo from 20 minutes on.",
    "",
    "## YOUR LANE",
    "- Syndra outranges you pre-6: trade only with charm threat up, step out of Dark Sphere setups.",
    "- Your spikes: level 6 and first item. Hers: level 9 max-range spheres — respect that window.",
    "- Keep the wave even until 6, then shove and roam bot with Vi.",
    "- Lee Sin path starts top-side most games — deep ward river at 2:50, hug turret until he shows.",
    "",
    "## THREATS",
    "- Lee Sin — early kick setups, spikes on first clear; track him or concede the first trade.",
    "- Syndra — burst at 6 will one-shot from full; hold spirit rush for the stun, not for damage.",
    "- Darius — snowballs top; never let Malphite fight him in a frozen wave.",
    "- Caitlyn — lane bully, falls off mid; end her sieges by engaging on Leona first.",
    "- Leona — one rotation kills Jinx; ping her roams the moment bot wave pushes.",
    "",
    "## ITEMS",
    "- Darius + Lee Sin diving you: armor component into second item.",
    "- Leona/Syndra chain-CC: cleanse stays a live pivot — decide by 14 minutes.",
    "",
    "## MID GAME",
    "- Group mid from 14; Malphite + Vi start every fight, you clean up.",
    "- Trade grubs for dragons — your comp wants soul, theirs wants gold leads.",
    "",
    "## LATE GAME",
    "- One charm into flank decides fights — buy control wards for side brush.",
    "- Never face-check with Lee Sin missing; you are the pick target.",
    "",
    "## IF BEHIND",
    "Stall — clear waves, give what you can't contest, and wait for one Malphite ult on three: this comp wins from even at 30+.",
    "",
    "## FOCUS",
    "- Your profile leak: chasing resets into fog. Syndra + Leona punish it hardest — after every pick, count enemies on the map before you touch another wave.",
    "- Loss-streak rule applies: if this goes 0/3 by 14, play weak-side and let Malphite carry engage — do not force plays to fix the scoreboard.",
  ].join("\n");

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  (async () => {
    setStatus("champselect", "Champ select — reading picks and bans…");
    teamsEl.hidden = false;
    renderTeam(alliesEl, DEMO_ALLIES, false);
    renderBans(DEMO_BANS);
    setPickHint("Frontline covered — Qiyana game.");
    await sleep(900);
    setPickHint(null);
    handleEvent({ kind: "matchup", allies: DEMO_ALLIES, enemies: DEMO_ENEMIES });
    handleEvent({ kind: "plan-stage", stage: 2 });
    await sleep(300);
    for (const word of DEMO_PLAN.split(/(?<=\s)/)) {
      handleEvent({ kind: "plan-token", stage: 2, text: word });
      await sleep(6);
    }
    handleEvent({ kind: "plan-done", stage: 2, full: DEMO_PLAN });
    setStatus("live", "Plan ready — good luck.");
    handleEvent({ kind: "clock", gameTimeSec: 1000 });
  })();
})();
