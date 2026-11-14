import type { SketchSolveSelectionId } from '@src/machines/sketchSolve/sketchSolveSelection'
import { appendValueSpec, defineContract } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { ToolbarViewItem } from '@src/components/Toolbar/ToolbarView'
import type { SceneGraphDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import type { KclSettingsAnnotation } from '@src/lib/settings/settingsTypes'
import type { SketchRuntime } from '@src/lib/kcl/sketchRuntime'

/** Sketch tools borrow the active session's native operations and Three.js surface. */
export interface SketchToolHost {
  infra: SceneInfra
  settings: SettingsRegistryService
  runtime: SketchRuntime
  sketchId: number
  lengthUnit: KclSettingsAnnotation['defaultLengthUnit']
  hover: (id: SketchSolveSelectionId | null) => void
  getDelta: () => SceneGraphDelta
  render: (
    delta: SceneGraphDelta,
    draft?: { segmentIds: number[]; constraintIds: number[] }
  ) => void
  accept: (
    result: Pick<
      Awaited<ReturnType<SketchRuntime['remove']>>,
      'kclSource' | 'sceneGraphDelta'
    >
  ) => void
  isCurrent: () => boolean
  onError: (error: Error) => void
}
export interface SketchTool {
  prompt: ReadonlySignal<string>
  escape: () => Promise<boolean>
  dispose: () => Promise<void>
}
export interface SketchToolDefinition {
  id: string
  name: string
  icon: ToolbarViewItem['icon']
  create: (host: SketchToolHost) => SketchTool | Promise<SketchTool>
}
export const sketchInteractionContract = defineContract({
  sketchToolsValueSpec: appendValueSpec<SketchToolDefinition>(
    'modeling-view.sketch.tools'
  ),
})
export const { sketchToolsValueSpec } = sketchInteractionContract
