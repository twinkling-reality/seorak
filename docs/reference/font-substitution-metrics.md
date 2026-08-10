# Font substitution metrics

**What this is.** Measured font-table metrics for the face Seorak ships today
(TT Commons Pro) and for three OFL-1.1 candidates that could replace it. It
exists so the substitution is chosen from numbers rather than from names.

**Why it exists.** Input to [ADR 005](../adr/005-open-core-repository-and-free-ui-packaging.md),
decision 6 ("Fonts and licensed media"), which holds that TT Commons Pro must not
be published and the public core must not depend on it. This document does not
make that decision or pick the replacement; it supplies the measurements the
decision needs.

**How it was measured.** Every number below was read directly out of the `head`,
`OS/2`, `hhea`, `hmtx`, `cmap`, `maxp`, `name`, and `fvar` tables of the actual
binaries. Two independent readers were used and cross-checked against each
other: a hand-written Node parser (WOFF inflate + sfnt table directory) and
fontTools 4.63.0 in a throwaway virtualenv. They agree on every field reported
here. Candidate binaries came from the `@fontsource/*` npm packages installed
outside this repository; nothing was added to `package.json`.

All four faces use `unitsPerEm` 1000, so every raw value below is directly
comparable with no normalisation.

---

## 1. What is actually in the repo

Twelve tracked binaries, 1,869,336 bytes total, across three surfaces.

**All twelve are WOFF containers.** First four bytes are `77 4f 46 46` (`wOFF`)
in every one, including the eight that are named `.ttf` for the iOS and macOS
bundles. This confirms the claim in ADR 005 decision 6.

**They hold 8 distinct blobs, but only 4 distinct designs.** By SHA-256:

| Weight | `packages/web/public/fonts/*.woff` | `apps/mobile/assets/fonts/*.ttf` | `apps/menubar/.../Fonts/*.ttf` |
|---|---|---|---|
| Light | `ea2049b6badb0311` | `83d3fcdc10654314` | `83d3fcdc10654314` |
| Regular | `40637adbc5e021ce` | `06b21f38d79a4179` | `06b21f38d79a4179` |
| Medium | `fab7fa15be7a797d` | `0d6a6db97151a28e` | `0d6a6db97151a28e` |
| DemiBold | `e4c3362c4078a9c3` | `d25eae6264cb9dbe` | `d25eae6264cb9dbe` |

The mobile and menu bar copies are byte-identical to each other. The web copy of
each weight differs from the mobile/menubar copy in exactly one table, `head`,
and within it in exactly two fields — `checkSumAdjustment` and `modified`. Same
outlines, same metrics, re-exported at a different time. Every other table is
byte-for-byte equal, which is why the measured metrics below are identical for
the web and mobile/menubar copies of a given weight.

**The prior audit's reference points are confirmed, with one correction.**
`unitsPerEm` is 1000 and `sCapHeight` is 700 exactly, at all four weights.
`sxHeight` is *not* a single value — it rises with weight: 496 / 500 / 503 / 506.
"About 500" was right; the exact figure depends on which weight you mean.

---

## 2. Reference face — TT Commons Pro

OS/2 table version 4, so `sCapHeight` and `sxHeight` are present and valid.
No `fvar` table: these are static cuts, not a variable font. 2,519 glyphs each.

| | Light | Regular | Medium | DemiBold |
|---|---|---|---|---|
| `usWeightClass` | 300 | 400 | 500 | 600 |
| `unitsPerEm` | 1000 | 1000 | 1000 | 1000 |
| `sCapHeight` | 700 | 700 | 700 | 700 |
| `sxHeight` | 496 | 500 | 503 | 506 |
| `typoAscender` | 1000 | 1000 | 1000 | 1000 |
| `typoDescender` | -250 | -250 | -250 | -250 |
| `typoLineGap` | 0 | 0 | 0 | 0 |
| hhea `ascender` | 1000 | 1000 | 1000 | 1000 |
| hhea `descender` | -250 | -250 | -250 | -250 |
| hhea `lineGap` | 0 | 0 | 0 | 0 |
| avg advance, a–z | 471.46 | 476.35 | 488.77 | 502.15 |
| avg advance, 0–9 | 521.60 | 521.70 | 531.00 | 541.10 |
| digits tabular? | no | no | no | no |

hhea and OS/2 typo metrics agree exactly, at every weight. The em box is
1000 + 250 = 1250 units with zero line gap.

