# Seorak design language

## Iridescent Instrumental Minimalism

**Short name:** Ambient Instrument

Seorak is a companion for understanding agentic development. Its product and marketing surfaces should feel like a precise instrument placed in a calm, living environment. It is neither a generic SaaS dashboard nor a decorative portfolio site.

The visual language combines editorial restraint, technical evidence, and a soft chromatic atmosphere. It should make a developer feel that Seorak has taste without making the product feel vague or magical.

## Design premise

The product turns activity that is normally invisible into a small set of useful signals: state, cost, progress, outcome, and attention. The design should mirror that reduction.

- The background is ambient. It creates mood, depth, and a sense of time passing.
- The interface is instrumental. It names states clearly and gives the user a way to act.
- The product visual is evidentiary. It should make a claim understandable, not merely decorate a section.
- The motion is patient. It suggests a living system without competing with reading or interaction.

The core contrast is **soft environment, hard evidence**.

## What this is not

- Generic glassmorphism with every section inside frosted cards.
- A dark developer tool made light with a gradient background.
- A data visualization gallery full of invented charts and numbers.
- A WebGL demo where visual novelty obscures the product.
- Enterprise productivity software. Seorak is personal and direct, not managerial.

## Color system

### Ambient chroma drift

The near-white field is the visual atmosphere. Lavender, mist-blue, and rose form a low-contrast mesh that moves slowly behind the content. This is called **ambient chroma drift**, not transient color. The color moves through space and time, but it does not carry product meaning.

Current base values:

| Role | Current value | Use |
|---|---:|---|
| Field | `#fbfbfc` | Primary background |
| Ink | `#121317` | Headlines, primary actions, technical marks |
| Lavender | `#a896d4` | Live state, interaction warmth, focused objects |
| Mist blue | `#96b6de` | Atmospheric mesh only |
| Rose | `#e4c4d6` | Atmospheric mesh only |
| Fog blue | `#c4d6ec` | Atmospheric mesh only |

The mesh may animate, but the semantic accent should remain stable. Lavender means the current, selected, or live object. Do not rotate a semantic state through the entire spectrum.

The existing full-spectrum 48-second hue rotation is technically cohesive, but it weakens semantic color. The preferred direction is a restrained 20 to 35 degree drift within the lavender, blue, and rose family. A full-spectrum cycle is appropriate only when the brand explicitly wants color to be non-semantic.

### Color allocation

- Use ink for decisions, headings, and the single highest-priority action.
- Use lavender for live state, selected state, and gentle interactive response.
- Use blue and rose only in the background or a non-semantic iridescent edge.
- Do not use color alone to communicate status, outcome, or risk.
- Keep large content surfaces near-white so evidence remains legible.

## Glass system

Glass is a material for small, floating controls. It should feel refractive and tactile, not opaque or decorative.

| Property | Current direction |
|---|---|
| Form | Squircle, generally 13 to 14px radius |
| Fill | White at roughly 46 to 72% opacity with a small lavender tint |
| Backdrop | 26px blur, 135% saturation |
| Edge | One-pixel iridescent masked rim |
| Depth | Soft 14px by 34px shadow, plus restrained inset white highlights |
| Active state | Warmer lavender fill, soft glow, one-pixel upward lift |

Use glass for navigation, command controls, tags, menus, segmented choices, and short contextual annotations. Avoid using it for article bodies, full-page containers, dense data tables, or every feature explanation. Once glass becomes the default content surface, the hierarchy collapses.

## Typography and voice

One type system across marketing and product web (and mobile RN where bundled):

| Face | Role | Surfaces |
|---|---|---|
| **Figtree** | Sans and display: headlines, body, UI copy | Web (self-hosted), mobile RN, control plane |
| **IBM Plex Mono** | Commands, values, timestamps, states, chrome labels | Web + mobile RN (Google / Expo) |

