# Font substitution result

**What this is.** The measurement table stage **B5** ("One typeface, every
surface") carries as its exit criterion, recorded after the substitution rather
than before it. It says what the face swap actually changed, which tuned values
were **re-derived** and which were **carried over with a stated reason**, and how
each claim was measured.

**Why it exists.** B5 is practically irreversible once dependent work lands on
the re-tuned type, so the numbers it was tuned against have to survive it. The
companion documents are [`font-substitution-metrics.md`](font-substitution-metrics.md),
which measured the candidate faces, and [`font-substitution-impact.md`](font-substitution-impact.md),
which measured the code. This one measures the outcome.

**The face is Figtree**, chosen by the owner from the measured candidates.
OFL-1.1, `@fontsource/figtree` 5.3.0 for the web and `@expo-google-fonts/figtree`
0.4.1 for the menu bar and mobile.

---

## 1. What the substitution had to fix

B6 packaged the dashboard and its offline install proved the defect: the published
tarball rendered in the **platform fallback face** and 404'd four fonts on every
load, because the licensed binaries could not travel in an npm tarball. Measured
again after B5, against a real offline install of the three tarballs:

| | B6, before | B5, after |
|---|---|---|
| `/fonts/*.woff` requests | 4 × **404** | 4 × **200**, `font/woff` |
| Registered faces | `TT Commons Pro` 300/400/500/600 all **error** | `Figtree` 300/400/500 **loaded**, 600 unloaded (no weight-600 text on the first screen) |
| `--sans` resolves to | `-apple-system` | `Figtree` |
| Product face present | no | yes |

Method: `npm pack` all three packages, `npm install --offline` into an empty
directory, run the installed collector's `seorak local dashboard` with no worker
URL, and read `document.fonts` and the network log from a real browser. This is
the same measurement B6 recorded, repeated.

---

## 2. Face metrics, incumbent against substitute

Read from the font tables of the shipped binaries. Both faces use `unitsPerEm`
1000, so raw values compare directly.

| Metric | TT Commons Pro | Figtree | Delta |
|---|---|---|---|
| `sCapHeight` | 700 | 700 | **0** |
| `sxHeight` (400) | 500 | 500 | **0** |
| `typoAscender` | 1000 | 950 | −50 |
| `typoDescender` | −250 | −250 | **0** |
| `typoLineGap` | 0 | 0 | 0 |
| content box | 1.250 em | 1.198 em | −0.052 em |
| mean advance a–z (400) | 476.35 | 507.04 | +6.4% |
| OpenType features | `tnum` `pnum` `zero` `onum` `lnum` + 40 more | `tnum` `pnum` `dnom` `frac` `numr` `kern` `locl` `ccmp` `mark` `mkmk` | — |

**Cap height and x-height match exactly**, which is why text reads at the same
size at every unchanged `font-size`, and why the display leading did not have to
move. **`tnum` and `pnum` both survive**, which matters because 81
`font-variant-numeric: tabular-nums` declarations in `packages/web/src` depend on
`tnum` existing; a candidate without it would have turned all 81 into silent
no-ops and made every stat column jitter. This was checked before the face was
chosen, and it is not in the candidate metrics document.

---

## 3. The tuned values

Four values were face-specific. Two were re-derived, two were carried over for a
stated and measured reason.

| Value | Before | After | Re-derived or carried |
|---|---|---|---|
| `--display-line` (display leading) | `0.96` | `0.96` | **carried, verified** |
| `--display-line-value` (clipping guard) | `1.15` | `1.02` | **RE-DERIVED** |
| `--display-spacing` (display tracking) | `-0.075em` | `-0.08em` | **RE-DERIVED** |
| `padding-inline-end` (trailing clip room) | `0.2em` | `0.2em` | **carried, reason corrected** |

### 3.1 `--display-line`, carried and verified

`line-height` is a ratio of **font-size**, not of the font's own box, and Figtree
matches the previous face's cap height and x-height exactly. So `0.96` puts
successive display baselines in the same place in both faces and the multi-line
heading rhythm is unchanged. This is the one tuned value the substitution left
alone on purpose, and it was checked rather than assumed.

### 3.2 `--display-line-value`, re-derived from rasterised ink

**Two cheaper instruments were tried first and both were wrong.** This is the
part worth keeping.

- `element.scrollHeight` vs `clientHeight` reports overflow for every stat value
  in both faces, because it counts the font's whole content box including
  descender space that digits never use. It over-reports identically before and
  after, so it can compare but cannot judge.
- Canvas `actualBoundingBoxAscent` under-reports the currency glyph, so a bound
  computed from it says "fits" for a string that the same model then predicts
  clips. An analytic bound built on it gave 0.9438 and would have justified
  deleting the guard.

The value below was measured by **drawing each string into a canvas whose height
IS the candidate line box and bisecting for the smallest box no lit pixel
escapes**, then confirmed by cropping the real element at 4× and comparing ink
height against the same element with the clip released.

| Case | px / weight | TT Commons Pro | Figtree | Worst string |
|---|---|---|---|---|
| hero stat value | 57.6 / 300 | 1.2413 | **0.9809** | `1,284,000` (Figtree), `(4)` (incumbent) |
| small stat value | 33.6 / 300 | 1.1161 | **0.9970** | `1,632` |
| display heading | 44.8 / 400 | 1.1942 | 1.1942 | `Projects` |

`1.02` is the larger numeric bound (0.9970) plus headroom. It is **not** 1.15
scaled, and it is not zero: at `--display-line` (0.96) a comma-bearing hero value
clips by roughly a pixel, so the guard still has to exist.

**The old comment's stated cause was wrong in two ways.** It said sub-1 leading
"clips the glyph tops"; the geometry says the **bottom** binds in every case
measured, for both faces. And `1.15` was under-tuned for its own face: TT Commons
Pro needed 1.2413 once a value could contain a parenthesis.

### 3.3 `--display-spacing`, re-derived by advance ratio

Figtree sets 6.4% wider at the same size (mean lowercase advance 507.04 against
476.35). The tightening exists because the previous face's default fit was judged
loose, so the number that holds constant is the optical tightness, not the value:
`-0.075 × 1.0644 = -0.0798`, rounded to **`-0.08em`**. The one inlined fallback
copy, `DesktopShellGate.module.css`, moved with it.

Measured width after re-tracking, worst string per class:

| Case | TT Commons Pro | Figtree | Change |
|---|---|---|---|
| hero stat value | 234.60 px | 261.16 px | +11.3% |
| chart value | 81.03 px | 90.78 px | +12.0% |
| page heading | 418.88 px | 436.58 px | +4.2% |
| hero heading | 597.20 px | 628.19 px | +5.2% |

### 3.4 `0.2em` trailing padding, carried with the reason corrected

The comment said this compensates the negative tracking pulling the box edge
inside the **last glyph's ink**, implying a sidebearing property of the face.
Measured at 100px, **neither face puts any ink past the advance** of a stat
value. What it actually compensates is the letter-spacing itself, which CSS
applies after the final glyph too, so the requirement is only to exceed
`|--display-spacing|`. `0.2em` clears `-0.08em` with room, so the value stands
and is no longer face-specific at all.

### 3.5 The 348 letter-spacing declarations

The raw count overstates the work by more than 4×, and this was measured by
parsing rule blocks rather than grepping lines, so the family and the tracking
are read from the same block.

| Family the rule sets | Declarations | Re-tuned? |
|---|---|---|
| `var(--mono)` | **217** | no — IBM Plex Mono is unchanged |
| `var(--display)` | 62 | yes, 13 of them centrally through `--display-spacing` |
| `var(--sans)` | 20 | yes |
| inherited from an ancestor | 47 | case by case |

**140 of the 146 tokenised values sit on the mono**, so `--tracking-stat`,
`--tracking-eyebrow`, `--tracking-table` and `--tracking-action` did not move.
The remaining literals on the substituted face are between `-0.001em` and
`-0.07em`; scaling them by the same 1.0644 changes each by under 0.004 em, which
is below a subpixel at every size they are used at, so they were left and the
screenshot gate was used to confirm nothing reflowed. One paragraph did — see §5.

---

## 4. The four per-weight bindings

TT Commons Pro was described as shipping each weight as its own family. That is
true of its legacy `name` ID 1 records and **false of ID 16**, which unified all
four cuts under one typographic family the whole time.

| Site | Before | After |
|---|---|---|
| `apps/menubar/.../SeorakMenuTheme.swift` | 4 PostScript names in an enum **plus** a second hand-maintained list of 4 filenames, and a `face(for:)` weight collapse | one family string `Figtree` plus SwiftUI `.weight(_:)`; the enum, the collapse, and the dead `display(_:weight:)` are deleted |
| `apps/mobile/src/fonts.ts` + `theme/tokens.ts` | 5 RN family names over 4 committed binaries | 4 keys from `@expo-google-fonts/figtree`, **no vendored binaries at all** |
| `packages/control-plane/src/htmlStyles.ts` | own `@font-face` block, 4 licensed URLs, pinned by `control-plane.test.ts:371` | one family, 4 OFL URLs, pin updated |
| `scripts/package-menubar.mjs` | hard assertion on 4 licensed filenames | hard assertion on the 4 Figtree filenames |

**The menu bar collapsed; React Native did not, and that is deliberate.**
Figtree's four cuts each carry `name` ID 16 `Figtree` (ID 17 gives
Light / Regular / Medium / SemiBold), so CoreText resolves the family from one
name plus a weight trait. `expo-font` is different: it registers each file under
the KEY given to `useFonts`, and that key **is** the family name React Native
resolves, so one family string plus `fontWeight` has nothing to select between.
Pointing the five keys at one string would keep all 146 call sites compiling and
render every one of them Regular. The mobile change is therefore a rename, and
`tokens.ts` says why.

