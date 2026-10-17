# `@kittycad/ui-components`

This workspace is the promotion target for components that are ready to move out of the application tree and into a documented, tested library.

## What belongs here

- Components with an app-agnostic API.
- Components with Storybook stories.
- Components with Vitest coverage for rendering and behavior.
- Components that do not depend on app-only state machines, routing, or network clients.

## Commands

- `npm run storybook -w @kittycad/ui-components`
- `npm run build-storybook -w @kittycad/ui-components`
- `npm run test -w @kittycad/ui-components`
- `npm run build -w @kittycad/ui-components`

## Suggested migration flow

1. Keep iterating in `src/components` while the component is tightly coupled to the app.
2. Extract the UI surface into this package once the API settles.
3. Add or expand stories, component tests, and unit tests here before wider reuse.

## Web component pilot: feature tree row

`zoo-feature-tree` and `zoo-feature-tree-row` are controlled Lit elements with
shadow-scoped styles. The container owns keyboard focus, typeahead (typing to
focus matching labels), and ARIA tree semantics. The app owns selection and
expansion. A row can also be used standalone, where it exposes ordinary buttons.

Import the separate entry point to avoid importing React code:

```ts
import { registerFeatureTreeRow } from '@kittycad/ui-components/web-components'

registerFeatureTreeRow()
const row = document.createElement('zoo-feature-tree-row')
row.nodeId = 'extrude-1'
row.label = 'Extrude'
row.detail = '10 mm'
row.addEventListener('zoo-select', (event) => {
  // The application owns selection; feed its resulting state back into the row.
  row.selected = true
})
document.body.append(row)
```

Registration is explicit and safe to call repeatedly. Existing React exports
remain available at the package root. React is still a required peer of the
package as a whole; the web component entry point itself does not import React.

### Composition and state

| Input | Meaning |
| --- | --- |
| `nodeId` / `node-id` | Application identity returned in event details |
| `label` | Plain-text label and disclosure accessible name |
| `detail` | Optional secondary text |
| `selected` | Application-controlled selection, also reflected as an attribute |
| `disabled` | Disables the built-in selection and disclosure buttons |
| `expanded` | Property only: `undefined` for a leaf, `false`/`true` for a collapsed/expanded branch |

Slots allow DOM content from any framework:

```html
<zoo-feature-tree-row node-id="sketch-1" label="Sketch001">
  <svg slot="icon" aria-hidden="true"><!-- icon geometry --></svg>
  <span slot="label">Sketch001</span>
  <span slot="detail">XY plane</span>
  <span slot="status" role="img" aria-label="Has a warning">⚠</span>
  <button slot="actions" aria-label="Hide Sketch001">Hide</button>
  <button slot="actions" aria-label="More actions for Sketch001">…</button>
</zoo-feature-tree-row>
```

Keep label/detail slots non-interactive; place interactive content in `actions`.
The optional `disclosure-icon` slot replaces the default chevron in the standard
appearance. Supply a downward-facing decorative icon; the row rotates it toward
the inline end when collapsed, including in RTL. HUD mode keeps its junction dots.
When overriding the label slot, keep the `label` property synchronized for the
disclosure's accessible name. Icons are decorative; meaningful status belongs in
the status slot. Callers own the styling, accessible names, disabled state, and
behavior of slotted actions. They remain outside the built-in selection button.

The bubbling, composed events are `zoo-select` (`{ nodeId }`) and `zoo-expand`
(`{ nodeId, expanded }`). Neither changes state internally. No signals are
required: property assignments schedule Lit updates. Applications may bridge
their own reactive stores into those properties.

### Styling

The element does not require Tailwind or application CSS. Theme it through
inherited CSS custom properties:

| Token | Default |
| --- | --- |
| `--zoo-tree-color` | `#242b35` |
| `--zoo-tree-muted-color` | `#596372` |
| `--zoo-tree-background` | `transparent` |
| `--zoo-tree-hover-background` | `#edf0f4` |
| `--zoo-tree-selected-background` | `#dce9ff` |
| `--zoo-tree-selected-color` | `inherit` |
| `--zoo-tree-focus-color` | `#2563eb` |
| `--zoo-tree-font` | `400 0.875rem/1.4 system-ui, sans-serif` |
| `--zoo-tree-row-height` | `2rem` (minimum height) |
| `--zoo-tree-row-padding` | `0.125rem 0.375rem` |
| `--zoo-tree-content-padding` | `0.25rem 0` |
| `--zoo-tree-disclosure-height` | `1.5rem` |
| `--zoo-tree-gap` | `0.375rem` |
| `--zoo-tree-radius` | `0.25rem` |
| `--zoo-tree-indent` | `1rem` |
| `--zoo-tree-padding` | `0.25rem` (tree container) |
| `--zoo-tree-guide-color` | `#8a9aaa` (HUD connectors) |