Both are OFL-1.1, which is what lets the published dashboard carry them. Tokens (web): `--sans` and `--display` both resolve to Figtree (display is the size/tracking role, not a second face). `--mono` is IBM Plex Mono. Marketing shells use `--marketing-body` / `--marketing-display`, which alias those same tokens.

### Weight and style limits

Loaded Figtree weights: **300 / 400 / 500 / 600** (Light, Regular, Medium, SemiBold). No italic loaded.

- Prefer 400–500 for headlines; 300 for oversized stat numerals; 600 for strong UI emphasis.
- Do not request 200 or 700. Clamp to 300 / 600.
- Do not style product UI in italic. Rare semantic `<em>` in long-form blog prose may synthesize italic; that is prose-only.
- Mono is loaded at 400 and 500 only.

**These four limits are now CHOICES, not licence artefacts.** Under the previous
face they described which files had been bought: Figtree ships 300–900 and true
italics, so keeping the range narrow is a design decision about how much weight
this product's surfaces should carry, and `<em>` synthesises italic because no
italic is loaded rather than because none exists. Widening either is allowed and
costs bytes, not money.

### The tuned display values

`--display-line`, `--display-line-value`, `--display-spacing` and the `0.2em`
trailing clip room are tuned against the FACE, not chosen freely. What each is
worth, how it was measured, and which of them re-derive if the face changes
again: [`docs/reference/font-substitution-result.md`](../../docs/reference/font-substitution-result.md).

### Voice

- Headlines are quiet, direct, and weighted toward 400 or 500. They should feel stated, not advertised.
- Body copy should be short, concrete, and able to stand next to a data mark.
- Mono text should represent something specific: a command, timestamp, measurement, state, or boundary.
- Use sentence case. Keep labels short.

Native iOS widgets / Live Activities stay on system text styles (Dynamic Type). Terminal uses the host face.

Preferred vocabulary: **signal, trace, state, outcome, surface, derive, ship, survive, stall, notice, attention**.

Avoid: **insight, analytics platform, optimize, supercharge, leverage, productivity management, copilot**.

## Motion

Motion has three levels.

| Level | Duration and purpose | Examples |
|---|---|---|
| Immediate | 150 to 220ms | Hover, focus, button and menu response |
| Structural | 220 to 500ms | Disclosure, panel transition, route-local emphasis |
| Atmospheric | 20 to 60s | Field drift, slow material movement |

Only one animated focal object should compete for attention in a viewport. Pause, simplify, or remove nonessential movement under `prefers-reduced-motion`. Every animated primary visual needs a static fallback that preserves the page's composition.

### Hover and focus language

Every interactive response lives in the Immediate tier and obeys one rule: lavender is what responds, motion stays eased and under 220ms, and nothing scales or bounces. The soft environment responds to the hard evidence; the evidence does not light itself.

| Role | Elements | Response |
|---|---|---|
| Glass control | nav marks, menu button, segmented pills | warmer lavender fill, iridescent rim, soft lavender glow, one-pixel lift |
| Focus-one | the story pill (What / Why / How) | the hovered item holds; its siblings blur and fade |
| Sliding indicator | menus and lists | a single lavender split-pill glides to the active row |
| Primary ink action | the Get started controls | one-pixel lift, the arrow brightens, and the arrow marquee-swaps (the leading arrow exits the right edge while the next slides in from the left, clipped by the squircle). |
| Editorial text | prose, blog, and inline links | a faint underline darkens to ink. No fill, no motion. |

The primary action stays clean and recognizable: the arrow advances forward through the button. It must not reach for cursor-following light, magnetic pull, or any effect that reads as a demo trick. Hold the lift and freeze the marquee under `prefers-reduced-motion`.

### Button hierarchy

The site has three control families. They should not be interchangeable.

- **Primary split action:** the two ink squircles with a label block and arrow block. Use for the single forward commercial or activation action: Get started, install, subscribe, continue. It is the highest-priority command in a view.
- **Outline action control:** the gradient-stroke text squircle. Use for secondary movement or recovery actions such as previous, next, retry, reload, or returning to an index. It is text-only by default; chevrons are opt-in and should be rare.
- **Glass peer links:** small refractive pills. Use for sibling choices, filters, tags, surface peers, and low-pressure navigation inside a page.

