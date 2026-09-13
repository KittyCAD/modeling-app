# Workspace modes

Modes are app registry contributions. A plugin registers a stable ID, a label,
and a toolbar through `provideMode`; the mode picker discovers active
contributions automatically. Include the plugin in the app's registry tree, as
with other plugins.

This example adds a toolbar using the existing GD&T actions:

```ts
import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
} from '@kittycad/registry'
import { createGdtToolbarItems } from '@src/lib/gdtToolbar'
import { commandSystemService } from '@src/registry/contracts/commands'
import { provideMode } from '@src/registry/contracts/modes'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'

const reviewMode = defineRegistryItemFactory(({ services }) => ({
  item: defineRuntimeRegistryItem({
    id: 'review-example.mode',
    provides: [
      provideMode({
        id: 'review-example',
        label: 'Review',
        icon: 'gdtDatum',
        toolbar: createGdtToolbarItems({
          send: (...args) => services.get(commandSystemService).send(...args),
        }),
      }),
    ],
  }),
}), 'review-example.mode')

export default createZdsPlugin({
  id: 'review-example',
  title: 'Review',
  description: 'Review geometric dimensions and tolerances.',
  items: [reviewMode],
  defaultSetting: 'off',
})
```

Resolve services inside callbacks, as above, rather than while constructing the
registry graph. Toolbar entries use the existing `ToolbarItem` callbacks,
disabled predicates, dropdowns, and `'break'` separators. Experimental entries
follow the same feature flag as built-in toolbars. A toolbar may also name a
built-in toolbar configuration.

The modeling machine's command/keymap scope stays active, preserving core file
commands such as undo, render, and camera controls. `keymapScope` adds a plugin
scope alongside it. Register matching commands, keybindings, and optional scope
metadata with `provideCommandScope`. Keep plugin scopes outside the `context`
group: the app owns that exclusive group for modeling, sketch, home, and settings
states. Set scope priority when bindings need to take precedence over existing
bindings.

## Scenes

Omitting `Scene` keeps the built-in client interaction scene. Supplying a React
component replaces that client layer above the engine stream; the engine stream
and connection stay mounted. The component receives `EngineSceneExtensionContext`
and can draw over the stream or cover it with its own renderer. Keep the component
identity stable and clean up resources on unmount. Prefer a lazy import when a
scene reaches app boot or other eagerly initialized registry modules.

All built-in modes share `BuiltInModeScene`. Switching between modeling, sketch,
and a plugin without a custom scene therefore preserves the same client canvas
and camera controls.

## Selection and lifecycle

`modesService.setMode(id)` selects an available mode and returns whether the
switch succeeded. The modeling machine owns sketch modes (`selectable: false`)
and blocks manual switching during sketches and transitions. It temporarily
overrides the selected plugin mode; leaving the sketch restores that selection.
Leaving the workspace resets selection to modeling.

Disabling or removing a plugin removes its modes. If its mode was selected, the
selection resets to modeling, including while a sketch is active. Enabling the
plugin again makes its mode available without reselecting it.

For feature-gated modes, configure the plugin's activation policy. The
[DFM Review plugin](../../plugins/dfmReview/index.ts) starts disabled until
`dfm_review` is available, enables by default for eligible users while respecting
their preference, and uses `disableWithoutFeature` to deactivate on flag loss.
That removal follows the same mode and scene cleanup path as disabling the
plugin in settings.