For targeted customization, exposed CSS parts are `row`, `disclosure`, `content`,
`label`, `detail`, `status`, and `actions`. Tokens cover shared visual decisions;
parts provide an escape hatch for specific surfaces.

### Native Lit stories

`npm run storybook:web-components -w @kittycad/ui-components` starts a separate
Web Components Storybook on port 6007. It uses Lit templates directly and loads
no application stylesheet. Stories cover default, selected, disabled, composed,
and dark-themed rows, plus interactive, narrow, dark, and multiple-selection
trees. Tree examples have a resize handle at their lower-right corner. The
existing React Storybook stays on port 6006.

### Composing a tree

```ts
import { registerFeatureTree } from '@kittycad/ui-components/web-components'
registerFeatureTree() // Also registers rows.
```

```html
<zoo-feature-tree aria-label="Model features">
  <zoo-feature-tree-row node-id="housing" label="Housing">
    <zoo-feature-tree-row slot="children" node-id="sketch" label="Sketch001">
      <span slot="detail">XY plane</span>
      <button slot="actions" aria-label="Hide Sketch001">Hide</button>
    </zoo-feature-tree-row>
  </zoo-feature-tree-row>
</zoo-feature-tree>
```

Supply direct rows at the root and direct `slot="children"` rows for each
branch. Keep `nodeId` non-empty, unique, and stable across updates. A row with
children is a branch; a row without children is a leaf. The container derives
hierarchy from the DOM and supplies row selection/expansion and tree semantics;
do not assign those states or `treeItem` on managed rows.

Set `selectedIds` and `expandedIds` to immutable arrays of IDs. Listen for
`zoo-selection-change` (`{ nodeId, selectedIds }`) and `zoo-expand`
(`{ nodeId, expanded }`), update your app state, then assign the resulting arrays
back to the element. Requests do not mutate the controlled state. `multiselect`
enables independent toggling; single-selection is the default. When switching
to single-selection, supply at most one selected ID.

Arrow Up/Down and Home/End move focus without changing selection. Right opens a
branch or moves to its first child; Left closes it or moves to its parent.
Space/Enter selects, and in multiple-selection mode toggles the focused row.
Typing searches visible labels; repeated letters cycle matching labels. Disabled
rows remain discoverable by keyboard but cannot be selected or expanded.
Collapsing a branch containing focus moves focus back to a visible ancestor.

Tab enters at the current focused row (initially a selected visible row, or the
first row). F2 enters the first supplementary action and cycles through actions;
Escape returns to the row. Tab leaves the tree. Keep actions as native buttons
or links (or wrappers containing them), with explicit accessible names. Slotted
custom elements with their own shadow-root focus behavior are not supported by
the action-navigation helper yet. Callers own disabling their actions.

Right-clicking a row label or pressing Shift+F10/the Context Menu key emits
`zoo-context-menu` (`{ nodeId, clientX, clientY }`). The consumer owns menu UI.
Neither visibility toggles nor action buttons select the row automatically.

The tree fills its wrapper and scrolls vertically when constrained. It owns no
width or resizing control: put it inside any resizable wrapper with a definite
height (or a flex column with `min-height: 0`). Labels/details truncate while
status and action controls retain their widths. The examples support widths
down to 220px; extremely deep nesting or oversized action content may require
horizontal scrolling. There is no virtualization or lazy child loading yet.

### HUD presentation

Set `appearance="hud"` on the tree to use transparent rows, compact spacing,
and branching guides instead of chevrons. The same rows, slots, events, and
keyboard interactions work in either presentation. Layout metadata and mode
are supplied to managed rows by the container; consumers do not draw connectors.

```html
<zoo-feature-tree appearance="hud" aria-label="Model features">
  <!-- Same row composition as the default presentation. -->
</zoo-feature-tree>
```

Hollow branch junctions mean expanded; filled junctions mean collapsed. They
remain labeled disclosure buttons. Guide lines end at the last sibling and
continue past expanded sibling subtrees. All geometry uses logical inline/block
directions so it mirrors under `dir="rtl"`.

