# Qiyana jungle — builds & runes reference (patch 26.16)

Researched 2026-08-21 in a separate live-research session: op.gg (global
ranked, Silver and Emerald+ filters, via its open champion API), DeepLoL
(KR Emerald+ backend), the official 26.16 notes, and the LoL wiki;
lolalytics was unusable (client-side shell, old data API 404s). For the
human, not the planner — the rubric deliberately coaches from kit
fundamentals so a stale item name can never poison a live plan.
Patch-stamped on purpose: everything below is a 26.16 fact.

**Revisit a few days after 26.17 lands (~Aug 26)** — the preview lists
another Qiyana damage buff plus nerfs to Graves *and* Nocturne (two of the
worst matchups below), which could move her out of the 43%-at-Silver hole.

## Owner's amendments (2026-08-21) — what actually gets played

The data below says First Strike; the owner is keeping **Dark Harvest**:
Silver games go so late that it always scales up. Logged as an open
disagreement, not an error on either side — DH is n<100 at Silver this
patch, which means *unpopular*, not *refuted*, and the owner's kill volume
(8.7/game) is exactly the profile DH pays out. The owner's own games over
the coming weeks are the real test; the next profile regeneration should
weigh them.

Second amendment: the sheet omits **Gluttonous Greaves**, which the owner
rates above Mercury's Treads as the defensive boot — better defense in
practice, because the sustain makes a duel last one more rotation against
bruisers, or against squishies who flash the ult and turn a pick into an
extended fight. Owner's trigger vs. the sheet's: Mercs answer lockup
chains; Gluttonous answers extended duels.

---

## The cheat sheet (as researched, verbatim)

**The honest headline first:** Qiyana jungle is currently *weak*. Silver
(op.gg global, n=12,812): **43.1% WR**. Emerald+ (n=47,753): 47.2%. KR
Emerald+ (DeepLoL, n=8,054): 48.5%, ranked 29 of 49 junglers, tier 5 on
both sites. At Silver she has **no common matchup above 50%** (n≥100).
Riot agrees: her Q monster damage was buffed 155%→175% in 26.13, and the
**26.17 preview (lands ~Aug 26) lists another Qiyana damage buff** — plus
nerfs to Graves *and* Nocturne, two of your worst matchups. Numbers aren't
out yet. She's playable as a one-trick, but you're climbing with
execution, not with the champion.

### 1. Primary rune page (First Strike — 71% pick at Silver, 86% at Emerald+)

| Slot | Take |
|---|---|
| Keystone | **First Strike** (Inspiration) |
| Row 1 | **Cash Back** |
| Row 2 | **Triple Tonic** |
| Row 3 | **Cosmic Insight** |
| Secondary (Domination) | **Sudden Impact + Treasure Hunter** |
| Shards | Adaptive / Adaptive / **Health** |

Non-obvious "why"s: First Strike on an assassin works because you always
attack first from fog — 7% true-damage amp on your full combo plus ~50% of
that bonus converted to gold, so it's both burst *and* an economy engine
that keeps you item-ahead of Silver junglers. **Cash Back over Magical
Footwear matters**: the lazy copy-paste page (Magical Footwear + Ultimate
Hunter) is the most-played at both tiers but wins 42.8% at Silver, while
the Cash Back + Treasure Hunter version wins **46.5–48.7% at Silver and
50.3–50.5% at Emerald+** (n=6,009+5,465 there — not noise). DeepLoL's
KR-recommended page is this exact Cash Back version. Ultimate Hunter
instead of Treasure Hunter is the one genuine coin-flip (more ults for
picks vs. gold); the data leans Treasure Hunter at every tier.

### 2. Alternative keystone: Electrocute

Electrocute > Sudden Impact > Grisly Mementos > Treasure Hunter, secondary
Magical Footwear + Cosmic Insight. Take it only when the game will be
decided by repeated 2v2/3v3 skirmishes before items matter — e.g. both bot
lanes perma-fight or you're planning to camp one lane from level 3, where
First Strike's gold ramp never pays off. Honesty required: it's 41.7% at
Silver / 43.7% at Emerald+ — worse than First Strike everywhere — and the
Precision-secondary version (Presence of Mind + Last Stand) is the single
worst common page at **36.2%** (n=1,479). If you take Electrocute, never
that variant. Dark Harvest and Hail of Blades are statistically dead this
patch (n<100 at Silver). *(Owner's amendment above: keeping Dark Harvest
anyway — n<100 cuts both ways.)*