### Family topology — per-weight families

Read from the `name` table, Windows/English records (platform 3, encoding 1,
language 0x409):

| nameID | Light | Regular | Medium | DemiBold |
|---|---|---|---|---|
| 1 (family) | `TT Commons Pro Light` | `TT Commons Pro` | `TT Commons Pro Medium` | `TT Commons Pro DemiBold` |
| 2 (subfamily) | `Regular` | `Regular` | `Regular` | `Regular` |
| 4 (full name) | `TT Commons Pro Light` | `TT Commons Pro Regular` | `TT Commons Pro Medium` | `TT Commons Pro DemiBold` |
| 6 (PostScript) | `TTCommonsPro-Lt` | `TTCommonsPro-Rg` | `TTCommonsPro-Md` | `TTCommonsPro-Db` |
| 16 (typographic family) | `TT Commons Pro` | `TT Commons Pro` | `TT Commons Pro` | `TT Commons Pro` |
| 17 (typographic subfamily) | `Light` | `Regular` | `Medium` | `DemiBold` |

So the legacy family (ID 1) is per-weight and ID 2 is always `Regular` — each
weight presents to the OS as its own family, which is what
`SeorakMenuTheme.swift:16` documents and what forces the four-case enum binding
by PostScript name at lines 20-23. Note the refinement: IDs 16 and 17 *are*
present and *do* unify the four cuts under one typographic family. The face is a
single typographic family wearing four legacy family names, not four unrelated
families.

---

## 3. Candidates

All three are OFL-1.1. The licence text was read from the `LICENSE` file
shipped inside each npm package, and the SPDX identifier from the `license`
field of each `package.json` (line 43 in all three) and from
`metadata.json → license.type`.

| Candidate | npm package | LICENSE file read | Declared | Upstream |
|---|---|---|---|---|
| Figtree | `@fontsource/figtree` | `node_modules/@fontsource/figtree/LICENSE` | OFL-1.1 | Copyright 2022 The Figtree Project Authors |
| Plus Jakarta Sans | `@fontsource/plus-jakarta-sans` | `node_modules/@fontsource/plus-jakarta-sans/LICENSE` | OFL-1.1 | Copyright 2020 The Plus Jakarta Sans Project Authors |
| Hanken Grotesk | `@fontsource/hanken-grotesk` | `node_modules/@fontsource/hanken-grotesk/LICENSE` | OFL-1.1 | Copyright 2021 The Hanken Grotesk Project Authors |

Each LICENSE opens with the copyright line and then "This Font Software is
licensed under the SIL Open Font License, Version 1.1." All three are sourced
from `github.com/google/fonts`.

### 3.1 Figtree

| | 300 | 400 | 500 | 600 |
|---|---|---|---|---|
| `usWeightClass` | 300 | 400 | 500 | 600 |
| `unitsPerEm` | 1000 | 1000 | 1000 | 1000 |
| `sCapHeight` | 700 | 700 | 700 | 700 |
| `sxHeight` | 500 | 500 | 500 | 500 |
| `typoAscender` | 950 | 950 | 950 | 950 |
| `typoDescender` | -250 | -250 | -250 | -250 |
| `typoLineGap` | 0 | 0 | 0 | 0 |
| hhea `ascender` | 950 | 950 | 950 | 950 |
| hhea `descender` | -250 | -250 | -250 | -250 |
| hhea `lineGap` | 0 | 0 | 0 | 0 |
| avg advance, a–z | 498.81 | 507.04 | 512.85 | 519.92 |
| avg advance, 0–9 | 559.10 | 563.60 | 566.40 | 570.10 |
| digits tabular? | no | no | no | no |

### 3.2 Plus Jakarta Sans

| | 300 | 400 | 500 | 600 |
|---|---|---|---|---|
| `usWeightClass` | 300 | 400 | 500 | 600 |
| `unitsPerEm` | 1000 | 1000 | 1000 | 1000 |
| `sCapHeight` | 745 | 745 | 745 | 745 |
| `sxHeight` | 531 | 536 | 539 | 541 |
| `typoAscender` | 1038 | 1038 | 1038 | 1038 |
| `typoDescender` | -222 | -222 | -222 | -222 |
| `typoLineGap` | 0 | 0 | 0 | 0 |
| hhea `ascender` | 1038 | 1038 | 1038 | 1038 |
| hhea `descender` | -222 | -222 | -222 | -222 |
| hhea `lineGap` | 0 | 0 | 0 | 0 |
| avg advance, a–z | 539.46 | 540.31 | 547.69 | 554.81 |
| avg advance, 0–9 | 583.50 | 592.30 | 594.40 | 596.50 |
| digits tabular? | no | no | no | no |

