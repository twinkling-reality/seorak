# Font substitution impact

**Input to [ADR 005](../adr/005-open-core-repository-and-free-ui-packaging.md)
decision 6 ("Fonts and licensed media") and to its stage **B5**, "One typeface,
every surface".**

ADR 005 decision 6 settles on **one OFL-1.1 face across every surface**, replacing
TT Commons Pro. This document measures what that costs, per surface. It changes
no font and recommends no candidate. It exists so B5 can be estimated instead of
guessed, and so step 1 of B5 ("publish the table; the owner picks from
measurements") has a baseline to measure candidates *against*.

Every number below is a command run against the tree at commit `d6b59da`. Where a
count could not be reproduced or a claim could not be verified, it says so.

**Companion document.** [`font-substitution-metrics.md`](font-substitution-metrics.md)
measures the *faces* — the incumbent plus the three OFL-1.1 candidates — and is
the authority for candidate comparison. This document measures the *code*: how
many places bind a face and what breaks when one is swapped. The two were
produced independently and their overlapping figures for TT Commons Pro
(`unitsPerEm` 1000, `sCapHeight` 700, `sxHeight` 496/500/503/506, hhea
1000/−250/0, PostScript names `-Lt/-Rg/-Md/-Db`) agree exactly. §2 below is
retained so this document stands alone; where the two differ in depth, the
metrics document wins on face data and this one wins on reference counts.

---

## 1. Executive shape

| Surface | How the face is bound | References | Verdict |
|---|---|---|---|
| `packages/web` | 2 CSS custom properties (`--sans`, `--display`) behind 4 `@font-face` blocks; marketing aliases them | 177 `font-family` decls + 348 `letter-spacing` decls | **redesign-risk swap** — 2-line token change, then re-tune 348 tracking values |
| `apps/mobile` | 7 React Native family-name strings, one per weight, keyed to `expo-font` registration | 403 `font.*` token refs across 46 files | **restructure** — 7 family names collapse to 1 + weight, then 168 `font.family.*` call sites are re-pointed |
| `apps/menubar` | 4 PostScript names in a Swift enum + 4 bare filenames in a `CTFontManager` list, resolved via `NSFont(name:)` | 15 `SeorakMenuFont.*` call sites | **restructure** — the weight→Face enum and its `NSFont(name:)` probe stop being necessary and should be deleted, not renamed |
| `packages/control-plane` | Its own duplicated `@font-face` block in a template literal, pinned by a test | 14 `font-family` decls, 9 `letter-spacing` | **rename** — but it serves fonts from the web package, so it moves *with* web or breaks |
| `scripts/package-menubar.mjs` | Hard assertion that 4 exact filenames exist in the built `.app` | 4 filename literals | **rename** — one array, but it fails the build if forgotten |

**The single hardest number in this document: 348.** That is the count of
`letter-spacing` declarations in `packages/web/src`, and it is the reason B5 is
"practically irreversible once dependent work lands on the re-tuned type".

---

## 2. Measured baseline: the face being replaced

Extracted directly from the OpenType tables of the tracked binaries (the WOFF
containers were inflated and `head`, `OS/2`, `hhea`, `hmtx`, `glyf`, `name` read
by hand). These are the values B5 step 1 must measure each candidate against.

### 2.1 Vertical metrics — identical across all four weights

| Metric | Value | Why it matters |
|---|---|---|
| `unitsPerEm` | **1000** | ADR 005's stated `1000` — confirmed |
| `sCapHeight` | **700** (0.70 em) | ADR 005's stated `700` — confirmed |
| `sxHeight` | **500 / 496 / 503 / 506** (Rg/Lt/Md/Db) | ADR 005's stated `~500` — confirmed |
| `hhea` ascender / descender / lineGap | **1000 / −250 / 0** | content box = **1.25 em** |
| `OS/2` sTypoAscender / Descender / LineGap | 1000 / −250 / 0 | same, so no win/typo split to reason about |
| `usWinAscent` / `usWinDescent` | 1000 / 250 | same again |
| `OS/2` version | 4 | |
| `fsType` | 0 | an embedding-permission bit, **not** a licence grant — see §7 |

### 2.2 Advance widths (Regular, per 1000 em)

Digits are **proportional, not tabular**, in the default set:

| Glyph | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|---|
| advance | 598 | **330** | 529 | 532 | 534 | 551 | 549 | 489 | 556 | 549 |
| ink `yMax` | 710 | 700 | 710 | 710 | 700 | 700 | 700 | 700 | 710 | 710 |

Reference letters: `H` 680, `M` 830, `W` 864, `n` 555, `o` 548, `x` 454, `i` 209,
`l` 219. Descender depth: `g` −190, `p` −180.

The 268-unit spread between `1` and `0` is why the tree reaches for
`font-variant-numeric: tabular-nums` on stat values. Any candidate whose default
figure set is tabular, or whose `1` is a different fraction of `0`, changes the
width of every KPI in the product.

### 2.3 Family topology — the reason two surfaces restructure

`name` table records, per file:

| File | ID 1 (family) | ID 2 (subfamily) | ID 6 (PostScript) |
|---|---|---|---|
| `TTCommonsPro-Light` | `TT Commons Pro Light` | `Regular` | `TTCommonsPro-Lt` |
| `TTCommonsPro-Regular` | `TT Commons Pro` | `Regular` | `TTCommonsPro-Rg` |
| `TTCommonsPro-Medium` | `TT Commons Pro Medium` | `Regular` | `TTCommonsPro-Md` |
| `TTCommonsPro-DemiBold` | `TT Commons Pro DemiBold` | `Regular` | `TTCommonsPro-Db` |

**Every weight is its own OS-level family whose subfamily is `Regular`.** This is
the commercial cut ADR 005 describes, now measured rather than asserted. CSS
`@font-face` re-labels these under one family name, so the web is insulated. The
two surfaces that resolve faces through the *operating system* — React Native and
AppKit — are not, and that is exactly where the restructure lands.

Every OFL candidate named in ADR 005 (Figtree, Plus Jakarta Sans, Hanken Grotesk)
ships as one family with a weight axis. So the mobile and menu-bar bindings
**collapse**; they do not rename.

### 2.4 The binaries

12 tracked paths, **8 distinct blobs**, 1,869,336 bytes:

```
apps/menubar/Sources/SeorakMenuBar/Resources/Fonts/TTCommonsPro-{Light,Regular,Medium,DemiBold}.ttf
apps/mobile/assets/fonts/TTCommonsPro-{Light,Regular,Medium,DemiBold}.ttf
packages/web/public/fonts/TTCommonsPro-{Light,Regular,Medium,DemiBold}.woff
```

The menu-bar and mobile sets are byte-identical to each other (same git blob
hashes); the web `.woff` set is 4 further distinct blobs. **All 12 files begin
with the magic bytes `77 4f 46 46` (`wOFF`)**, including the 8 named `.ttf` —
confirming ADR 005's claim that the iOS and macOS bundles ship WOFF containers
under a `.ttf` extension.

`name` ID 13 on every file reads: "This font software is the property of TypeType
LLC. Your use of the font software is subject to the terms of the applicable
EULA." ID 14 points at `https://typetype.org/licensing/`. No such EULA exists in
this repository.

---

## 3. `packages/web` — token swap, then 348 re-tunings

### 3.1 Binding

Four `@font-face` blocks in `packages/web/src/app.css:14-41`, all declaring the
same CSS family name at four weights:

```css
@font-face {
  font-family: 'TT Commons Pro';
  font-style: normal;
  font-weight: 300;
  font-display: swap;
  src: url('/fonts/TTCommonsPro-Light.woff') format('woff');
}
```

…repeated for 400 Regular, 500 Medium, 600 DemiBold. Two tokens consume them
(`app.css:46-47`):

```css
--sans: 'TT Commons Pro', -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
--display: 'TT Commons Pro', -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
--mono: 'IBM Plex Mono', 'SF Mono', ui-monospace, monospace;
```

Marketing aliases rather than redefines
(`packages/web/src/marketing/styles/tokens.css:9-11`):

```css
/* Same faces as the dashboard: TT Commons Pro via --display/--sans. */
--marketing-display: var(--display);
--marketing-body: var(--sans);
```

### 3.2 Reference counts

`grep -rn "font-family" packages/web/src` → **501 declarations across 116 files**.
By value:

| Value | Count | Affected? |
|---|---|---|
| `var(--mono)` | 318 | no — IBM Plex Mono is OFL-1.1 already and stays |
| `var(--sans)` | 62 | yes |
| `var(--display)` | 43 | yes |
| `var(--marketing-body)` | 35 | yes, transitively |
| `var(--marketing-display)` | 33 | yes, transitively |
| `inherit` | 6 | no |
| `'TT Commons Pro'` literal | 4 | yes — these are the `@font-face` blocks themselves |

**177 declarations carry the substituted face. 318 carry the mono, which is not
changing.** The 318 mono declarations are the reason the raw "501 font-family
references" figure overstates the work by nearly 2×.

Token occurrence totals (declarations + alias definitions):
`--sans` **65**, `--display` **45**, `--marketing-body` **38**,
`--marketing-display` **35**.

Alias re-definitions outside the token file, which must not be missed:
`src/components/system/system.module.css:29`,
`src/marketing/pages/legal/LegalPage.module.css:9-10`.

One reference lives outside CSS entirely:
`packages/web/public/assets/og-image.svg:56` hardcodes
`font-family="'TT Commons Pro', -apple-system, …"`. A grep over `.css` alone
misses it.

### 3.3 Work required

**Redesign-risk swap.** Replacing the four `@font-face` `src` URLs and the two
token values is a 6-line diff and the whole product changes face. Nothing needs
restructuring — the token indirection did its job. But see §6: 348 tracking
values and two leading values were tuned against the metrics in §2, and B5's own
gate ("checked for clipped descenders, changed line counts, and new ellipsis")
is the real work. Budget the swap in minutes and the re-tune in days.

---

## 4. `apps/mobile` — 7 family-name strings, 403 token references

### 4.1 Binding

`apps/mobile/src/fonts.ts:16-19` registers each weight as its own React Native
family:

```ts
const [loaded, error] = useFonts({
  TTCommonsPro_300Light: require("../assets/fonts/TTCommonsPro-Light.ttf"),
  TTCommonsPro_400Regular: require("../assets/fonts/TTCommonsPro-Regular.ttf"),
  TTCommonsPro_500Medium: require("../assets/fonts/TTCommonsPro-Medium.ttf"),
  TTCommonsPro_600DemiBold: require("../assets/fonts/TTCommonsPro-DemiBold.ttf"),
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
});
```

`apps/mobile/src/theme/tokens.ts:72-89` maps semantic weights onto those strings:

```ts
export const font = {
  /** Weight-specific RN family names — must match keys in `useSeorakFonts`. */
  family: {
    extralight: "TTCommonsPro_300Light",
    light: "TTCommonsPro_300Light",
    regular: "TTCommonsPro_400Regular",
    medium: "TTCommonsPro_500Medium",
    semibold: "TTCommonsPro_600DemiBold",
    mono: "IBMPlexMono_400Regular",
    monoMedium: "IBMPlexMono_500Medium",
  },
  /** The regular faces — safe defaults for `fontFamily`. */
  sans: "TTCommonsPro_400Regular",
  mono: "IBMPlexMono_400Regular",
  size: { xs3: 9, xs2: 10, xs: 11, sm: 12, base: 13, md: 14, lg: 16, xl: 20, xl2: 24 },
  display: { sm: 28, md: 35, lg: 45 },
  tracking: { tight: -0.2, label: 1, eyebrow: 1.4 },
} as const;
```

The doc comment above it states the constraint outright: "Each **WEIGHT** is its
own RN family — style with `font.family.*`, **NOT** `fontWeight`."

There is no `UIAppFonts` array in `apps/mobile/ios/seorak/Info.plist` — registration
is entirely runtime through `expo-font`, so there is no plist to update.

### 4.2 Reference counts

`grep -rEno "\bfont\.[a-zA-Z.]+" apps/mobile/src` → **403 occurrences across 46
files**, reproducing ADR 005's figure exactly. Broken down:

| Token | Count | Affected? |
|---|---|---|
| `font.size.*` | 207 | indirectly — sizes may need re-derivation if cap/x-height differ |
| `font.family.*` | 168 | **yes — every one is a face binding** |
| `font.tracking.*` | 20 | yes — px tracking values tuned to this face |
| `font.display.*` | 8 | indirectly |

`font.family.*` by member: `regular` 77, `medium` 38, `semibold` 18, `light` 13,
`monoMedium` 11, `mono` 9. **146 of the 168 bind the substituted face; 20 bind
IBM Plex Mono** (`mono` + `monoMedium`), and those do not move.

Also: 167 `fontFamily` occurrences, and 23 `letterSpacing` occurrences
(20 through `theme.font.tracking.*`, 3 raw: `-0.8`, `-0.7`, `-0.3`).
52 `lineHeight` occurrences, **none sub-1** — React Native's `lineHeight` is px,
so the web's 0.96/1.15 problem has no mobile counterpart.

No custom-font binding exists in the native Swift under `apps/mobile/modules` or
`apps/mobile/ios` (`grep -rn "TTCommons\|custom(" --include="*.swift"` returns
nothing), which matches `DESIGN_LANGUAGE.md:101`: "Native iOS widgets / Live
Activities stay on system text styles (Dynamic Type)."

### 4.3 Work required

**Restructure.** The 5 sans family names collapse to a single family plus a
weight axis. Two shapes are possible and the choice is a real decision, not a
mechanical one:

- **Keep the `font.family.*` shape**, pointing all five keys at the same family
  string and adding a parallel `font.weight.*` map. 146 call sites keep compiling
  but every one of them silently renders Regular until a matching `fontWeight` is
  added alongside. This is the cheap diff and the dangerous one.
- **Change the shape** to `font.face(weight)` or to `{ fontFamily, fontWeight }`
  style objects, forcing all 146 sites to be visited. Larger diff, no silent
  wrong-weight failure mode.

Either way the doc comment at `tokens.ts:66-71` becomes false and must be
rewritten — it is currently load-bearing guidance telling contributors never to
use `fontWeight`.

---

## 5. `apps/menubar` — an enum whose entire reason to exist disappears

### 5.1 Binding

`apps/menubar/Sources/SeorakMenuBar/SeorakMenuTheme.swift:16-42`:

```swift
/// TT Commons Pro ships as separate family names per weight (commercial cut).
/// Map SwiftUI weights onto PostScript names registered from Resources/Fonts.
enum SeorakMenuFont {
  private enum Face: String, CaseIterable {
    case light = "TTCommonsPro-Lt"
    case regular = "TTCommonsPro-Rg"
    case medium = "TTCommonsPro-Md"
    case demiBold = "TTCommonsPro-Db"
  }

  private static var didRegister = false

  static func registerIfNeeded() {
    guard !didRegister else { return }
    didRegister = true
    for name in [
      "TTCommonsPro-Light",
      "TTCommonsPro-Regular",
      "TTCommonsPro-Medium",
      "TTCommonsPro-DemiBold",
    ] {
      guard let url = Bundle.module.url(forResource: name, withExtension: "ttf", subdirectory: "Fonts")
        ?? Bundle.module.url(forResource: name, withExtension: "ttf")
      else { continue }
      CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
    }
  }
```

Two disjoint identifier spaces in one type: the enum raw values are **PostScript
names** (`-Lt/-Rg/-Md/-Db`), the registration array is **bare filenames**
(`-Light/-Regular/-Medium/-DemiBold`). They are not derivable from one another,
and §2.3 confirms the enum values are the real `name` ID 6 records.

Resolution goes through `NSFont(name:)`, with a system fallback
(`SeorakMenuTheme.swift:52-58`):

```swift
private static func font(_ size: CGFloat, weight: Font.Weight) -> Font {
  registerIfNeeded()
  let face = face(for: weight)
  if NSFont(name: face.rawValue, size: size) != nil {
    return .custom(face.rawValue, size: size)
  }
  return .system(size: size, weight: weight)
}
```

and a weight→face collapse at `SeorakMenuTheme.swift:61-67` that already flattens
9 SwiftUI weights into the 4 shipped files (`.ultraLight/.thin/.light` → light;
`.semibold/.bold/.heavy/.black` → demiBold).

### 5.2 Reference counts

24 lines across 6 files mention `SeorakMenuFont` or `TTCommonsPro`.
**15 are `SeorakMenuFont.*` call sites**: 1 `registerIfNeeded()` in
`MenuBarController.swift:13`, and 14 `SeorakMenuFont.sans(…)` in
`MenuBarControls.swift` (2), `MenuBarPanel.swift` (5), `UsageTrendChart.swift`
(3), `UsageLimitRow.swift` (4).

Noted in passing: `SeorakMenuFont.display(_:weight:)` is declared at
`SeorakMenuTheme.swift:44-46` and **has zero call sites**. It is dead code today
and should not be carried into the substitution.

No `.tracking(…)` or kerning modifiers exist anywhere in
`apps/menubar/Sources` — the menu bar has no tuned tracking to re-derive.

### 5.3 Work required

**Restructure.** Once one family carries a weight axis, `enum Face`, the
`face(for:)` weight collapse, and the `NSFont(name:)` availability probe all
stop being necessary: SwiftUI's `.custom(_:size:).weight(_:)` handles it. The
correct diff deletes roughly 25 lines rather than renaming 8 strings. The 14
`SeorakMenuFont.sans(size, weight:)` call sites keep their signature and need no
edit — which is the one piece of good news on this surface.

Registering a single file still needs `CTFontManagerRegisterFontsForURL`, so the
registration path survives with one entry instead of four.

---

## 6. `packages/control-plane` — a duplicated stylesheet with a pinned filename

### 6.1 Binding

`packages/control-plane/src/htmlStyles.ts:1-32` opens a template literal with its
own copy of the four `@font-face` blocks and its own `--sans`/`--display`
definitions — **not** an import from `packages/web`:

```ts
export const CONTROL_PLANE_STYLES = `    @font-face {
      font-family: "TT Commons Pro";
      font-style: normal;
      font-weight: 300;
      font-display: swap;
      src: url("/fonts/TTCommonsPro-Light.woff") format("woff");
    }
```

…×4, then:

```css
--sans: "TT Commons Pro", -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
--display: "TT Commons Pro", -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif;
--mono: "SF Mono", ui-monospace, monospace;
```

Note `--mono` differs from the web's: the control plane does **not** load IBM Plex
Mono, it falls to SF Mono. So the two stylesheets are already divergent.

**The `/fonts/…` URLs are not served by this package.** There are no `.woff`
files anywhere under `packages/control-plane`. `wrangler.toml:14-15` reads:

```toml
[assets]
directory = "../web/public"
```

So the control plane serves the web package's `public/` directory verbatim,
including `public/fonts/`. Consequence for B5: **replacing the web font files
also replaces the control plane's, whether or not anyone remembers the control
plane exists** — and if the `@font-face` block here is not updated in the same
commit, the sign-in page 404s its fonts and silently renders in `-apple-system`.

### 6.2 The test pin

`packages/control-plane/test/control-plane.test.ts:370-371`:

```ts
expect(html).toContain("@font-face");
expect(html).toContain("TTCommonsPro-Regular.woff");
```

Inside `it("renders the sign-in entry through the Ambient control-plane shell")`.
This is the one place in the tree where the substitution produces a **failing
test rather than a silent visual regression**, which makes it the surface's
saving grace.

### 6.3 Reference counts and tuned values

14 `font-family` declarations: 4 literal `"TT Commons Pro"` (the `@font-face`
blocks), 4 `var(--display)`, 2 `var(--sans)`, 4 `var(--mono)`.

9 `letter-spacing` declarations, independently hand-tuned and sharing no tokens
with the web: `-.075em` (line 154), `-.06em` (187), `-.055em` (382), `-.04em`
(208), `-.025em` (721), `-.01em` (67, 704), `.1em` (900), `.08em` (910).

Line 154's `-.075em` sits directly under `line-height: .96` at line 153 — **an
open-coded copy of the web's display tracking and display leading**, with no
token and no comment explaining where the numbers came from. The `line-height:
1.15` at line 909 is *not* the clipping workaround; it is on a mono `.code`
element with `letter-spacing: .08em`.

### 6.4 Work required

**Rename, with a coupling trap.** Update the four `@font-face` blocks, the two
token values, and the pinned filename in the test. The trap is the shared
`../web/public` asset directory: the control plane's fonts change the moment the
web package's files change, so this edit is not optional and not deferrable to a
later commit.

Nine hand-tuned tracking values re-derive independently of the web's 348, because
they share no token.

---

## 7. `scripts/package-menubar.mjs` — a build gate on four filenames

`scripts/package-menubar.mjs:261-278`:

```js
for (const font of [
  "TTCommonsPro-DemiBold.ttf",
  "TTCommonsPro-Light.ttf",
  "TTCommonsPro-Medium.ttf",
  "TTCommonsPro-Regular.ttf",
]) {
  const fontPath = join(
    resourcesDirectory,
    "SeorakMenuBar_SeorakMenuBar.bundle",
    "Contents",
    "Resources",
    font,
  );
  try {
    if (!statSync(fontPath).isFile()) throw new Error();
  } catch {
    fail(`packaged font is missing: ${font}`);
  }
}
```

**Work required: rename.** One array literal. But it is a hard `fail()`, so a
forgotten edit breaks the menu-bar release build rather than shipping something
wrong — the desirable failure mode. If the substitution collapses to one file,
this loop shrinks to a single entry.

ADR 005 also records this script as one of two reasons `apps/menubar` is deferred
from open-core publication (`docs/adr/005-…:274`), so the edit sits on the
critical path for that decision too.

---

## 8. The metrics-tuned values — the part that decides swap vs. redesign

### 8.1 The count

```
$ grep -rn "letter-spacing" packages/web/src | wc -l
348
```

All 348 are in `.css` files. A further 3 `letterSpacing` values live in JSX at
`packages/web/src/components/system/SystemPreview.tsx:54,64,86`
(`'0.04em'`, `'0.1em'`, `'0.12em'`) and are invisible to a CSS-only sweep.

**The prior audit's figure of 348 is confirmed exactly.**

Distribution — 146 of the 348 route through a token, 202 are literals:

| Value | Count | Tokenized? |
|---|---|---|
| `var(--tracking-stat)` (`0.12em`) | 111 | yes |
| `var(--tracking-eyebrow)` (`0.14em`) | 18 | yes |
| `var(--tracking-table)` (`0.1em`) | 13 | yes |
| `var(--display-spacing)` (`-0.075em`) | 13 | yes |
| `var(--tracking-action)` (`0.08em`) | 4 | yes |
| `-0.01em` | 20 | no |
| `0` | 19 | no |
| `-0.02em` | 12 | no |
| `0.04em` | 11 | no |
| `-0.03em` | 10 | no |
| `0.08em`, `0.06em`, `0.01em` | 9 each | no |
| `0.1em` | 8 | no |
| `-0.04em` | 7 | no |
| `normal`, `inherit`, `0.02em` | 6 each | no |
| `0.16em`, `0.12em`, `0.11em`, `-0.024em` | 4 each | no |
| `-0.05em`, `-0.028em`, `-0.012em`, and a long tail | ≤3 each | no |

The four tracking tokens are defined at
`packages/web/src/styles/tokens.css:51-55` under the heading
`/* ── Letter spacing patterns ── */`.

**This is the estimate that matters.** 146 declarations re-tune by editing five
token definitions. The other **202 are literal values scattered across ~116
module CSS files**, each chosen by eye against this face's specific advance
widths (§2.2), and each needing to be looked at rather than found-and-replaced.
Note the four largest literal buckets are *negative* tracking — tightening
applied because this face's default fit was judged loose. A candidate that fits
tighter turns those into over-tightening.

### 8.2 Display tracking: `-0.075em`

Defined once, `packages/web/src/app.css:70`:

```css
--display-spacing: -0.075em;
```

Consumed at 13 sites, plus one with an inlined fallback copy at
`src/components/DesktopShellGate/DesktopShellGate.module.css:28`
(`letter-spacing: var(--display-spacing, -0.075em)`) — a second literal that a
token-only edit misses.

Consumers: `DetailHeader:19`, `RenderErrorBoundary:16`, `ViewHeader:31`,
`EmptyState:27`, `StatTabs:109`, `DesktopShellGate:28`, `ProjectView:22`,
`ModelView:49`, `EntryView:102,137`, `OverviewView:43`,
`widget-shared:17,180`, `AnnotatedRing:15`.

Duplicated open-coded in the control plane at `htmlStyles.ts:154` as `-.075em`.

### 8.3 Display leading: `0.96`

`packages/web/src/app.css:64`:

```css
--display-line: 0.96;
```

Consumed at 8 sites: `DetailHeader:18`, `RenderErrorBoundary:17`,
`ViewHeader:30`, `EmptyState:28`, `StatTabs:110`, `EntryView:101,136`,
`OverviewView:42`. Duplicated open-coded in the control plane at
`htmlStyles.ts:153` as `.96`.

**Against the measured metrics in §2.1 this is a sub-content-box leading.** The
face's content box is `(1000 + 250) / 1000 = 1.25 em`. A `line-height` of `0.96`
therefore applies a half-leading of `(0.96 − 1.25) / 2 = −0.145 em` on each side,
i.e. the line box is 0.29 em shorter than the glyph box it contains. That number
— and therefore whether it clips — is a property of *this face's* 1000/−250, not
of the ratio 0.96. A candidate with, say, 1.0 ascent and −0.2 descent has a
1.2 em box and a different margin; a candidate with 1.05/−0.29 has less.

**This is why B5 step 3 says "re-derive… rather than carrying it over."**

### 8.4 The documented glyph-clipping failure and the `1.15` workaround

`packages/web/src/app.css:64-70`, quoted in full:

```css
  --display-line: 0.96;
  /* Tight (sub-1) leading for MULTI-LINE display headings is intentional — but on a
   * single-line numeric VALUE inside overflow:hidden (the horizontal-ellipsis guard)
   * it clips the glyph tops. Numeric value classes use this glyph-containing leading
   * instead; headings keep --display-line. */
  --display-line-value: 1.15;
  --display-spacing: -0.075em;
```

The failure is a three-way interaction — sub-1 leading × `overflow: hidden`
(present for horizontal ellipsis on long values) × this face's digit ink extent
of `yMax` 700–710 against a 1000 ascent (§2.2). Change any one term and the
workaround value changes.

`--display-line-value: 1.15` is consumed at 4 sites, each carrying its own
restatement of the reason:

`src/widgets/widget-shared.module.css:13-20`
```css
.heroStatValue {
  font-family: var(--display);
  font-size: var(--display-hero);
  font-weight: 300;
  letter-spacing: var(--display-spacing);
  /* Glyph-containing leading so overflow:hidden (here for the horizontal ellipsis on
   * long values) never clips the digit tops — see --display-line-value. */
  line-height: var(--display-line-value);
```

`src/widgets/bodies/atoms/StripFaceHead.module.css:15-17`
```css
  /* Glyph-containing leading so overflow:hidden (for the ellipsis) doesn't
   * clip the digit tops — see --display-line-value. */
  line-height: var(--display-line-value);
```

Also `src/widgets/widget-shared.module.css:181` (`.chartRateValue`) and
`src/widgets/bodies/OutcomeWidgets.module.css:315`.

**There is a horizontal counterpart to the same bug**, tuned to the same face and
just as face-specific. `src/widgets/widget-shared.module.css:25-28`:

```css
  /* The negative display letter-spacing pulls the box edge a hair inside the LAST
   * glyph's ink, which overflow:hidden then clips on the right. Trailing padding
   * extends the clip box past the ink (overflow clips at the padding edge). */
  padding-inline-end: 0.2em;
```

and `src/components/StatTabs/StatTabs.module.css:95-97`:

```css
  /* Trailing room so the negative letter-spacing + overflow:hidden don't clip the
   * last glyph's right edge (the vertical counterpart is --display-line-value). */
  padding-inline-end: 0.2em;
```

**`0.2em` of trailing padding is a fourth tuned value that ADR 005 and the B5
plan do not currently list.** It exists because `-0.075em` tracking pulls the
inline box inside the final glyph's ink; a candidate with different sidebearings
needs a different number, or none.

### 8.5 Summary of tuned values

| Value | Location | Why face-specific |
|---|---|---|
| `-0.075em` display tracking | `app.css:70`; fallback copy `DesktopShellGate.module.css:28`; open-coded `control-plane/src/htmlStyles.ts:154` | tightening judged against this face's advance widths (`0`=598, `1`=330 per 1000 em) |
| `0.96` display leading | `app.css:64`; open-coded `htmlStyles.ts:153` | sits 0.29 em inside this face's 1.25 em content box (asc 1000 / desc −250) |
| `1.15` clipping workaround | `app.css:69`, 4 consumers | derived empirically against digit ink `yMax` 700–710 vs. 1000 ascent under `overflow: hidden` |
| `0.2em` trailing padding | `widget-shared.module.css:28`, `StatTabs.module.css:97` | compensates negative tracking against this face's final-glyph sidebearing; **not listed in the B5 plan** |
| `0.12 / 0.14 / 0.08 / 0.1em` tracking tokens | `styles/tokens.css:51-55` | uppercase mono-label tracking, 146 consumers |
| 202 literal `letter-spacing` values | ~116 module CSS files | each chosen by eye; no token to edit |
| `tracking: { tight: -0.2, label: 1, eyebrow: 1.4 }` | `apps/mobile/src/theme/tokens.ts:88` | px, not em — re-derives independently of web |
| 9 `letter-spacing` values | `control-plane/src/htmlStyles.ts` | shares no token with web; re-derives independently |

---

## 9. `DESIGN_LANGUAGE.md` — what is face-specific vs. type-general

`packages/web/DESIGN_LANGUAGE.md:74-105` is the typography section. Separating
the two:

### 9.1 Specific to TT Commons Pro — must change

| Line | Text | Why it is face-specific |
|---|---|---|
| 80 | table row "**TT Commons Pro** \| Sans and display: headlines, body, UI copy \| Web (self-hosted), mobile RN, menu bar" | names the face and its distribution across three surfaces |
| 83 | "Tokens (web): `--sans` and `--display` both resolve to TT Commons Pro (display is the size/tracking role, not a second face)." | asserts the token→face mapping |
| 87 | "Shipped TT Commons weights: **300 / 400 / 500 / 600** (Light, Regular, Medium, DemiBold). **No italic faces.**" | a fact about which files were purchased. Every OFL candidate ships a wider axis and real italics — this line becomes a *choice* rather than a constraint |
| 89 | "Prefer 400–500 for headlines; 300 for oversized stat numerals; 600 for strong UI emphasis." | a judgement about how *this* face's weights read at size; 300 for hero numerals depends on this Light being substantial enough to hold at `--display-hero: 3.6rem` |
| 90 | "Do not request 200 or 700. **Clamp to 300 / 600.**" | exists purely because those files were not bought. It is the clearest example of a rule that is a licence artefact dressed as a design principle |
| 91 | "Do not style product UI in italic. Rare semantic `<em>` in long-form blog prose **may synthesize italic**; that is prose-only." | "synthesize" is only necessary because no italic file exists. With a candidate that ships true italics, the sentence is wrong in its mechanism even if the policy stands |

### 9.2 Type-general — survives any substitution

- Line 76, "One type system across marketing and product web (and mobile RN /
  menu bar where bundled)" — this is the *premise* of ADR 005 decision 6, not a
  casualty of it.
- Line 81 and 92, the IBM Plex Mono role and its 400/500 loading. Plex is
  OFL-1.1 and does not move.
- Line 83's second half — marketing aliases `--marketing-body`/`--marketing-display`
  onto the dashboard tokens. Structure, not face.
- Lines 96-99, the voice rules (quiet headlines, mono means something specific,
  sentence case).
- Line 101, native iOS widgets and Live Activities on Dynamic Type; terminal on
  the host face. Verified true in code (§4.2).
- Lines 103-105, the vocabulary lists.

### 9.3 The one line to watch

Line 89's "300 for oversized stat numerals" combined with §8's tuned values is
the load-bearing claim of the whole design language: hero stats are Light, huge,
tightly tracked, tightly led, and clipped by their own overflow guard. That
combination is where a substitution either holds or turns into a redesign, and
it is what B5's before/after screenshot gate is actually testing.

---

## 10. What this document does not establish

- **No candidate is measured.** B5 step 1 still needs `unitsPerEm`,
  `sCapHeight`, `sxHeight`, advance widths, and family topology for Figtree,
  Plus Jakarta Sans, and Hanken Grotesk. §2 gives them something to be compared
  against; it does not do the comparison.
- **No licence conclusion.** §2.4 reports what the `name` table says. ADR 005 is
  explicit that "Every item in this section requires qualified legal review", and
  P2 in the wave-2 plan is still open.
- **`fsType = 0` is not a grant.** It is stated here only because it is easy to
  find and easy to misread. ADR 005: "an OpenType embedding-permission bit, not a
  licence grant, and must not be cited as one."
- **Whether 202 literal tracking values actually need changing is unmeasured.**
  Some will hold. Finding out requires the candidate in the tree, which is B5's
  work, not this document's.