### 3. Spells, starters, companion

**Smite + Flash** (both sources show nothing else with a sample). Start
**Gustwalker Hatchling + 1 Health Potion** — Gustwalker is 60% pick at
both tiers and its fully-grown brush move-speed is the gank/escape pet,
which is also the protect-your-bounty pet. Scorchclaw (38% pick, burn+slow
for harder early dueling) is fine if you're planning an invade comp;
Mosstomper is a 1% pick (n=160 at Silver — noise, skip). Patch note: 26.16
buffed pet scaling only for AP/armor/MR ratios, i.e. mage/tank junglers —
nothing changed for you.

### 4. Core build (first 3 items)

**Silver pick: Hubris → Voltaic Cyclosword → Serylda's Grudge**, Ionian
Boots of Lucidity between items 1–2. First back: Serrated Dirk (1000g) or
The Brutalizer (1337g).

This is the "highest winrate" side of a real popularity/winrate split,
consistent at every tier and both sources:

| First item | Silver pick | Silver WR | Emerald+ WR |
|---|---|---|---|
| Profane Hydra (most popular) | 49% | **41.0%** | 44.8% |
| Hubris | 31% | **45.5%** | 47.5% |
| Voltaic first | 14% | 45.7% | 50.6% |

Full-core samples: Profane→Voltaic→Serylda's 45.8% (Silver n=1,578) vs
Hubris→Voltaic→Axiom Arc **53.1%** (n=620) / Hubris→Voltaic→Serylda's
50.7% (Emerald+ n=2,533). DeepLoL KR shows the same shape: Profane path
48.2% (n=4,131) vs Hubris path 52.2% (n=1,283). Why Hubris in Silver
specifically: you already generate kills (8.7/game), and Hubris pays AD
for exactly that, while Profane's value is AoE clear/waveclear
consistency. **Deviate to Profane first** when you're against a farm-race
jungler (Karthus-style or a full-clear Shyvana) or you got counter-jungled
early and need to reset on camps — it's the "I'm behind, let me farm"
first item. Boots: Ionian is default (82% pick), but see §7.

### 5. Situational items (trigger → response)

- **They have 2+ shields/barriers** (Shen, Lulu, Riven, Samira, Sterak's
  users) → **Serpent's Fang** 3rd/4th, before their shield champ hits two
  items.
- **You're carrying a 500g+ shutdown and they have one big lockup spell**
  (Elise cocoon, Morgana Q, Lux Q) → **Edge of Night** 3rd (52.4% WR as
  3rd at Emerald+; the spell shield eats the pick attempt that normally
  refunds your lead).
- **Two or more hard-CC chains or heavy AP** → **Mercury's Treads** (48.4%
  WR at Silver vs Ionian's 42.6%); three autoattackers/AD → Plated
  Steelcaps. *(Owner's amendment above: Gluttonous Greaves preferred when
  the danger is extended duels rather than lockup chains.)*
- **You're fed by 20:00 and their carries are 3 squishies** → **Axiom
  Arc** 3rd — ult resets chain picks into objectives; this is the win-more
  slot.
- **Ahead but games stall on towers** (your known 15–25min leak) →
  **Bastionbreaker** 2nd/3rd: 55 AD/22 lethality plus true damage on
  abilities, and takedowns supercharge your next hit on turrets/epic
  monsters — it mechanically converts picks into structures. Caveat: 54.5%
  WR with n=5,076 at Emerald+, but only n=748 (46.5%) at Silver — a
  promising, not proven, Silver pick.
- **Fifth item when carrying a big bounty** → **Guardian Angel** (57.8% WR
  as 5th at Silver, the standard closer).

### 6. Skill order + patch-current notes

**Q max → W → E** (96–97% pick). Level order: the most-copied start is
Q-W-E-Q-Q-R, but the **higher-winrate variant at both tiers is
Q-W-Q-E-Q-R** (E at level 4; 52.0% vs 47.5% at Silver, 55.1% vs 52.7% at
Emerald+) — the extra early Q point is your clear speed; take E at 3 only
when you're forcing a level-3 gank. Most common full-clear routes: blue
side **Blue→Gromp→Wolves→Raptors→Red→Krugs**; red side
**Raptors→Red→Krugs→Wolves→Blue→Gromp**.

