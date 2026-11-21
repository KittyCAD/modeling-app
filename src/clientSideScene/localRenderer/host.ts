import type { EntityType } from '@kittycad/lib'
import type { ReadonlySignal } from '@preact/signals-core'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { ArtifactGraph } from '@src/lang/wasm'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import type RustContext from '@src/lib/rustContext'
import type { SettingsActorType } from '@src/machines/settingsMachine'

/** Execution and interaction inputs consumed by the local presentation, independent of editor ownership. */
export interface LocalRendererHost {
  readonly executionEvents: Pick<
    EventTarget,
    'addEventListener' | 'removeEventListener'
  >
  readonly executing: ReadonlySignal<boolean>
  /** Published together with the artifact graph, after execution finishes. */
  readonly sceneGeneration: ReadonlySignal<number | null>
  /** Current execution result; null when no model is available for this source. */
  currentSceneGeneration: () => number | null
  readonly selectionFilter: ReadonlySignal<EntityType[]>
  readonly commands: Pick<
    ConnectionManager,
    'sendSceneCommand' | 'setLocalSelectionCommandHandler' | 'pendingCommands'
  >
  readonly sceneInfra: SceneInfra
  readonly settingsActor: SettingsActorType
  artifacts: () => ArtifactGraph
  defaultPlanes: () => RustContext['defaultPlanes']
  hasErrors: () => boolean
  exportModel: (
    format: Parameters<RustContext['export']>[0]
  ) => ReturnType<RustContext['export']>
  captureThumbnail?: (canvas?: HTMLCanvasElement) => void
}
