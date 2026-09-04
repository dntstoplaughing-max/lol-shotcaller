# Mouse DPI drill

Find which onboard DPI stage of your mouse you actually click best on.
One window, about a minute per stage, nothing to install beyond Python.
Windows 11, no admin. Not part of Shotcaller — it just lives in the same repo.

## Install (once)

Python 3, from the Microsoft Store: open the Start menu, type `python`,
pick **Python 3.12** (or newer) by the Python Software Foundation, Get.
Free, no admin. (The installer from python.org works too — untick the
"admin privileges" box for the launcher if you're not an admin.)

## Run

From the repo folder:

    python tools\mouse-drill\mouse_drill.py

Or copy `mouse_drill.py` anywhere and double-click it.

Desktop icon: `npm run shortcut` (the same command that makes the Shotcaller
icon) also puts **Mouse DPI drill** on the Desktop. It launches this script
without a console window and needs Python installed first.

## What happens

1. **Settings check.** Reads two Windows mouse settings and offers a
   one-click fix for each: "Enhance pointer precision" (mouse
   acceleration — makes every round inconsistent) and pointer speed
   (only 6/11 moves the cursor exactly one pixel per mouse count). Any
   change is backed up first; **Undo** puts both back, even after a
   restart. Nothing changes unless you click a button.
2. **One round per DPI stage** (say how many; default 4). Whatever stage
   the mouse is on when you start is stage 1. Each round: 20 small
   targets, one at a time, click each as fast and as exactly on the
   centre as you can. Every click counts, hit or miss. Between rounds,
   press the mouse's DPI button once.
3. **Results.** A table per stage: average miss (distance from the
   centre — the number that matters), over/under (+ landed past the
   target, − short of it), consistency, average time, hits, score.
   Score weights precision 70 % and speed 30 %.
4. **Feel wins.** It names the winner by the numbers, then asks which
   stage felt best. If they disagree, it says so and goes with your
   hand. It also tells you how many DPI presses get you back to that
   stage, and when to run it again (3 days).

## Results file

`mouse_drill_results.json`, next to the script (or in your user folder if
that spot isn't writable). Every run is kept so the next one shows last
time's numbers alongside; the Windows-settings backup lives there too.
Delete the file to start fresh. Nothing else is written anywhere.
