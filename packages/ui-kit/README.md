# @kittycad/ui-kit

Design system and UI building blocks for Zoo Design Studio.

Two layers, usable independently:

| Layer | Path | What it is |
| --- | --- | --- |
| Design system | `@kittycad/ui-kit/tokens` and `/styles.css` | CSS custom properties plus a typed TS mirror. Colour ramps, spacing, type scale, radii, motion, elevation, and the shared visual vocabulary. |
| Components | `@kittycad/ui-kit` | Buttons, panels, splits, menus, empty states, sheet cards. Preact components styled only with tokens. |

Built on Preact and `@preact/signals`. Signals passed into props and children
are subscribed directly by Preact, so most updates patch one attribute or one
text node without re-running the owning component.

## Styling contract

Components never hard-code a colour or a size. Every visual decision reads a
token, and every component exposes its own custom properties for local
overrides, so a third-party app can adopt a component without adopting our
brand:

```css
.my-app .zds-button {
  --zds-button-radius: 999px;
  --zds-button-bg: var(--zds-ramp-datum-400);
}
```

Three token layers, in strict order. Components may only read layers 2 and 3.

1. **Ramps** — `--zds-ramp-*`. Raw OKLCH scales, theme-independent.
2. **Semantics** — `--zds-surface-*`, `--zds-text-*`, `--zds-border-*`,
   `--zds-status-*`. What a colour *means*. Remapped per theme.
3. **Scales** — `--zds-space-*`, `--zds-font-*`, `--zds-radius-*`,
   `--zds-motion-*`, `--zds-size-*`. Dimensional systems.

Theme is published as `data-zds-theme="dark" | "light"` on the root element.

## The visual language

The direction is an instrument, not a document: chrome in a CAD app should
recede behind the geometry.

- **Two type roles.** Sans carries content. Mono, uppercase and widely tracked
  (`.zds-label`), carries every piece of metadata — status fields, rail names,
  title-block labels. You can tell at a glance whether text is a value or a
  name for one.
- **Two materials, two radii.** The chassis is machined: square corners,
  hairline seams. Content is softened at 3px. Never mixed on one element.
- **Seams, not borders.** `.zds-seam-*` draws a dark scribe line with a light
  land on the near side, so panel edges read as a physical gap. Dense layouts
  stay legible at far lower contrast than a grey border needs.
- **Rationed accent.** `.zds-datum` — a 2px stripe borrowed from the GD&T datum
  symbol — marks the focused surface, and is the only routine use of accent in
  the chassis. If something is green, it is live or it is where your keystrokes
  go.
- **Empty is a first-class state.** `EmptyState` exists because no project, no
  file, and no connection are all normal here. Every one of them says what the
  surface is for and what to do next.

## Getting values out of CSS

Some consumers cannot read `var()` — WebGL clear colours, canvas strokes,
generated textures. `resolveToken` reads the live cascade for them:

```ts
import { resolveToken, tokens } from '@kittycad/ui-kit/tokens'

const background = resolveToken(tokens.surface.viewport)
```
