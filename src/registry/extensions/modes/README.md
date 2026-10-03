# Workspace modes

Modes are app registry contributions. A plugin registers a stable ID, a label,
and a toolbar through `provideMode`; the mode picker discovers active
contributions automatically. Include the plugin in the app's registry tree, as
with other plugins.

This example contributes a toolbar action that opens a panel owned by the plugin:

```ts
import { defineRegistryItem } from '@kittycad/registry'
import { provideMode } from '@src/registry/contracts/modes'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { openInspectionPanel } from './inspectionPanel'

const inspectionMode = defineRegistryItem({
  id: 'inspection-example.mode',
  provides: [
    provideMode({
      id: 'inspection-example',
      label: 'Inspection',
      icon: 'search',
      toolbar: [
        {
          id: 'inspection-example.inspect',
          title: 'Inspect',
          description: 'Inspect the current model.',
          icon: 'search',
          status: 'available',
          links: [],
          onClick: openInspectionPanel,
        },
      ],
    }),
  ],
})

export default createZdsPlugin({
  id: 'inspection-example',
  title: 'Inspection',
  description: 'Inspect the current model.',
  items: [inspectionMode],
  defaultSetting: 'off',
})
```

The plugin supplies `openInspectionPanel` and its panel implementation.
If an action uses registry services, resolve them inside its callback rather than
while constructing the registry graph. Toolbar entries use the existing `ToolbarItem` callbacks,
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

For feature-gated modes, configure the plugin's activation policy. Disabling a
plugin after its feature becomes unavailable follows the same mode and scene
cleanup path as disabling the plugin in settings.
