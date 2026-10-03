import {
  defineContract,
  defineService,
  defineValueSpec,
  provide,
  type Precedence,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { CustomIconName } from '@src/components/CustomIcon'
import type {
  ToolbarDropdown,
  ToolbarItem,
  ToolbarModeName,
} from '@src/lib/toolbar'
import type { EngineSceneExtensionContext } from '@src/registry/contracts/engineScene'
import type { ComponentType } from 'react'

export type ModeToolbarItem = ToolbarItem | ToolbarDropdown | 'break'

/**
 * A workspace mode contributed by a built-in registry item or a plugin.
 *
 * Omit Scene to retain the modeling mode's client scene. An optional Scene
 * replaces that layer above the engine stream, which stays mounted. A custom
 * renderer can overlay the engine or cover it with an opaque viewport.
 */
export type ModeDefinition = {
  id: string
  label: string
  icon?: CustomIconName
  toolbar: ToolbarModeName | readonly ModeToolbarItem[]
  Scene?: ComponentType<EngineSceneExtensionContext>
  /** Additional command/keymap scope; the machine's scope stays active. */
  keymapScope?: string
  /** Machine-driven modes such as sketching cannot be selected directly. */
  selectable?: boolean
}

export type ModesRegistryService = {
  modes: ReadonlySignal<readonly ModeDefinition[]>
  selectedModeId: ReadonlySignal<string>
  activeMode: ReadonlySignal<ModeDefinition | undefined>
  canSelectMode: ReadonlySignal<boolean>
  /** Returns false for unavailable modes or while a machine mode is active. */
  setMode: (id: string) => boolean
  /** The modeling machine owns sketch entry, exit, and transition locks. */
  syncModelingMode: (mode: ToolbarModeName, canSelect?: boolean) => void
  reset: () => void
}

export const modesContract = defineContract({
  modesValueSpec: defineValueSpec<ModeDefinition, readonly ModeDefinition[]>({
    name: 'modes',
    defaultValue: [],
    combine: (inputs) => {
      const ids = new Set<string>()
      return inputs.filter((mode) => {
        if (ids.has(mode.id)) return false
        ids.add(mode.id)
        return true
      })
    },
  }),
  modesService: defineService<ModesRegistryService>('modes.service'),
})

export const { modesValueSpec, modesService } = modesContract

/** Register a mode with a stable identity, preserving registry precedence. */
export function provideMode(mode: ModeDefinition, precedence?: Precedence) {
  return provide(modesValueSpec, mode, { key: mode.id, precedence })
}

/** Keep workspace commands available when a plugin adds its own bindings. */
export function resolveModeKeymapScopes(
  mode: ModeDefinition | undefined,
  modelingScope: string
): readonly string[] {
  if (!mode?.keymapScope || mode.keymapScope === modelingScope) {
    return [modelingScope]
  }
  return [modelingScope, mode.keymapScope]
}
