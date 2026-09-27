/**
 * THE DASHBOARD'S ENTRY MODULE, and it exists to be reachable rather than to do
 * anything. The real entry is `src/main.tsx`; this file only gives it an address
 * under `root`.
 *
 * WHY IT IS NEEDED. Vite's dev server resolves an HTML entry's `src` as a URL
 * beneath `root`, and `root` here is `dashboard/`. So `src="../src/main.tsx"`
 * became the URL `/src/main.tsx`, which is nothing under `dashboard/`, and the
 * document 404'd its own entry and rendered blank. An entry `src` has no `/@fs`
 * escape hatch, so the entry must resolve under `root` or not at all.
 *
 * The build never had the problem, which is why this went unnoticed from the
 * entry split on 2026-08-04 until 2026-08-20: rollup resolves that same
 * attribute as a file path, not a URL, so `build:dashboard` was always correct
 * while `dev` was always broken.
 *
 * `site/main.tsx` is the same file for the same reason, and says the rest.
 */
import '../src/main.js';