HUD defaults use transparent hover/selection tints and a smaller indent (0.75rem).
Existing tree color tokens override these defaults. Place the element directly
over your scene; the library does not supply a panel, backdrop, border, or blur.
The HUD stories supply a separate resizable wrapper and simulated scene grid to
demonstrate transparency. Icons remain optional slotted content; these examples
omit them for a quieter presentation.

HUD-specific tokens are `--zoo-tree-guide-color`, `--zoo-tree-guide-width` (default
`1px`), `--zoo-tree-junction-color` (defaults to the guide color),
`--zoo-tree-junction-size` (default `0.375rem`), and `--zoo-tree-junction-radius`
(default `50%`). Circle centers and guide endpoints share geometry, including
when junction size or line width changes. Keep junction size within the 0.75rem
disclosure width. The `junction` CSS part also exposes the dot for customization.

```css
zoo-feature-tree[appearance='hud'] {
  --zoo-tree-guide-color: #91a9be;
  --zoo-tree-guide-width: 1px;
  --zoo-tree-junction-color: #d5e7f6;
  --zoo-tree-junction-size: 8px;
  --zoo-tree-selected-background: rgb(130 180 240 / 0.14);
}
```

Register with `registerFeatureTree()`, compose rows as above, and assign
`selectedIds`/`expandedIds` from application state. HUD mode changes only
presentation. Tokens inherit through the tree into nested rows, including when
the wrapper sets them. The wrapper supplies its scene/background and dimensions.

Direction is inherited from `dir="rtl"` on the tree or an ancestor. Branch
navigation mirrors automatically: Left opens/enters and Right closes/returns to
the parent. Vertical arrows, Home/End, and selection keep their meanings. The
HUD Right To Left story demonstrates Hebrew content with inherited direction.

### Application-controlled shortcuts

Optional shortcuts are a convenience layer over public methods. A consuming app
can replace them without depending on DOM internals:

```ts
tree.shortcuts = {
  focusActions: [{ key: 'a', alt: true }],
  focusRow: [{ key: 'r', alt: true }],
  requestContextMenu: [{ key: 'm', alt: true }],
}
```

Keys use `KeyboardEvent.key`, with exact `shift`, `ctrl`, `alt`, and `meta`
modifiers (omitted means false). Each provided array replaces that action's
defaults; `[]` disables one action. Unspecified actions retain their defaults:
F2 for entering/cycling actions, Escape for returning from an action to its row,
and Shift+F10 or ContextMenu for requesting a menu from a row. Handled native
action editing, composing events, and already-prevented events are left alone.

For registry-owned bindings, set `tree.shortcuts = false` and have commands call:

- `tree.focusActions()` to enter/cycle enabled, visible supplementary actions;
- `tree.focusRow()` to return to the current row;
- `tree.requestContextMenu()` to emit the usual menu request.

These methods return whether they performed the action. `focusedNodeId` exposes
the current row identity for command context. Navigation, selection, and typeahead
remain built in when optional shortcuts are disabled. No app command IDs or
registry dependencies are part of the element. This API does not itself solve
precedence with a global capture-phase keymap; that bridge belongs to the ZDS
registry adapter, together with focus scopes and editable command bindings.

### Testing the tree

- `npm run test -w @kittycad/ui-components` runs unit, component, lifecycle, and
  bounded property tests through Vitest.
- `npm run test:properties -w @kittycad/ui-components` runs only the generated
  histories. They cover 60 histories of up to 35 operations against an independent
  flat model, including insert/remove/reorder, expansion, disabled state, RTL,
  navigation, controlled state, and ARIA metadata. Fast-check prints a seed and
  shrink path for reproducing a failure.
- `npm run test:browser -w @kittycad/ui-components` runs Chromium regressions with
  an isolated Vite fixture on port 6010. Install Chromium with Playwright's
  `playwright install chromium` command if it is not already installed. These
  tests need no engine, Wasm build, application credentials, or Storybook server.

Browser tests cover real Tab entry/exit through shadow slots, editable shortcuts,
public actions, focus recovery without stealing outside focus, composed events,
RTL, HUD guide/circle geometry, focus/selection rectangles, and resize behavior.
They deliberately avoid screenshot baselines for pixel geometry and instead
measure actual rendered boxes and pseudo-elements. The generated DOM suite
documents happy-dom limitations around disabled custom elements and moving a
focused subtree; browser tests exercise those cases.
