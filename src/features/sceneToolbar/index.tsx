import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed } from '@preact/signals'
import { commandsValueSpec } from '@src/contracts/commands'
import {
  keybindingScopesValueSpec,
  keybindingService,
  keybindingsValueSpec,
} from '@src/contracts/keybindings'
import { sceneItemsValueSpec } from '@src/contracts/scene'
import {
  EXIT_MODE_COMMAND,
  sceneModeGatesValueSpec,
  sceneModeService,
  sceneModesValueSpec,
} from '@src/contracts/sceneModes'
import { selectionService } from '@src/contracts/selection'
import { SceneToolbar } from '@src/features/sceneToolbar/SceneToolbar'
import { createSceneModeService } from '@src/features/sceneToolbar/createSceneModeService'
import { syncModeKeymapScope } from '@src/features/sceneToolbar/modeKeymapScope'
import { builtInModes } from '@src/features/sceneToolbar/modes'

/** The keystroke that enters each shipped mode, after the `m` prefix. */
const MODE_KEYSTROKES: Readonly<Record<string, string>> = {
  modeling: 'm',
  sketching: 's',
  annotating: 'a',
}

/**
 * Modal tools over the scene.
 *
 * The existing app decides which toolbar to show by matching the state of one
 * large machine, which is why a new mode there means editing that machine. Here
 * a mode is a contribution, its tools are contributions naming commands, and
 * this feature owns only the arrangement: which mode is active, which keymap
 * scope that makes live, and how a strip of contributed items is drawn.
 *
 * Nothing here knows what modelling is. Deleting the modelling operations leaves
 * a working toolbar with an empty Model mode that says so.
 */
export default defineRegistryItemFactory((ctx) => {
  const modes = createSceneModeService({
    modes: computed(() => ctx.valueSpecs.get(sceneModesValueSpec)),
    gates: computed(() => ctx.valueSpecs.get(sceneModeGatesValueSpec)),
  })

  /**
   * Hold the active mode's keymap scope.
   *
   * Deferred by a microtask twice over: reading a service during graph
   * construction is not allowed, and the effect's first run reads the modes value
   * spec, which is still being flattened.
   */
  let stopScope: (() => void) | null = null
  let disposed = false
  queueMicrotask(() => {
    if (disposed) return
    const keys = ctx.services.get(keybindingService)
    stopScope = syncModeKeymapScope({
      active: modes.active,
      applyScope: (scopeId) => keys.applyScope(scopeId),
      removeScope: (scopeId) => keys.removeScope(scopeId),
    })
  })

  return {
    model: modes,
    item: defineRuntimeRegistryItem({
      id: 'sceneToolbar',
      dispose: () => {
        disposed = true
        stopScope?.()
      },
      providesServices: [provideService(sceneModeService, modes)],
      provides: [
        provide(sceneItemsValueSpec, {
          id: 'scene.toolbar',
          zone: 'top',
          order: 0,
          render: () => <SceneToolbar />,
        }),

        /**
         * Escape: stop what I was doing.
         *
         * Leaving a mode has to be sayable, and this is the saying. A click on
         * nothing in the scene runs the same command, because a click on nothing
         * means the same thing — though a mode with work behind it may claim
         * that click first, and sketching does.
         *
         * It clears the selection too. Both are "I am done with this", and
         * splitting them would mean pressing Escape twice for one intention.
         *
         * Base scope, so it is live wherever nothing more local has claimed
         * Escape: the palette, a rename field and the argument prompt all handle
         * their own first, and the keymap leaves bare keys to whatever is taking
         * text.
         */
        provide(commandsValueSpec, {
          id: EXIT_MODE_COMMAND,
          title: 'Leave the current mode',
          category: 'Scene',
          icon: 'close',
          run: () => {
            modes.reset()
            ctx.services.optional(selectionService)?.clear()
          },
        }),

        provide(keybindingsValueSpec, {
          keystrokes: ['Escape'],
          commandId: EXIT_MODE_COMMAND,
        }),

        ...builtInModes.flatMap((mode) => [
          provide(sceneModesValueSpec, mode),

          /**
           * A scope per mode, so bindings can be modal without the keymap
           * knowing what a mode is.
           *
           * Default priority: a mode scope is not trying to take a key away from
           * anything, it is trying to mean something while it is live. The
           * editor's text-entry scope still wins bare letters, which is what
           * keeps `e` from extruding while somebody types.
           */
          ...(mode.keymapScope
            ? [
                provide(keybindingScopesValueSpec, {
                  id: mode.keymapScope,
                  displayName: `${mode.title} mode`,
                }),
              ]
            : []),

          provide(commandsValueSpec, {
            id: `scene.mode.${mode.id}`,
            title: `${mode.title} mode`,
            category: 'Scene',
            icon: mode.icon,
            // Gates included: the palette must not offer a mode the switcher
            // shows as unavailable, or the two disagree about the same fact.
            enabled: computed(() => modes.availability(mode.id).available),
            run: () => modes.enter(mode.id),
          }),

          ...(MODE_KEYSTROKES[mode.id]
            ? [
                provide(keybindingsValueSpec, {
                  // `m` then a letter, matching the `v` prefix the view
                  // commands already use: a chord for switching context, single
                  // keys left for the tools inside it.
                  keystrokes: ['m', MODE_KEYSTROKES[mode.id]],
                  commandId: `scene.mode.${mode.id}`,
                }),
              ]
            : []),
        ]),
      ],
    }),
  }
}, 'sceneToolbar')