### 3.3 Hanken Grotesk

| | 300 | 400 | 500 | 600 |
|---|---|---|---|---|
| `usWeightClass` | 300 | 400 | 500 | 600 |
| `unitsPerEm` | 1000 | 1000 | 1000 | 1000 |
| `sCapHeight` | 697 | 697 | 697 | 697 |
| `sxHeight` | 493 | 493 | 493 | 493 |
| `typoAscender` | 1000 | 1000 | 1000 | 1000 |
| `typoDescender` | -303 | -303 | -303 | -303 |
| `typoLineGap` | 0 | 0 | 0 | 0 |
| hhea `ascender` | 1000 | 1000 | 1000 | 1000 |
| hhea `descender` | -303 | -303 | -303 | -303 |
| hhea `lineGap` | 0 | 0 | 0 | 0 |
| avg advance, a–z | 499.35 | 503.65 | 506.46 | 509.38 |
| avg advance, 0–9 | 560.00 | 560.00 | 560.00 | 560.00 |
| digits tabular? | **yes** | **yes** | **yes** | **yes** |

In all three candidates, hhea and OS/2 typo metrics agree exactly, matching the
reference's behaviour.

---

## 4. Advance widths, per glyph

Reference rows are TT Commons Pro. Units are 1/1000 em throughout.

### Lowercase a–z

| Face / weight | a | b | c | d | e | f | g | h | i | j | k | l | m | n | o | p | q | r | s | t | u | v | w | x | y | z |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **TTCP Light** | 494 | 579 | 524 | 579 | 537 | 281 | 560 | 556 | 199 | 199 | 441 | 209 | 792 | 551 | 548 | 574 | 574 | 316 | 426 | 311 | 551 | 468 | 663 | 440 | 467 | 419 |
| **TTCP Regular** | 497 | 576 | 526 | 576 | 537 | 294 | 559 | 560 | 209 | 209 | 455 | 219 | 792 | 555 | 548 | 571 | 571 | 321 | 435 | 320 | 555 | 478 | 678 | 454 | 474 | 416 |
| **TTCP Medium** | 506 | 585 | 537 | 585 | 548 | 309 | 569 | 570 | 223 | 223 | 474 | 233 | 806 | 565 | 559 | 580 | 580 | 334 | 446 | 335 | 565 | 490 | 701 | 470 | 487 | 428 |
| **TTCP DemiBold** | 515 | 595 | 549 | 595 | 560 | 326 | 580 | 580 | 237 | 237 | 495 | 247 | 820 | 575 | 572 | 590 | 590 | 349 | 458 | 352 | 575 | 503 | 725 | 488 | 502 | 441 |
| Figtree 300 | 501 | 582 | 539 | 582 | 543 | 360 | 582 | 554 | 220 | 260 | 465 | 210 | 843 | 554 | 579 | 587 | 572 | 322 | 466 | 368 | 554 | 506 | 764 | 452 | 507 | 497 |
| Figtree 400 | 510 | 586 | 541 | 586 | 546 | 369 | 587 | 558 | 232 | 269 | 485 | 220 | 851 | 558 | 580 | 591 | 578 | 338 | 466 | 378 | 558 | 520 | 784 | 475 | 526 | 491 |
| Figtree 500 | 516 | 589 | 542 | 588 | 548 | 376 | 591 | 561 | 240 | 275 | 500 | 227 | 857 | 561 | 580 | 594 | 581 | 349 | 466 | 384 | 561 | 530 | 798 | 492 | 540 | 488 |
| Figtree 600 | 524 | 592 | 544 | 591 | 551 | 384 | 596 | 565 | 250 | 282 | 517 | 236 | 864 | 564 | 581 | 597 | 586 | 363 | 466 | 393 | 564 | 542 | 815 | 512 | 556 | 483 |
| PJS 300 | 573 | 671 | 604 | 671 | 621 | 390 | 663 | 572 | 225 | 225 | 544 | 225 | 909 | 572 | 659 | 671 | 671 | 339 | 508 | 384 | 572 | 518 | 783 | 481 | 533 | 442 |
| PJS 400 | 572 | 667 | 600 | 667 | 615 | 393 | 662 | 573 | 229 | 229 | 548 | 229 | 908 | 573 | 655 | 667 | 667 | 338 | 509 | 388 | 573 | 517 | 797 | 487 | 536 | 449 |
| PJS 500 | 575 | 669 | 603 | 669 | 614 | 397 | 659 | 580 | 237 | 237 | 558 | 237 | 913 | 580 | 654 | 669 | 669 | 350 | 511 | 396 | 580 | 533 | 826 | 511 | 553 | 460 |
| PJS 600 | 578 | 670 | 606 | 670 | 613 | 402 | 655 | 586 | 245 | 245 | 567 | 245 | 919 | 586 | 653 | 670 | 670 | 362 | 512 | 405 | 586 | 550 | 855 | 535 | 569 | 471 |
| Hanken 300 | 537 | 593 | 516 | 594 | 539 | 329 | 507 | 537 | 217 | 217 | 518 | 258 | 820 | 537 | 579 | 593 | 594 | 397 | 467 | 334 | 537 | 516 | 747 | 511 | 516 | 473 |
| Hanken 400 | 540 | 587 | 518 | 587 | 540 | 335 | 514 | 547 | 226 | 226 | 532 | 265 | 828 | 547 | 577 | 587 | 587 | 407 | 470 | 346 | 547 | 521 | 748 | 520 | 521 | 472 |
| Hanken 500 | 542 | 583 | 519 | 583 | 540 | 339 | 517 | 553 | 232 | 232 | 541 | 269 | 833 | 553 | 575 | 583 | 583 | 413 | 471 | 353 | 553 | 526 | 750 | 527 | 526 | 472 |
| Hanken 600 | 544 | 579 | 521 | 579 | 541 | 344 | 520 | 559 | 239 | 239 | 550 | 273 | 838 | 559 | 574 | 579 | 579 | 420 | 471 | 360 | 559 | 530 | 752 | 534 | 530 | 471 |