Patch-current facts: 175% Q monster damage (the 26.13 re-buff is *why* her
clears feel fine again) and W's 15–35% attack speed (buffed 25.16) are the
jungle enablers; 26.04's HP-growth nerf (121→115) is part of why she's
squishier than you remember. 26.16 touched nothing of hers directly —
Tiamat +5 AD marginally helps Profane rushes, and the Eclipse buff is
irrelevant (under 1% pick on her). No currently documented live bugs on
the wiki. Mechanics worth abusing: brush element gives camouflage+MS for
gank approach, river element Q briefly roots then slows (your best gank
element), wall element deals bonus damage below 50% HP (take it for
smite-fight windows), and R stops on terrain but detonates along it —
including player-created terrain (Jarvan R, Trundle pillar, Anivia/Yorick
walls: free full-lobby knockup if you track your allies' cages).

### 7. "Protect the lead" variant (built for your 5.8 deaths/game, 15–25min window)

Keep the same First Strike page — it's already the low-coin-flip option
(it pays you for *starting* fights, not for ending them at 10% HP). The
swaps, and exactly when they're worth it:

- **Mercury's Treads over Ionian** the moment you're 2+ kills up against
  any 2+ CC comp. Cost: ~10 ability haste. It's the cheapest insurance in
  the build and it's winrate-positive at Silver *without* the lead
  confound being deniable — into CC it's simply correct.
- **Edge of Night 3rd over Axiom Arc** whenever your own shutdown is
  500g+. Axiom is the greed line (more ults, more fights); Edge of Night
  is the "one blocked Morgana Q = my lead survives" line. Rule: shutdown
  ≥500g and no vision control → Edge of Night, every time.
- **Guardian Angel 5th by ~28:00**, not 6th, in any game where you're the
  primary bounty.
- **Gustwalker** — the brush MS is your post-kill *exit*, which matters
  more to your LP than Scorchclaw's extra duel damage.
- The one behavioral rider the data supports: Treasure Hunter + First
  Strike + Bastionbreaker all pay out on the same action — kill, then
  immediately spend the tempo on grubs/drake/tower **with your team**
  (your 45% KP is the leak; the runes literally pay gold for fixing it).
  After any death past 15:00: no solo re-engage for one full item
  component.

When it's worth it: any game where you're ahead at 14 minutes — which per
your profile is most of them. You trade roughly one item slot and ~10
haste of damage; against that, your season-long pattern is that the 15–25
window, not raw damage, decides your games.

**Matchup quick-reference (Silver, n≥100, both sources agree):** respect
bans/dodges for **Lillia (34.5%), Nocturne (38.5%), Warwick (39.0%), Kayn
(39.2%), Graves (40.0%)**; Jarvan, Lee Sin, Sylas also consistently bad.
Best of the common field: Vi (49.7%), Diana (49.2%), Shaco (47.0%), Viego
(46.1%). Note the tier disagreement worth knowing: Master Yi and Bel'Veth
are *winning* matchups at KR Emerald+ (57%/54%) but losing ones at Silver
(41%/37%) — stat-checkers punish Silver Qiyana play, so don't pick her
into them expecting the high-elo result.

Sources: [Riot patch 26.16 notes](https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-16-notes/) · [wiki: Qiyana patch history](https://wiki.leagueoflegends.com/en-us/Qiyana/Patch_history) · [wiki: Qiyana](https://wiki.leagueoflegends.com/en-us/Qiyana) · [wiki: First Strike](https://wiki.leagueoflegends.com/en-us/First_Strike) · [op.gg Qiyana jungle](https://op.gg/lol/champions/qiyana/build/jungle) (+ its champion API, Silver & Emerald+ filters) · [DeepLoL Qiyana jungle](https://www.deeplol.gg/champions/qiyana/build/jungle) (KR Emerald+ backend) · [esports.gg 26.16 summary](https://esports.gg/news/league-of-legends/all-league-of-legends-patch-26-16-notes-and-details/) · [GameRiv 26.17 preview](https://gameriv.com/lol-patch-26-17-preview/) · [escorenews 26.17 preview](https://escorenews.com/en/news/80430-league-of-legends-patch-notes-26-17-16-17-preview-nerfs-to-vayne-nasus-graves-buffs-to-aurelion-sol-qiyana-yone)