**A defect fixed in passing.** The menu bar's four `.ttf` files were WOFF
containers, which `CTFontManagerRegisterFontsForURL` cannot register, so
`NSFont(name:)` was failing and every menu-bar label was rendering in the
`.system` fallback. The Figtree files are real TrueType.

---

## 5. Screenshot findings

Overview, Compare, Model and Settings, light and dark, at 1440 and 1024, plus the
shell gate at 390 — 18 captures before and after, each with a DOM probe for line
counts, active truncation, and overflow geometry.

**The dashboard gates below about 1024px** (`DesktopShellGate`), so a 390px pass
would photograph the same gate card eight times. The narrow width is therefore
1024, the narrowest width the dashboard actually renders at, and the gate card is
captured once because it carries its own inlined copy of `--display-spacing`.

| Check | Result |
|---|---|
| Clipped descenders | **none.** The flagged elements were pixel-checked at 4× against the same element with the clip released: ink height identical, 204 px and 112 px on the two worst classes |
| New ellipsis | **none.** One probe hit was a 1 px `srOnly` live-region element, not a visible truncation |
| Changed line counts | **one.** A Settings paragraph goes 8 → 9 lines at both widths, from the 6.4% wider face. Benign, and the only reflow in 18 captures |
| Fonts loaded | 6/6 in every capture, against 5/6 before (weight 600 was unloaded in both) |

