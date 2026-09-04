#!/usr/bin/env python3
"""
Mouse DPI drill
===============
Find which onboard DPI stage of your mouse you actually click best on.

  * 20 small targets per round, one round per DPI stage.
  * Every click counts, hit or miss. Per round: average distance from the
    target centre (the number that matters), whether you landed past the
    target or short of it, time to click, and consistency.
  * Between rounds you press the mouse's DPI button once. At the end the
    stages are ranked (precision weighted over speed), then you say which
    one FELT best. If they disagree, feel wins.
  * Checks two Windows mouse settings - "Enhance pointer precision" (mouse
    acceleration) and pointer speed 6/11 (the only 1:1 notch). Any change
    is backed up first and undone with one button. Per-user settings only,
    no admin.

Run:      python mouse_drill.py
Needs:    Python 3 only (tkinter ships with it). No pip, no config files.
Results:  saved to mouse_drill_results.json next to this file, so the next
          run can show last time's numbers alongside.
"""
from __future__ import annotations

import ctypes
import json
import math
import random
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from statistics import mean, pstdev
import tkinter as tk
from tkinter import ttk
from tkinter import font as tkfont

TARGETS_PER_ROUND = 20
DEFAULT_STAGES = 4
MIN_STAGES, MAX_STAGES = 2, 9
# Score weights - lower is better on every input. Precision 70 %, speed 30 %.
WEIGHTS = (("avg_dist", 0.5), ("sd_dist", 0.2), ("avg_time", 0.3))
CLOSE_CALL = 2.0        # score points; closer than this is "too close to call"
IGNORE_CLICK_S = 0.10   # clicks this soon after a target appears are ignored (double-click guard)
RETEST_DAYS = 3
RESULTS_NAME = "mouse_drill_results.json"


# --------------------------------------------------------------------------- stats

def along_track(start, target, click):
    """Signed error along the direction of travel: + landed past the target, - short of it."""
    dx, dy = target[0] - start[0], target[1] - start[1]
    n = math.hypot(dx, dy)
    if n < 1e-9:
        return 0.0
    return ((click[0] - target[0]) * dx + (click[1] - target[1]) * dy) / n


def summarize(clicks):
    """One round's clicks -> its metrics. clicks: [{dist, time, along, hit}, ...]."""
    d = [c["dist"] for c in clicks]
    t = [c["time"] for c in clicks]
    return {
        "clicks": len(clicks),
        "avg_dist": mean(d),
        "sd_dist": pstdev(d) if len(d) > 1 else 0.0,
        "avg_time": mean(t),
        "overshoot": mean(c["along"] for c in clicks),
        "hits": sum(1 for c in clicks if c["hit"]),
    }


def score_rounds(rounds):
    """Adds 'score' (0-100) to every round; returns the winner.

    Each metric scores best/value (1.0 for the round that did best on it),
    weighted per WEIGHTS. 100 means best on everything.
    """
    best = {k: min(r[k] for r in rounds) for k, _ in WEIGHTS}
    for r in rounds:
        r["score"] = round(100 * sum(w * (best[k] + 1e-9) / (r[k] + 1e-9) for k, w in WEIGHTS), 1)
    return max(rounds, key=lambda r: r["score"])


def presses_to_reach(target_stage, current_stage, stages):
    """DPI button presses to get from current_stage to target_stage (stages cycle)."""
    return (target_stage - current_stage) % stages


def nice_date(d):
    return f"{d:%A} {d.day} {d:%B}"


# --------------------------------------------------------------------------- windows

SPI_GETMOUSE, SPI_SETMOUSE = 0x0003, 0x0004
SPI_GETMOUSESPEED, SPI_SETMOUSESPEED = 0x0070, 0x0071
SPIF_PERSIST = 0x0001 | 0x0002            # SPIF_UPDATEINIFILE | SPIF_SENDCHANGE
SLIDER_NOTCHES = (1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20)   # Windows slider notch 1..11 -> speed value
ONE_TO_ONE_SPEED = 10                                       # notch 6 of 11


