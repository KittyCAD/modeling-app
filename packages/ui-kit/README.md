# @kittycad/ui-kit

Framework-free UI building blocks for Zoo Design Studio.

Three layers, each usable on its own:

| Layer | Path | What it is |
| --- | --- | --- |
| Reactive DOM | `@kittycad/ui-kit/reactive` | ~400 lines mapping Preact signals onto real DOM nodes. No virtual DOM, no diffing, no component re-renders. |
| Design system | `@kittycad/ui-kit/tokens` | CSS custom properties plus a typed TS mirror. Colour ramps, spacing, type scale, radii, motion, elevation. |
| Components | `@kittycad/ui-kit` | Buttons, panels, menus, empty states, toolbars — styled only with tokens, so a host app restyles them by overriding custom properties. |

## Why no framework

The view layer should be the thinnest part of the app. Signals already describe
"what changed"; a virtual DOM re-derives that information by re-running render
functions and comparing trees. Binding a signal straight to an attribute or a
text node skips the middle step:

```ts
import { h, text, when } from '@kittycad/ui-kit/reactive'
import { signal, computed } from '@preact/signals-core'

const count = signal(0)

const view = h('button', { onClick: () => count.value++ },
  text(() => `clicked ${count.value} times`)
)
```

`view` is an `HTMLButtonElement`. Updating `count` writes to exactly one text
node. Nothing else in the tree is visited.

## Styling contract

Components never hard-code a colour or a size. Every visual decision reads a
token, and every component exposes its own custom properties for local
overrides, so third-party apps can adopt a component without adopting our brand:

```css
.my-app .zds-button {
  --zds-button-radius: 999px;
  --zds-button-bg: var(--zds-color-accent-40);
}
```