Do not use the outline action control as the primary CTA. Do not put a top-left Home/back control in the marketing chrome. Use the centered nav, breadcrumbs, or in-content controls for orientation instead.

## Layout and hierarchy

The site uses a floating-control frame around a single dominant thought. On Home, the figure can carry the identity. On What, Why, and How, the paragraph carries the thought until a visual can prove it.

### Shared frame

- Keep the compact navigation at the top center.
- Keep page content out of large opaque containers.
- Let desktop pages use generous negative space, but do not force a visible object where text is clearer.
- On smaller screens, stack the thought, evidence, and action. Do not preserve desktop emptiness at the expense of comprehension.

### Hierarchy rule

Each route gets one dominant thought in its first fold. The proof visual must prove that thought and must not compete with the copy.

```
navigation

page thought + subtitle

proof visual

single action
```

Do not place a centered decoration between unrelated copy blocks. If an object is not evidence, remove it.

## Visual media decision framework

Choose the medium according to the claim being made.

| Medium | Use it when | Do not use it when |
|---|---|---|
| WebGL or shader | The job is atmosphere, material, or an abstract identity gesture | The user needs to understand a product behavior, trust boundary, or number |
| Real product visualization | The page makes a claim about a signal, session, or outcome | The product does not yet support the shown data or interaction |
| Diagram | The page explains a mechanism, path, or trust boundary | A screenshot or data trace would be more direct |
| Product screenshot | The product is visually mature and the exact interface adds proof | It would force a dashboard screenshot into an editorial story |
| Static illustrative system | The concept needs a durable, responsive fallback | A real product trace can prove the claim better |

Never invent performance statistics. Example session data is allowed when it derives from actual product schema and is marked as an example. A diagram should name exactly what is local, what is derived, and what is sent.

## Statement + Proof Visual

What, Why, and How follow the Pricing page rhythm: centered title, short subtitle, then one concrete visual below.

The visual is allowed only when it proves the sentence. No random chart, fake stat strip, decorative icon, glossy device, generic human-machine image, or abstract point-cloud object should carry these pages.

The pages can name built signals: timing, token-derived cost, stalls, commit state, and on-branch line survival. They must also respect the boundary: code and prompts stay local. They should not imply code understanding, prompt analysis, developer scoring, or personalized effectiveness.

Route visuals:

- **What:** Claude Code signals feed the local collector, fan out into real stat categories, become a Seorak record, and return to the developer.
- **Why:** a plain trend visual shows cost, stalls, and durable changes over time. It has no invented numeric values and no benchmark claim.
- **How:** a local derivation boundary shows machine-local collection and derived signals reaching web, mobile, and terminal.

## Route Architecture

The public routes are single-viewport statements. Home is the identity surface.
What, Why, and How each state one verified idea and then show one proof visual.
Do not add scrolling merely to make a route feel more complete. Add another route
only when there is another idea worth stating.

### Home: identity and invitation

**Purpose:** Make Seorak memorable before explaining everything.

**Primary visual:** The point-cloud figure is appropriate here. It is an emotional, identity-level object, not a literal product demonstration. The question rail gives it a product-adjacent heartbeat.

**Placement:** Large and centered in the middle field. Navigation stays top-center; name, thesis, and surfaces remain bottom-left.

**Medium:** WebGL is allowed on this page because its job is mood and identity. It must have a static fallback, such as a still silhouette, trace contour, or softly layered SVG field. A blank center is not an acceptable fallback.

**Limit:** Do not add another large animated scene below the fold. The home page should remain one composition.

**Mobile treatment:** Use a split header with the Seorak mark at left and the menu at right. Hide the segmented navigation. The lockup remains above the figure, and the question reel becomes a horizontal, swipeable rail above the safe area. The mobile figure may use WebGL, but it should render as a single assembled frame rather than a continuous animation.