### Digits 0–9

| Face / weight | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|---|
| **TTCP Light** | 604 | 322 | 525 | 535 | 530 | 550 | 552 | 484 | 562 | 552 |
| **TTCP Regular** | 598 | 330 | 529 | 532 | 534 | 551 | 549 | 489 | 556 | 549 |
| **TTCP Medium** | 605 | 345 | 534 | 539 | 545 | 558 | 560 | 498 | 566 | 560 |
| **TTCP DemiBold** | 612 | 361 | 540 | 546 | 556 | 566 | 573 | 508 | 576 | 573 |
| Figtree 300 | 638 | 410 | 551 | 539 | 616 | 572 | 560 | 530 | 615 | 560 |
| Figtree 400 | 641 | 413 | 559 | 544 | 621 | 575 | 566 | 537 | 614 | 566 |
| Figtree 500 | 643 | 416 | 564 | 547 | 624 | 576 | 569 | 542 | 614 | 569 |
| Figtree 600 | 645 | 419 | 571 | 551 | 628 | 578 | 574 | 548 | 613 | 574 |
| PJS 300 | 723 | 355 | 589 | 604 | 618 | 612 | 592 | 533 | 617 | 592 |
| PJS 400 | 732 | 371 | 600 | 609 | 630 | 616 | 597 | 543 | 628 | 597 |
| PJS 500 | 724 | 382 | 599 | 610 | 638 | 616 | 599 | 548 | 629 | 599 |
| PJS 600 | 716 | 392 | 598 | 611 | 646 | 615 | 601 | 554 | 631 | 601 |
| Hanken 300 | 560 | 560 | 560 | 560 | 560 | 560 | 560 | 560 | 560 | 560 |
| Hanken 400 | 560 | 560 | 560 | 560 | 560 | 560 | 560 | 560 | 560 | 560 |
| Hanken 500 | 560 | 560 | 560 | 560 | 560 | 560 | 560 | 560 | 560 | 560 |
| Hanken 600 | 560 | 560 | 560 | 560 | 560 | 560 | 560 | 560 | 560 | 560 |

TT Commons Pro has strongly proportional figures — the `1` is roughly half the
width of the `0` (322 vs 604 at Light). Hanken Grotesk is the opposite: fully
tabular, every digit 560. Figtree and Plus Jakarta Sans are proportional like
the reference but with a much less narrow `1`.

---

## 5. Family topology of the candidates

This is what decides whether the menu bar and mobile bindings *rename* or
*restructure*.

**Upstream, all three are one family with a weight axis.** Read from the `fvar`
table of the variable release of each:

