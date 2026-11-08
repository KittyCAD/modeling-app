# Theme-independent appearance

Components choose a visual role. `src/semanticColors.css` maps that role to the
light/dark palette, and `tailwind.config.js` exposes opacity-capable utilities.
A theme change updates CSS variables without changing component class lists.

Use surface utilities such as `bg-default` and `bg-2`, foreground utilities such
as `text-default` and `text-2`, and border colors such as `b-4`.

The definitions are the source of truth:

- [semanticColors.css](../../src/semanticColors.css) assigns the palette values
  for each role in light and dark themes.
- [tailwind.config.js](../../tailwind.config.js) defines the utility names,
  aliases, and opacity support.

Background, text, and border levels are independent scales. Choose the role,
not a numeric inversion of a raw color. Keep accents such as `bg-primary` and
intent colors such as warnings when they express the component's meaning.

```tsx
<div className="border b-4/50 bg-2 text-default hover:bg-3/60" />
```

`border-2` still sets border width. Use `b-*` for border color.
`border-bg-*` matches a background role and supports opacity, such as
`border-bg-2/50`. Use `outline-color-4/50` for outline color; legacy
`outline-2` through `outline-5` also overlap Tailwind outline widths.

Prefer existing roles. If several components need a missing role, add a shared
role and document its intent and both theme mappings before using it. Raw
palette values belong in central themes, syntax palettes, or intentional data
and geometry colors. A local `zds/prefer-theme-utilities` suppression must explain
an exceptional UI use; there is no automatic color replacement because context
is needed to choose the right role.

Warnings initially cover editor-mode UI and its shared tabs and empty-state
components, in JSX strings/templates and CSS `@apply`. Test fixtures and central
palette definitions are excluded. Extend the scope as components migrate. The
existing lint command rejects warnings, so migrated code should be warning-free.