Settings' section headings overflow their clip box by 5–6 px in **both** faces
(`--display-line` 0.96 against a 1.1942 bound). That is pre-existing, marginally
*better* with Figtree (5 px against 6 px), and out of B5's scope: it is a
consequence of the intended sub-1 display leading meeting `overflow: hidden`, not
of the substitution.

---

## 6. Gates

`web`, `mobile` and `menu-bar` suites green (1826 / 399 / 68), plus
`control-plane` 268. `build:web`, `publication:check`, `typecheck`, `copy:check`,
`vendored-assets:check`, `boundaries:check` and `open-core:check` all green.

**The publication gate was inverted, and that inversion is the stage.** It used
to *forbid* `dist/fonts/`; it now *requires* all four Figtree cuts and forbids
only `dist/fonts/TTCommonsPro`. It also fetches a product-sans `.woff` over
loopback from the installed collector, checking status and content type, because
"renders in the product face" should be a gate rather than a screenshot somebody
took once. Proved to fail by removing a source font and re-running.

The ownership map moved `packages/web/public/fonts/**` from `excluded` to
`public`, and the four boundary acceptances that named the licensed face were
deleted as falsified.

---

## 7. What this does not establish

- **Precondition P2 has not returned.** Qualified legal review of the TT Commons
  Pro history and the six agent brand-mark PNGs is still open. B5 removes the
  face from the working tree; it does not remove it from git history, which is
  ADR 005 decision 6's second half and phase C's problem.
- **The menu bar was not visually verified.** It builds and its suite passes, and
  the font files are now a container CoreText can register, but no screenshot of
  the running panel was taken.
- **Mobile was not run in a simulator.** Types, tests and the token rename are
  checked; the rendered weights are not.
- **Only the upright cuts ship.** Figtree has true italics and the repository now
  has the option `DESIGN_LANGUAGE.md` previously recorded as a constraint. No
  surface uses them.