| Candidate | `fvar` axes | Named instances covering 300/400/500/600 |
|---|---|---|
| Figtree | `wght` 300–900, default 300 | Light, Regular, Medium, SemiBold — all four present |
| Plus Jakarta Sans | `wght` 200–800, default 400 | Light, Regular, Medium, SemiBold — all four present |
| Hanken Grotesk | `wght` 100–900, default 400 | Light, Regular, Medium, SemiBold — all four present |

Every weight Seorak ships exists as a named instance in all three. None requires
an off-instance interpolation.

**But the static cuts shipped by `@fontsource/*` name themselves per weight,
exactly like TT Commons Pro does.** From the `name` table of the static files:

| Candidate | nameID 1 at 300 / 400 / 500 / 600 | nameID 6 at 300 / 400 / 500 / 600 |
|---|---|---|
| Figtree | `Figtree Light` / `Figtree` / `Figtree Medium` / `Figtree SemiBold` | `Figtree-Light` / `Figtree-Regular` / `Figtree-Medium` / `Figtree-SemiBold` |
| Plus Jakarta Sans | `Plus Jakarta Sans Light` / `Plus Jakarta Sans` / `Plus Jakarta Sans Medium` / `Plus Jakarta Sans SemiBold` | `PlusJakartaSans-Light` / `-Regular` / `-Medium` / `-SemiBold` |
| Hanken Grotesk | `Hanken Grotesk Light` / `Hanken Grotesk` / `Hanken Grotesk Medium` / `Hanken Grotesk SemiBold` | `HankenGrotesk-Light` / `-Regular` / `-Medium` / `-SemiBold` |

nameID 2 is `Regular` on every static cut, and nameID 16 is absent on all of
them (the reference *has* nameID 16). So the static cuts are, if anything,
*more* per-weight than TT Commons Pro is.

**Consequence for the three surfaces.** Choosing the `@fontsource` static cuts
is a rename in all three places:

- `apps/menubar/Sources/SeorakMenuBar/SeorakMenuTheme.swift:20-23` binds by
  PostScript name (`TTCommonsPro-Lt` etc.) and loads by file name at lines
  32-35. Both become four new strings. The four-case enum shape and the
  `.custom(face.rawValue, size:)` call at line 56 are unchanged.
- `apps/mobile/src/fonts.ts:16-19` registers under arbitrary keys
  (`TTCommonsPro_300Light` etc.) consumed by `theme/tokens.ts:75-79`. Rename
  the keys and the `require` paths; the structure is already weight-keyed.
- `packages/web/src/app.css:15-40` already declares one `@font-face` family with
  four `font-weight` values, so it works under either topology unchanged apart
  from the family string and the four URLs.

Choosing the **variable** release instead is the restructure: one file replaces
four, the menu bar enum would collapse to a weight parameter, and the CSS would
move to `font-variation-settings` or a `font-weight` range. That is a larger
change, and it is optional — the static route is available for all three
candidates.

---

## 6. Distance from the reference

Deltas are candidate minus reference, in 1/1000 em, averaged over the four
shipped weights. Smaller is closer.

| Metric | Figtree | Plus Jakarta Sans | Hanken Grotesk |
|---|---|---|---|
| `sCapHeight`, mean abs delta | **0.00** | 45.00 | 3.00 |
| `sxHeight`, mean abs delta | **3.25** | 35.50 | 8.25 |
| `typoAscender`, mean abs delta | 50.00 | 38.00 | **0.00** |
| `typoDescender`, mean abs delta | **0.00** | 28.00 | 53.00 |
| `typoLineGap`, mean abs delta | **0.00** | **0.00** | **0.00** |
| hhea asc/desc/gap | same as typo | same as typo | same as typo |
| em box (asc − desc), vs 1250 | 1200 (−50) | 1260 (**+10**) | 1303 (+53) |
| avg a–z advance, mean abs delta | 24.97 | 60.88 | **20.03** |
| avg 0–9 advance, mean abs delta | 35.95 | 62.83 | **31.15** |
| **per-letter** a–z, mean abs delta | **26.93** | 60.92 | 30.16 |
| **per-digit** 0–9, mean abs delta | **35.95** | 62.83 | 42.90 |
| worst single digit delta | **81.5** | 119.0 | 220.5 |

### Ranking

1. **Figtree** — closest overall.
2. **Hanken Grotesk** — close second, different trade.
3. **Plus Jakarta Sans** — clear third, not close on any axis.

