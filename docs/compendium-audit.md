# Compendium Audit: Attacks & Powers

An evaluation of every item in the **GMM Monster Attacks** (87) and **GMM Monster
Powers** (90) compendiums against the Monster Maker v3.0.0 rules, to surface abilities
that may need adjustment.

- Method: each item's blueprint fields (rarity, activation, deferral, target/range,
  damage formula, uses) plus its description text were scored against the rules captured
  in the `gmmc-monster-rules` skill - the Effect Points (EP) economy for ordinary
  features, and the separate budgets for Overkill/Frenzy attacks and role abilities.
- EP budget = rarity base (Common 1 / Uncommon 3 / Rare 5) +1 requirement/condition,
  +1 delayed/dooming, -1 free/bonus/reaction. Spend = the damage percentage plus the
  effects read from the description.
- Damage note: `[damage]` = 100% of the monster's DMG; the EP Deal Damage table runs
  100/125/150/175/200% for 1-5 EP. Multiattacks divide the rarity total across attacks.

## Summary

| Bucket | Attacks | Powers |
|---|---|---|
| A. Clean matches | ~76 | ~82 |
| B. Review candidates | 3 | 5 |
| C. Overkill attacks (own budget - acceptable) | 8 | 0 |

The content is overwhelmingly in-spec; the template libraries are essentially perfect.
The list below is the small remainder worth a look.

## A. Clean matches

All systematically-named attack templates (Melee/Ranged x Save/Area/Multiattack/
Condition/Movement/Resource/Ongoing/Delayed/Dooming across all three rarities) reconcile
exactly - damage percentages, multiattack division, area hit/miss, condition rarity, and
force-movement (10 ft/EP) all check out. On the powers side, the great majority of the
role abilities sit within tier, including elegant gated designs (Jump Scare, Pressure
Point, Barrier). No action needed.

## B. Review candidates

### Attacks (generic templates - should follow EP exactly) - FIXED

All three were corrected in the gmm-monster-attacks compendium (blueprint and mirrored
dnd5e `system` fields both updated).

| Item | Issue | Fix applied |
|---|---|---|
| (Common) Ranged Resource Attack | Granted a failed death save - a **Rare** resource (4 EP) on a **Common** (1 EP) template. | Changed to "loses one charge from an equipped magic item" (a Common resource, 1 EP), matching its melee sibling. |
| (Rare) Melee Resource Attack | 100% damage + failed death save + gold loss ~= 6 EP on a 5-EP budget. | Removed the 100% damage payload; now a pure resource attack (death save + gold = 5 EP), consistent with the other resource templates. |
| (Rare) Ranged Save Attack, Strong | Dealt 200%, but the Strong-save tier should be 175% (Weak sibling is 200%; Common/Uncommon Strong are 25% under Weak). | Reduced to 175% (`[round(damage*1.75), damageDie]`). |

### Powers (published role abilities - flagged for awareness, not necessarily bugs)

These are curated role/subrole abilities; the concern is effects with no rules basis to
price, or that exceed the book's own values. Adjust only if rebalancing.

| Item | Issue |
|---|---|
| (U) Reliable Attacker | "Treat the attack roll as a natural 11 (decide after seeing the result)." A strong accuracy floor with no EP equivalent (the nearest, Accurate, is just +2). |
| (U) Marked for Death | Conditional instant-death rider. Bounded (only when you would already drop the target to 0), but "instant death" has no EP cost. |
| (U) Curse | 125% ongoing damage with **no save** - only concentration. Ongoing effects are supposed to grant the target a save each turn; this denies it. |
| (U) Shielder | Grants 3x combat level temporary HP; the book's temp-HP boon (Barrier) is 1x combat level. Generous for uncommon. |
| (U) Deathtouch / (U) System Shock | Deliver a Rare resource (failed death save / exhaustion) on an Uncommon power. Gated behind a crit/kill, so borderline and low-impact; lower priority. |

## C. Overkill attacks - reclassified as acceptable

The eight named attacks below were initially flagged as "off-formula" because their 400%
damage exceeds the EP cap (200%). That was the wrong lens: they are **Overkill Attacks**
(Monster Maker p49-51), a separate system with its own budget - a charged, telegraphed,
auto-hitting ultimate that deals exactly four times base damage, with an optional
"Extreme" instant-death rider.

Items: **Whispers of Azatoth, Thunder Lance, Spirit Bomb, Reptile Spray, You're Already
Dead, Ice Age, Snap Neck, Devour.**

All eight faithfully implement the spec: `[round(damage*4)]` = 400%, `delayed 1` = the
charge/unleash cadence, `attack.type = other` (no roll/save) = auto-hit, an
`activation.condition` = the unlock trigger, `uses 1/lr`, and the Extreme instakill text.

**One gap** (optional to fix): the items carry the unlock trigger but not a rank
requirement, so nothing stops an overkill attack being placed on a grunt or minion. The
book restricts overkill to **elites and paragons**. If desired, set
`requirements.rank` to elite/paragon on these eight. The charge-turn self-vulnerability
(speed 0, can't act, optional weak point) is GM-runtime behavior and is expected not to
be encoded in the item.

## Reference

The rules applied here live in `.claude/skills/gmmc-monster-rules/` (scaling-engine,
features-effects, combat-roles, special-attacks). Book-vs-code engine findings are
separate and tracked in that skill's `FINDINGS.md`.