class WindowsMouse:
    """Per-user Windows mouse settings (HKCU\\Control Panel\\Mouse) via SystemParametersInfo.

    'Enhance pointer precision' is the third value of the SPI_GETMOUSE triple
    (0 = off). Pointer speed is 1..20; the control panel slider shows 11 notches.
    No admin needed - these are the current user's own settings.
    """

    def __init__(self):
        self.available = sys.platform == "win32"
        if not self.available:
            return
        from ctypes import wintypes
        user32 = ctypes.WinDLL("user32", use_last_error=True)
        self._spi = user32.SystemParametersInfoW
        self._spi.argtypes = [wintypes.UINT, wintypes.UINT, ctypes.c_void_p, wintypes.UINT]
        self._spi.restype = wintypes.BOOL

    def _call(self, action, pv, flags=0):
        if not self._spi(action, 0, pv, flags):
            raise ctypes.WinError(ctypes.get_last_error())

    def read(self):
        arr = (ctypes.c_int * 3)()
        self._call(SPI_GETMOUSE, arr)
        speed = ctypes.c_int()
        self._call(SPI_GETMOUSESPEED, ctypes.byref(speed))
        return {"mouse": list(arr), "speed": speed.value}

    def set_mouse(self, triple):
        arr = (ctypes.c_int * 3)(*triple)
        self._call(SPI_SETMOUSE, arr, SPIF_PERSIST)

    def set_speed(self, speed):
        self._call(SPI_SETMOUSESPEED, ctypes.c_void_p(int(speed)), SPIF_PERSIST)

    @staticmethod
    def accel_on(mouse_triple):
        return bool(mouse_triple[2])

    @staticmethod
    def notch(speed):
        """Speed value 1..20 -> the slider notch 1..11 Windows shows for it."""
        return min(range(len(SLIDER_NOTCHES)), key=lambda i: abs(SLIDER_NOTCHES[i] - speed)) + 1


def enable_dpi_awareness():
    """Crisp text and real screen pixels on scaled displays (so px numbers are true mouse pixels)."""
    if sys.platform != "win32":
        return
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass


# --------------------------------------------------------------------------- storage

class Store:
    """results + settings backup in one JSON file: next to this script, else in the home folder."""

    def __init__(self):
        self.data = {"version": 1, "windows_backup": None, "sessions": []}
        self.path = None
        for p in self.candidates():
            if p.exists():
                try:
                    self.data = json.loads(p.read_text("utf-8"))
                    self.path = p
                    break
                except (OSError, ValueError):
                    continue

    @staticmethod
    def candidates():
        here = Path(__file__).resolve().parent
        return [here / RESULTS_NAME, Path.home() / RESULTS_NAME]

    def save(self):
        last_error = None
        for p in ([self.path] if self.path else []) + self.candidates():
            try:
                p.write_text(json.dumps(self.data, indent=2), "utf-8")
                self.path = p
                return p
            except OSError as e:
                last_error = e
        raise last_error

    def last_session(self, stages=None):
        for s in reversed(self.data.get("sessions", [])):
            if stages is None or s.get("stages") == stages:
                return s
        return None


# --------------------------------------------------------------------------- app

