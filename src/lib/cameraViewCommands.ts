import { AxisNames } from '@src/lib/constants'
import {
  FILE_COMMAND_SCOPES,
  MODE_MODELING_COMMAND_SCOPE,
  type CommandScope,
} from '@src/registry/contracts/commands'
import {
  findKeymapItemForCommand,
  type KeymapItem,
  type KeymapTree,
} from '@src/registry/contracts/keymap'

/** Camera actions carry their default bindings for both scene owners. */
export const cameraViewDefinitions = [
  {
    id: 'top',
    title: 'Top view',
    axis: AxisNames.Z,
    legacyCommand: 'standardViews:Top view',
    bindings: [{ id: 'view.top', sequence: ['v', '1'], modelingOnly: true }],
  },
  {
    id: 'right',
    title: 'Right view',
    axis: AxisNames.X,
    legacyCommand: 'standardViews:Right view',
    bindings: [{ id: 'view.right', sequence: ['v', '2'], modelingOnly: true }],
  },
  {
    id: 'front',
    title: 'Front view',
    axis: AxisNames.NEG_Y,
    legacyCommand: 'standardViews:Front view',
    bindings: [{ id: 'view.front', sequence: ['v', '3'], modelingOnly: true }],
  },
  {
    id: 'back',
    title: 'Back view',
    axis: AxisNames.Y,
    legacyCommand: 'standardViews:Back view',
    bindings: [{ id: 'view.back', sequence: ['v', '4'], modelingOnly: true }],
  },
  {
    id: 'bottom',
    title: 'Bottom view',
    axis: AxisNames.NEG_Z,
    legacyCommand: 'standardViews:Bottom view',
    bindings: [{ id: 'view.bottom', sequence: ['v', '5'], modelingOnly: true }],
  },
  {
    id: 'left',
    title: 'Left view',
    axis: AxisNames.NEG_X,
    legacyCommand: 'standardViews:Left view',
    bindings: [{ id: 'view.left', sequence: ['v', '6'], modelingOnly: true }],
  },
  {
    id: 'fit',
    title: 'Zoom to fit',
    legacyCommand: 'standardViews:Zoom to fit',
    bindings: [
      { id: 'view.zoom-to-fit', sequence: ['v', 'f'], modelingOnly: true },
      {
        id: 'view.zoom-to-fit-with-modifier',
        sequence: ['mod+alt+f'],
        modelingOnly: false,
      },
    ],
  },
  {
    id: 'reset',
    title: 'Reset view',
    legacyCommand: 'zds.view.reset',
    bindings: [
      { id: 'view.reset', sequence: ['v', 'r'], modelingOnly: true },
      {
        id: 'view.reset-with-modifier',
        sequence: ['mod+alt+x'],
        modelingOnly: false,
      },
    ],
  },
  {
    id: 'center',
    title: 'Center view on selection',
    legacyCommand: 'zds.modeling.centerCameraOnSelection',
    bindings: [
      {
        id: 'modeling.center-camera-on-selection',
        sequence: ['mod+alt+c'],
        modelingOnly: false,
      },
    ],
  },
] as const

export type CameraViewAction = (typeof cameraViewDefinitions)[number]['id']
export type CameraShortcutHints = Partial<
  Record<CameraViewAction, readonly string[]>
>
type CameraCommandHost =
  | { type: 'legacy' }
  | { type: 'modeling'; scope: string }

export function cameraCommandId(
  action: (typeof cameraViewDefinitions)[number],
  host: CameraCommandHost
) {
  return host.type === 'legacy'
    ? action.legacyCommand
    : `kcl.camera.${action.id}`
}

export function createCameraKeymapItems(host: CameraCommandHost): KeymapItem[] {
  return cameraViewDefinitions.flatMap((action) =>
    action.bindings.map((binding) => ({
      id: host.type === 'legacy' ? binding.id : `kcl.camera.${binding.id}`,
      command: cameraCommandId(action, host),
      title: action.title,
      source: host.type === 'legacy' ? 'Base' : 'KCL Modeling camera',
      when:
        host.type === 'modeling'
          ? [host.scope]
          : binding.modelingOnly
            ? [MODE_MODELING_COMMAND_SCOPE]
            : FILE_COMMAND_SCOPES,
      keystrokes: binding.sequence,
    }))
  )
}

/** Resolve registered sequences after user overrides; unbound actions have no hint. */
export function cameraShortcutHints(
  tree: KeymapTree,
  host: CameraCommandHost,
  scopes: readonly string[],
  metadata: readonly CommandScope[]
): CameraShortcutHints {
  return Object.fromEntries(
    cameraViewDefinitions.map((action) => [
      action.id,
      findKeymapItemForCommand(
        tree,
        cameraCommandId(action, host),
        scopes,
        metadata
      )?.keystrokes,
    ])
  )
}
