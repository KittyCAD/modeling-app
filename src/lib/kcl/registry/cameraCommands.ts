import {
  cameraViewDefinitions,
  createCameraKeymapItems,
  cameraShortcutHints,
} from '@src/lib/cameraViewCommands'
import { observeService } from '@src/registry/inputs'
import { computed, effect, untracked } from '@preact/signals-core'
import { factory } from 'plankton'
import { createCameraCommands } from '@src/lib/kcl/modeling/cameraCommands'
import {
  COMMAND_PALETTE_OPEN_COMMAND_SCOPE,
  observations,
  provideCommand,
  provideCommandScope,
} from '@src/registry/contracts/commands'
import {
  provideKeymapItem,
  keymapService,
} from '@src/registry/contracts/keymap'

export const MODELING_VIEW_FOCUSED_SCOPE = 'kcl.modeling-view-focused'

/** Registers camera actions once; mounted Modeling viewports supply their targets. */
export const cameraCommands = factory({
  key: 'kcl-camera-commands',
  dependencies: {
    commands: observations,
    keymap: observeService(keymapService),
  },
  create: ({ commands, keymap }) => {
    const paletteOpen = computed(
      () =>
        commands.commandScopeService.current.value?.activeScopes.value.includes(
          COMMAND_PALETTE_OPEN_COMMAND_SCOPE
        ) ?? false
    )
    const camera = createCameraCommands(() => paletteOpen.peek())
    return {
      exports: {
        attach: camera.attach,
        shortcuts: computed(() => {
          const service = keymap.current.value
          return service
            ? cameraShortcutHints(
                service.keymap.value,
                { type: 'modeling', scope: MODELING_VIEW_FOCUSED_SCOPE },
                [MODELING_VIEW_FOCUSED_SCOPE],
                commands.commandScopesFacet.value
              )
            : {}
        }),
      },
      items: [
        provideCommandScope({
          id: MODELING_VIEW_FOCUSED_SCOPE,
          displayName: 'Modeling view focused',
          priority: 1200,
          userEditable: false,
        }),
        ...cameraViewDefinitions.map(({ id: action, title }) => {
          const id = `kcl.camera.${action}`
          return provideCommand({
            id,
            name: id,
            groupId: 'kcl.camera',
            displayName: title,
            description: 'Move the camera in the focused Modeling view.',
            needsReview: false,
            scopes: [MODELING_VIEW_FOCUSED_SCOPE],
            get disabled() {
              return !camera.available(action === 'center')
            },
            onSubmit: () => camera.run(action),
          })
        }),
        ...createCameraKeymapItems({
          type: 'modeling',
          scope: MODELING_VIEW_FOCUSED_SCOPE,
        }).map(provideKeymapItem),
      ],
      start: () => {
        const stopScope = effect(() => {
          const scopes = commands.commandScopeService.current.value
          if (!scopes || !camera.focused.value) return
          untracked(() => scopes.applyScope(MODELING_VIEW_FOCUSED_SCOPE))
          return () =>
            untracked(() => scopes.removeScope(MODELING_VIEW_FOCUSED_SCOPE))
        })
        // The palette captures launch scopes before its input takes focus. Keep
        // its originating viewport until submission or dismissal, then reconcile.
        const stopPalette = effect(() => {
          if (!paletteOpen.value) untracked(camera.releaseIfOutside)
        })
        return () => {
          stopPalette()
          stopScope()
        }
      },
    }
  },
})