### Surfaces: one object, three contexts

**Purpose:** Show that terminal, web, and mobile are equal surfaces of the same record, not three tabs in a feature picker.

**Composition:** Use the home frame: top-center navigation, a persistent point-cloud figure, the selected surface assembled behind it, and a bottom-left lockup. The lockup starts with a lowercase breadcrumb such as `seorak / terminal`, then a role-based headline and one grounded paragraph. The bottom row says `Switch to` and shows only the two sibling surface pills.

**Visual standard:** The background device must be detailed enough to recognize the surface by structure: terminal chrome and rows, browser chrome and panes, phone hardware and Live Activity shape. It may not rely on fake labels, fake metrics, or dashboard text. One stable lavender tell marks the live object.

**Navigation:** Do not show the top-left back button on dedicated surface pages. The breadcrumb handles orientation, and the other-surface pills handle lateral movement.

### Blog: the public record

**Purpose:** Give the written record a calm editorial index, not another marketing proof page.

**Composition:** Use the centered marketing nav only. Do not show the top-left Home/back control on the blog index. The first lockup should be just `Blog` with the current post count as a small superscript. Filters, search, and view controls follow as the evidence/navigation layer.

**Controls:** Category filters use the glass peer-link treatment. The in-row `Read` affordance uses a secondary split-glass shape: label squircle plus icon squircle, not the ink primary CTA. Its icon squircle uses the same clipped two-icon marquee idea as the primary split action, adapted to the arrow direction. The outline action control is reserved for page movement such as `All notes`, `Prev`, and `Next`; it should not be used as a category chip.

**Copy:** Do not add an eyebrow, abstract lede, or explanatory thesis above the posts. The posts themselves carry the argument.

### What: the record

**Purpose:** Make the measured object concrete without fabricating a session dashboard.

**Current composition:** Centered statement, then the ingest-to-stats flow.

**Copy:** Say what Seorak tracks: state, duration, token-derived cost, stalls, commit state, and whether changed lines were still on the branch later.

**Medium:** HTML and CSS. No fake dashboard interaction, no invented metric values.

### Why: the missing context

**Purpose:** State why cost by itself is not enough.

**Current composition:** Centered statement, then a plain trend visual on the default field.

**Copy:** Say why the bill is too thin: the useful part is seeing how cost, stalls, and durable changes move over time.

**Medium:** SVG on the page field. No background card, no benchmark statistic, no simulated product interaction.

### How: the derivation boundary

**Purpose:** State the privacy boundary plainly.

**Current composition:** Centered statement, then a local derivation boundary.

**Copy:** Say how the record exists: a local collector watches tool-exposed signals, derives counts and state on the machine, and sends only those signals to Seorak.

**Medium:** HTML and CSS. No lock icon, no privacy theater, no simulated controls.

The `seorak init` command stays on Home and in the menu because it is the product activation path, not a visual requirement for this page.

## Implementation rules

- Build primary product visuals in HTML, SVG, or CSS before considering canvas. They are easier to inspect, make responsive, and support accessibly.
- Use WebGL only for an ambient layer that can fail without hiding information.
- Keep information-bearing visualizations in the DOM. Provide semantic labels and text equivalents for important states.
- Do not make a primary page claim depend on hover, autoplay, or animation completion.
- Mark all illustrative data as an example until it is connected to product data.
- Give the active navigation item a visible active state and `aria-current="page"`.
- Test desktop, small mobile, reduced-motion, and no-WebGL compositions before treating a visual as complete.

## Review checklist

Before adding a section or visual, ask:

1. What exact product claim is this proving?
2. Is this the one primary visual for the fold, or is it competing with one?
3. Would the page still communicate if WebGL and animation did not load?
4. Is the color semantic, atmospheric, or both? If both, split it.
5. Is glass serving interaction, or merely filling space?
6. Is the copy concrete enough to live beside a measurement or diagram?
7. Does the visual respect the product's actual data and privacy boundaries?