Figtree matches the reference's cap height exactly (700, all four weights) and
its x-height to within 3.25 units on average, which are the two numbers that
govern whether text looks the same size at a given `px` value. It also matches
`typoDescender` exactly. Its one real miss is a 50-unit shorter ascender, giving
a 1200-unit em box against the reference's 1250 — a 4% tighter default line box.

Hanken Grotesk takes the opposite trade: it matches `typoAscender` exactly
(1000) and cap height to within 3 units, but its descender is 53 units deeper
(−303 vs −250), giving a 1303-unit em box, 4% taller. On macOS the menu bar
lays out from hhea metrics, so this is the one candidate that will visibly
change row heights there without a compensating line-height change.

Plus Jakarta Sans is larger than the reference on every single axis — cap +45,
x-height +35, advances +61 — so it renders noticeably bigger and wider at the
same nominal size. Nothing in the measurements recommends it over the other two.

### What the ranking is actually sensitive to

**It flips between Figtree and Hanken depending on whether you weight vertical
proportion or horizontal fit, and on how you measure horizontal fit.**

1. **Vertical vs horizontal.** Rank by cap height and x-height and Figtree wins
   decisively (0.00 and 3.25 against 3.00 and 8.25). Rank by average advance
   width and Hanken wins (20.03 against 24.97 for lowercase). If the priority is
   "existing layouts must still fit", that argues Hanken; if it is "text must
   look the same size", that argues Figtree.

2. **Average advance is a misleading measure, and it is the measure that makes
   Hanken look best.** Hanken's average digit width is 31.15 from the reference,
   better than Figtree's 35.95 — but that average is an artefact. Hanken's
   digits are *tabular*: every one is 560. TT Commons Pro's are strongly
   proportional, from 322 for the `1` to 612 for the `0`. Compare digit by digit
   instead of average to average and the order reverses: Figtree 35.95, Hanken
   42.90, and Hanken's worst single digit is 220.5 units off (its `1`, 560
   against ~340) versus Figtree's 81.5. Any ranking that uses delta-of-averages
   rather than mean-of-per-glyph-deltas will overrate Hanken. The same effect is
   milder but present for lowercase: Hanken 20.03 by average, 30.16 per letter.

3. **Whether tabular figures are wanted.** Point 2 counts Hanken's tabular
   figures as a defect because it measures distance from the current face. For a
   product whose surfaces are mostly numbers, non-jittering columns may be worth
   *more* than similarity. If the owner decides tabular figures are desirable,
   Hanken supplies them with no feature-flag work and its ranking on digits
   should be read as a plus rather than a 220-unit miss.

4. **Which weight matters most.** Hanken converges on the reference as weight
   rises (lowercase delta 27.88 → 27.31 → 17.69 → 7.23) while Figtree's peaks at
   Regular (27.35 → 30.69 → 24.08 → 17.77). If the decision is driven by body
   text at 400, Figtree is 30.69 off and Hanken 27.31 — Hanken wins that single
   comparison. Weighted toward DemiBold headings, Hanken wins by more. Averaging
   all four weights equally, as the table above does, favours Figtree.

5. **Line height.** Both near-miss candidates are ~4% off the reference em box,
   in opposite directions (Figtree −50, Hanken +53). Plus Jakarta Sans is
   closest here at +10 — the one metric where the third-place candidate leads.
   If the surfaces set explicit `line-height` everywhere, this matters little
   and should be discounted; if any surface relies on default line boxes, it
   matters a lot and should be checked before choosing.

---

## 7. Caveats

- **Candidate glyph coverage was not compared.** The `@fontsource` files
  measured are Latin subsets — 263 to 285 glyphs — against the reference's
  2,519. Subsetting does not alter `head`, `OS/2`, or `hhea`, and per-glyph
  advance widths are preserved, so every metric above is valid. But whether a
  candidate covers everything Seorak renders is a separate question this
  document does not answer.
- **Only the `normal` (upright) cuts were measured.** Italics ship in all three
  packages and were not examined.
- **The metrics come from the static cuts, not the variable fonts**, except for
  the `fvar` axis data in section 5, which necessarily comes from the variable
  release. Instancing the variable font at 300/400/500/600 should reproduce
  these numbers but that was not separately verified.
- **This document makes no recommendation.** It supplies measurements and an
  ordering with its sensitivities stated. The choice belongs to the owner.
