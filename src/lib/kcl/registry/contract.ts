import { appendValueSpec, defineContract } from '@kittycad/registry'
import type { Executor } from '@src/lib/executors/registry/contract'
import type { KclSession } from '@src/lib/kcl/session'
import type { ModelingTarget } from '@src/lib/modelingTools/registry/contract'
import type { EngineSceneViewExtension } from '@src/registry/contracts/engineScene'

/** Contributions receive the particular modeling mode they decorate, never a global executing editor. */
export interface KclSceneContext {
  executor: Executor
  session: KclSession
  target: ModelingTarget
  active: boolean
}
export type KclSceneViewExtension = EngineSceneViewExtension<KclSceneContext>
export const { kclSceneViewExtensionsValueSpec } = defineContract({
  kclSceneViewExtensionsValueSpec: appendValueSpec<KclSceneViewExtension>(
    'kcl.scene-view-extensions'
  ),
})
