import { appendValueSpec, defineContract } from '@kittycad/registry'
import type { Executor } from '@src/lib/executors/registry/contract'
import type { KclSession } from '@src/lib/kcl/session'
import type { EngineSceneViewExtension } from '@src/registry/contracts/engineScene'

/** A modeling tool receives the executor and engine session of the view hosting it. */
export interface KclSceneContext {
  executor: Executor
  session: KclSession
}

export type KclSceneViewExtension = EngineSceneViewExtension<KclSceneContext>

export const kclSceneContract = defineContract({
  kclSceneViewExtensionsValueSpec: appendValueSpec<KclSceneViewExtension>(
    'kcl.scene-view-extensions'
  ),
})

export const { kclSceneViewExtensionsValueSpec } = kclSceneContract