class App:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("Mouse DPI drill")
        self.store = Store()
        self.win = WindowsMouse()
        self.stages_var = tk.IntVar(value=DEFAULT_STAGES)
        self.stages = DEFAULT_STAGES
        self.rounds = []
        self.round_index = 0
        self.session = None
        self._afters = []

        self.s = self.root.winfo_fpixels("1i") / 96.0   # 1.0 at 100 % display scaling
        family = "Segoe UI" if sys.platform == "win32" else tkfont.nametofont("TkDefaultFont").actual("family")
        self.f_body = tkfont.Font(family=family, size=11)
        self.f_bold = tkfont.Font(family=family, size=11, weight="bold")
        self.f_small = tkfont.Font(family=family, size=9)
        self.f_sub = tkfont.Font(family=family, size=13, weight="bold")
        self.f_head = tkfont.Font(family=family, size=18, weight="bold")
        style = ttk.Style()
        style.configure(".", font=self.f_body)
        style.configure("TButton", padding=(self.px(12), self.px(6)))
        style.configure("Big.TButton", font=self.f_bold, padding=(self.px(18), self.px(10)))
        self.wrap = self.px(780)

        self.maximize()
        self.show(self.build_start)

    # ---- plumbing
    def px(self, n):
        return int(round(n * self.s))

    def maximize(self):
        try:
            self.root.state("zoomed")
        except tk.TclError:
            try:
                self.root.attributes("-zoomed", True)
            except tk.TclError:
                self.root.geometry(f"{self.root.winfo_screenwidth()}x{self.root.winfo_screenheight()}+0+0")

    def after(self, ms, fn):
        self._afters.append(self.root.after(ms, fn))

    def show(self, builder, **kw):
        for a in self._afters:
            self.root.after_cancel(a)
        self._afters = []
        self.root.unbind("<Escape>")
        for w in self.root.winfo_children():
            w.destroy()
        builder(**kw)

    def page(self):
        """A centred column for the text screens."""
        outer = ttk.Frame(self.root, padding=self.px(28))
        outer.pack(fill="both", expand=True)
        col = ttk.Frame(outer)
        col.pack(anchor="n")
        return col

    def text(self, parent, s, font=None, pady=(0, 8), fg=None, wrap=None):
        kw = {"wraplength": wrap or self.wrap, "justify": "left", "font": font or self.f_body}
        if fg:
            kw["foreground"] = fg
        lbl = ttk.Label(parent, text=s, **kw)
        lbl.pack(anchor="w", pady=(self.px(pady[0]), self.px(pady[1])))
        return lbl

    def current_stages(self):
        try:
            n = int(self.stages_var.get())
        except (tk.TclError, ValueError):
            n = DEFAULT_STAGES
        n = max(MIN_STAGES, min(MAX_STAGES, n))
        self.stages_var.set(n)
        return n

    # ---- start screen
    def build_start(self, note=None, note_is_error=False):
        col = self.page()
        self.text(col, "Mouse DPI drill", self.f_head, (0, 2))
        self.text(col, "Find the onboard DPI stage you actually click best on. About a minute per stage.", pady=(0, 18))

        row = ttk.Frame(col)
        row.pack(anchor="w", pady=(0, self.px(4)))
        ttk.Label(row, text="How many DPI stages does your mouse have?").pack(side="left")
        ttk.Spinbox(row, from_=MIN_STAGES, to=MAX_STAGES, width=3, textvariable=self.stages_var,
                    font=self.f_body).pack(side="left", padx=(self.px(10), 0))
        self.text(col, "Not sure? Press the DPI button (the small one behind the scroll wheel) and watch the "
                       "cursor speed change. Count the presses until it comes back round to where it started.",
                  self.f_small, (0, 18), fg="#555")

        self.text(col, "Windows mouse settings", self.f_sub, (0, 6))
        self.settings_block(col)
        if note:
            self.text(col, note, self.f_small, (2, 10), fg="#b00020" if note_is_error else "#1a7f37")

        self.text(col, "Before you start", self.f_sub, (14, 6))
        self.text(col, "• Whatever DPI stage the mouse is on right now counts as stage 1. The rounds go "
                       "round in order from there, one press of the DPI button between each.")
        self.text(col, f"• Each round shows {TARGETS_PER_ROUND} small targets, one at a time. Click each one "
                       "as fast and as exactly on the centre as you can. Every click counts, hit or miss.")
        self.text(col, "• Sit and hold the mouse exactly as you would in a game. Esc cancels a round.", pady=(0, 16))

        last = self.store.last_session()
        if last:
            try:
                when = datetime.fromisoformat(last["date"])
                ago = (date.today() - when.date()).days
                ago_s = "today" if ago == 0 else ("yesterday" if ago == 1 else f"{ago} days ago")
                pick = last.get("felt_best")
                pick_s = f"you picked stage {pick}" if pick else "no feel pick recorded"
                self.text(col, f"Last run: {nice_date(when)} ({ago_s}) — numbers said stage "
                               f"{last['best_by_numbers']}, {pick_s}.", self.f_small, (0, 14), fg="#555")
            except (KeyError, ValueError, TypeError):
                pass

        ttk.Button(col, text="Start round 1", style="Big.TButton",
                   command=self.start_session).pack(anchor="w", pady=(self.px(4), 0))

    def settings_block(self, col):
        if not self.win.available:
            self.text(col, f"Only checked on Windows (this is {sys.platform}); skipped.", self.f_small, fg="#555")
            return
        try:
            cur = self.win.read()
        except OSError as e:
            self.text(col, f"Couldn't read the Windows mouse settings: {e}", self.f_small, fg="#b00020")
            return

        row = ttk.Frame(col)
        row.pack(anchor="w", fill="x", pady=(0, self.px(6)))
        if self.win.accel_on(cur["mouse"]):
            ttk.Label(row, text="Enhance pointer precision is ON.", font=self.f_bold, foreground="#b00020").pack(anchor="w")
            self.text(row, "That is mouse acceleration: the cursor travels further when your hand moves faster, so "
                           "the same motion lands in different places. It makes every round inconsistent. "
                           "Turning it off is a per-user setting, backed up first.", self.f_small, (0, 4), fg="#555")
            ttk.Button(row, text="Turn it off", command=self.turn_off_accel).pack(anchor="w")
        else:
            ttk.Label(row, text="Enhance pointer precision is off. ✓", font=self.f_bold, foreground="#1a7f37").pack(anchor="w")

        row = ttk.Frame(col)
        row.pack(anchor="w", fill="x", pady=(self.px(4), self.px(6)))
        notch = self.win.notch(cur["speed"])
        if cur["speed"] == ONE_TO_ONE_SPEED:
            ttk.Label(row, text="Pointer speed is 6/11. ✓", font=self.f_bold, foreground="#1a7f37").pack(anchor="w")
            self.text(row, "The only notch that moves the cursor exactly one pixel per mouse count. Leave it; "
                           "the DPI button is the knob.", self.f_small, (0, 0), fg="#555")
        else:
            ttk.Label(row, text=f"Pointer speed is {notch}/11.", font=self.f_bold, foreground="#b00020").pack(anchor="w")
            self.text(row, "Only 6/11 moves the cursor exactly one pixel per mouse count; the other notches skip "
                           "or double pixels. Setting it is a per-user change, backed up first.", self.f_small, (0, 4), fg="#555")
            ttk.Button(row, text="Set it to 6/11", command=self.set_speed_1to1).pack(anchor="w")

        backup = self.store.data.get("windows_backup")
        if backup:
            row = ttk.Frame(col)
            row.pack(anchor="w", fill="x", pady=(self.px(6), 0))
            ttk.Button(row, text="Undo my Windows changes", command=self.undo_windows).pack(side="left")
            when = backup.get("saved_at", "")[:16].replace("T", " ")
            b_accel = "on" if self.win.accel_on(backup["mouse"]) else "off"
            ttk.Label(row, text=f"puts both back to how they were before this program touched them "
                                f"(saved {when}: precision {b_accel}, speed {self.win.notch(backup['speed'])}/11)",
                      font=self.f_small, foreground="#555", wraplength=self.px(520)).pack(side="left", padx=(self.px(10), 0))

    def ensure_backup(self):
        if self.store.data.get("windows_backup"):
            return
        cur = self.win.read()
        self.store.data["windows_backup"] = {**cur, "saved_at": datetime.now().isoformat(timespec="seconds")}
        self.store.save()   # the backup must be on disk before anything changes

    def turn_off_accel(self):
        try:
            self.ensure_backup()
            self.win.set_mouse([0, 0, 0])
            self.show(self.build_start, note="Enhance pointer precision is now off. Undo is above if you want it back.")
        except OSError as e:
            self.show(self.build_start, note=f"Nothing was changed. {e}", note_is_error=True)

    def set_speed_1to1(self):
        try:
            self.ensure_backup()
            self.win.set_speed(ONE_TO_ONE_SPEED)
            self.show(self.build_start, note="Pointer speed is now 6/11. Undo is above if you want it back.")
        except OSError as e:
            self.show(self.build_start, note=f"Nothing was changed. {e}", note_is_error=True)

    def undo_windows(self):
        b = self.store.data.get("windows_backup")
        if not b:
            return
        try:
            self.win.set_mouse(b["mouse"])
            self.win.set_speed(b["speed"])
            self.store.data["windows_backup"] = None
            self.store.save()
            self.show(self.build_start, note="Both settings are back to how they were.")
        except OSError as e:
            self.show(self.build_start, note=f"Undo failed: {e}", note_is_error=True)

    # ---- the drill
    def start_session(self):
        self.stages = self.current_stages()
        self.rounds = []
        self.session = None
        self.start_round(1)

    def start_round(self, k):
        self.round_index = k
        self.show(self.build_round)

    def target_radius(self, w, h):
        return max(6, int(round(min(w, h) / 120)))   # ~9 px at 1080p, ~18 px at 4K: same size to the eye

    def build_round(self):
        k, n = self.round_index, self.stages
        c = tk.Canvas(self.root, bg="#141414", highlightthickness=0)
        c.pack(fill="both", expand=True)
        self.canvas = c
        self.clicks = []
        self.target = None
        self.root.update_idletasks()
        w, h = c.winfo_width(), c.winfo_height()
        c.create_text(w / 2, h / 2 - self.px(40), text=f"Round {k} of {n}  —  DPI stage {k}",
                      fill="#eeeeee", font=self.f_head, justify="center", tags="intro")
        c.create_text(w / 2, h / 2 + self.px(30), justify="center", fill="#bbbbbb", font=self.f_body, tags="intro",
                      text=f"Click anywhere to begin.\n\n{TARGETS_PER_ROUND} targets, one at a time. Click each one as fast and as exactly on "
                           "the centre as you can.\nEvery click counts, hit or miss.  Esc cancels the round.")
        c.bind("<Button-1>", self.on_canvas_click)
        self.root.bind("<Escape>", lambda e: self.cancel_round())
        c.focus_set()

    def update_hud(self):
        c = self.canvas
        c.delete("hud")
        c.create_text(self.px(14), self.px(10), anchor="nw", fill="#777777", font=self.f_small, tags="hud",
                      text=f"Round {self.round_index} of {self.stages}  ·  DPI stage {self.round_index}  ·  "
                           f"target {len(self.clicks) + 1} of {TARGETS_PER_ROUND}  ·  Esc cancels")

    def spawn_target(self, from_xy):
        c = self.canvas
        c.delete("target")
        w, h = c.winfo_width(), c.winfo_height()
        r = self.target_radius(w, h)
        m = 4 * r + self.px(24)
        x, y = w / 2, h / 2
        if w - 2 * m > 50 and h - 2 * m > 50:
            min_move = 0.12 * math.hypot(w, h)   # force a real hand movement every time
            for _ in range(100):
                x, y = random.uniform(m, w - m), random.uniform(m, h - m)
                if math.hypot(x - from_xy[0], y - from_xy[1]) >= min_move:
                    break
        c.create_oval(x - r, y - r, x + r, y + r, fill="#ff4d4d", outline="#ffd6d6", width=2, tags="target")
        c.create_oval(x - 1.5, y - 1.5, x + 1.5, y + 1.5, fill="#ffffff", outline="", tags="target")
        self.update_hud()
        c.update_idletasks()   # on screen before the clock starts
        self.target = (x, y, r, time.perf_counter(), from_xy)

    def on_canvas_click(self, ev):
        if self.target is None:               # the "click to begin" click
            self.canvas.delete("intro")
            self.spawn_target((ev.x, ev.y))
            return
        now = time.perf_counter()
        tx, ty, r, t0, start = self.target
        if now - t0 < IGNORE_CLICK_S:
            return
        dist = math.hypot(ev.x - tx, ev.y - ty)
        self.clicks.append({"dist": dist, "time": now - t0,
                            "along": along_track(start, (tx, ty), (ev.x, ev.y)), "hit": dist <= r})
        self.flash((tx, ty), r, dist <= r)
        if len(self.clicks) >= TARGETS_PER_ROUND:
            self.finish_round()
        else:
            self.spawn_target((ev.x, ev.y))

    def flash(self, xy, r, hit):
        c = self.canvas
        item = c.create_oval(xy[0] - r - 5, xy[1] - r - 5, xy[0] + r + 5, xy[1] + r + 5,
                             outline="#3ddc84" if hit else "#ff9f43", width=3)
        self.after(220, lambda: c.delete(item))

    def finish_round(self):
        stats = summarize(self.clicks)
        stats["stage"] = self.round_index
        self.rounds.append(stats)
        if self.round_index >= self.stages:
            self.show(self.build_results)
        else:
            self.show(self.build_between)

    def cancel_round(self):
        if self.round_index == 1:
            self.show(self.build_start, note="Round 1 cancelled. Nothing recorded.")
        else:
            self.show(self.build_between, cancelled=True)

    def redo_round(self):
        self.rounds.pop()
        self.start_round(self.round_index)

    def one_line(self, r):
        over_under = f"{r['overshoot']:+.1f}".replace("-", "−")
        return (f"Avg miss {r['avg_dist']:.1f} px  ·  Over/under {over_under} px  ·  "
                f"Consistency {r['sd_dist']:.1f} px  ·  Avg time {r['avg_time']:.2f} s  ·  "
                f"Hits {r['hits']}/{r['clicks']}")

    # ---- between rounds
    def build_between(self, cancelled=False):
        done = self.rounds[-1]
        k = done["stage"]
        nxt = k + 1
        col = self.page()
        if cancelled:
            self.text(col, f"Round {nxt} cancelled", self.f_head, (0, 2))
            self.text(col, f"Nothing recorded for it. Your mouse should still be on DPI stage {nxt}; "
                           f"click Start round {nxt} when you're ready.", pady=(0, 18))
            self.text(col, f"Round {k} (stage {k}) stands:", self.f_bold, (0, 2))
            self.text(col, self.one_line(done), pady=(0, 18))
            ttk.Button(col, text=f"Start round {nxt}", style="Big.TButton",
                       command=lambda: self.start_round(nxt)).pack(anchor="w")
            return
        self.text(col, f"Round {k} done  —  DPI stage {k}", self.f_head, (0, 2))
        self.text(col, self.one_line(done), pady=(0, 22))
        self.text(col, "Now press the DPI button on your mouse ONCE.", self.f_sub, (0, 4))
        self.text(col, f"The small button behind the scroll wheel. That puts the mouse on stage {nxt}. "
                       f"Then click Start round {nxt}.", pady=(0, 20))
        ttk.Button(col, text=f"Start round {nxt}", style="Big.TButton",
                   command=lambda: self.start_round(nxt)).pack(anchor="w", pady=(0, self.px(14)))
        row = ttk.Frame(col)
        row.pack(anchor="w")
        ttk.Button(row, text=f"Redo round {k}", command=self.redo_round).pack(side="left")
        ttk.Label(row, text="only if you have NOT pressed the DPI button yet", font=self.f_small,
                  foreground="#555").pack(side="left", padx=(self.px(10), 0))

    # ---- results
    def build_results(self):
        rounds = self.rounds
        best = score_rounds(rounds)
        ranked = sorted(rounds, key=lambda r: r["score"], reverse=True)
        prev = self.store.last_session(self.stages)
        prev_miss = {r["stage"]: r["avg_dist"] for r in prev["rounds"]} if prev else {}

        if self.session is None:
            self.session = {
                "date": datetime.now().isoformat(timespec="seconds"),
                "stages": self.stages,
                "targets_per_round": TARGETS_PER_ROUND,
                "screen": [self.root.winfo_screenwidth(), self.root.winfo_screenheight()],
                "rounds": rounds,
                "best_by_numbers": best["stage"],
                "felt_best": None,
                "chosen": None,
            }
            self.store.data.setdefault("sessions", []).append(self.session)
        save_note = self.save_session()

        col = self.page()
        self.text(col, "Results", self.f_head, (0, 10))

        table = ttk.Frame(col)
        table.pack(anchor="w", pady=(0, self.px(8)))
        heads = ["Stage", "Avg miss (px)", "Over/under (px)", "Consistency (px)", "Avg time (s)", "Hits", "Score"]
        if prev_miss:
            heads.append("Last time (px)")
        heads.append("")
        for j, hd in enumerate(heads):
            ttk.Label(table, text=hd, font=self.f_bold, anchor="e" if j else "w").grid(
                row=0, column=j, sticky="ew", padx=self.px(8), pady=(0, self.px(4)))
        for i, r in enumerate(rounds, start=1):
            cells = [f"{r['stage']}", f"{r['avg_dist']:.1f}", f"{r['overshoot']:+.1f}".replace("-", "−"), f"{r['sd_dist']:.1f}",
                     f"{r['avg_time']:.2f}", f"{r['hits']}/{r['clicks']}", f"{r['score']:.0f}"]
            if prev_miss:
                lt = prev_miss.get(r["stage"])
                cells.append(f"{lt:.1f}" if lt is not None else "—")
            cells.append("◀ best by the numbers" if r is best else "")
            f = self.f_bold if r is best else self.f_body
            for j, val in enumerate(cells):
                ttk.Label(table, text=val, font=f, anchor="e" if j and j < len(cells) - 1 else "w").grid(
                    row=i, column=j, sticky="ew", padx=self.px(8), pady=self.px(1))

        self.text(col, "Avg miss is the one that matters: how far from the target's centre your clicks landed. "
                       "Over/under: + means you landed past the target (often the DPI is too high), − means short "
                       "of it (often too low). Consistency: lower is steadier. Score: 100 = best on everything; "
                       "precision counts 70 %, speed 30 %."
                       + (f" Last time = your avg miss on {nice_date(datetime.fromisoformat(prev['date']))}." if prev_miss else ""),
                  self.f_small, (0, 14), fg="#555")

        if len(ranked) > 1 and ranked[0]["score"] - ranked[1]["score"] < CLOSE_CALL:
            verdict = (f"By the numbers: stage {ranked[0]['stage']} edges stage {ranked[1]['stage']} "
                       f"({ranked[0]['score']:.0f} to {ranked[1]['score']:.0f}) — too close to call. Feel decides.")
        else:
            verdict = f"By the numbers: DPI stage {best['stage']} (score {best['score']:.0f})."
        self.text(col, verdict, self.f_sub, (0, 16))

        self.text(col, "Which stage FELT best? Your hand decides.", self.f_sub, (0, 6))
        row = ttk.Frame(col)
        row.pack(anchor="w", pady=(0, self.px(10)))
        for r in rounds:
            ttk.Button(row, text=f"Stage {r['stage']}",
                       command=lambda st=r["stage"]: self.pick_felt(st)).pack(side="left", padx=(0, self.px(8)))
        self.verdict_box = ttk.Frame(col)
        self.verdict_box.pack(anchor="w", fill="x")
        self.save_note_label = self.text(col, save_note, self.f_small, (16, 0), fg="#555")

    def save_session(self):
        try:
            p = self.store.save()
            return f"Saved to {p}. The next run will show today's numbers alongside."
        except OSError as e:
            return f"Couldn't save the results ({e}). Note them down before closing."

    def pick_felt(self, felt):
        best = self.session["best_by_numbers"]
        self.session["felt_best"] = felt
        self.session["chosen"] = felt
        self.save_note_label.configure(text=self.save_session())

        for w in self.verdict_box.winfo_children():
            w.destroy()
        box = self.verdict_box
        by_stage = {r["stage"]: r for r in self.rounds}
        if felt == best:
            self.text(box, f"Numbers and hand agree: DPI stage {felt}.", self.f_sub, (6, 6), fg="#1a7f37")
        else:
            b, f = by_stage[best], by_stage[felt]
            self.text(box, f"The numbers say stage {best}; your hand says stage {felt}. Feel wins — go with stage {felt}.",
                      self.f_sub, (6, 2), fg="#1a7f37")
            self.text(box, f"(Stage {felt} scored {f['score']:.0f} to stage {best}'s {b['score']:.0f}; avg miss "
                           f"{f['avg_dist']:.1f} vs {b['avg_dist']:.1f} px. Worth a second look on the next run.)",
                      self.f_small, (0, 8), fg="#555")

        n = self.stages
        presses = presses_to_reach(felt, n, n)
        if presses == 0:
            self.text(box, f"Your mouse is already on stage {felt} (it's on stage {n} after {n - 1} presses).", pady=(4, 8))
        else:
            self.text(box, f"Your mouse is on stage {n} now ({n - 1} presses so far). Press the DPI button "
                           f"{presses} more time{'s' if presses != 1 else ''} to land on stage {felt}.", pady=(4, 8))

        again = date.today() + timedelta(days=RETEST_DAYS)
        self.text(box, f"Run this again on {nice_date(again)} ({RETEST_DAYS} days from now). A lighter, smaller mouse makes "
                       "you overshoot at first and your hand adapts over about a week, so your best stage will probably move. "
                       "Same drill, same stage order; the table will show today's numbers alongside.", pady=(0, 14))
        ttk.Button(box, text="Done", style="Big.TButton", command=self.root.destroy).pack(anchor="w")


def main():
    enable_dpi_awareness()   # must run before the first Tk() call
    App().root.mainloop()


if __name__ == "__main__":
    main()
