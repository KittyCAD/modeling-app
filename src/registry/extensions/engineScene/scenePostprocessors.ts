import { defineContract, defineValueSpec } from '@kittycad/registry'
import type { ArtifactGraph } from '@src/lang/wasm'
import type { ConnectionManager } from '@src/network/connectionManager'

export interface ScenePostprocessorContext {
  artifactGraph: ArtifactGraph
  engineCommandManager: ConnectionManager
}

export interface ScenePostprocessor {
  id: string
  order?: number
  postprocess(context: ScenePostprocessorContext): Promise<void> | void
}

const byOrder = (a: ScenePostprocessor, b: ScenePostprocessor) =>
  (a.order ?? 0) - (b.order ?? 0)

const combineScenePostprocessors = (
  postprocessors: readonly ScenePostprocessor[]
) => {
  const seen = new Set<string>()
  return postprocessors
    .filter((postprocessor) => {
      if (seen.has(postprocessor.id)) {
        return false
      }
      seen.add(postprocessor.id)
      return true
    })
    .toSorted(byOrder)
}

export async function applyScenePostprocessors(
  postprocessors: readonly ScenePostprocessor[],
  context: ScenePostprocessorContext
) {
  for (const postprocessor of postprocessors) {
    await postprocessor.postprocess(context)
  }
}

const engineScenePostprocessorsContract = defineContract({
  scenePostprocessorsValueSpec: defineValueSpec<
    ScenePostprocessor,
    readonly ScenePostprocessor[]
  >({
    name: 'engine-scene.scene-postprocessors',
    defaultValue: [],
    combine: combineScenePostprocessors,
  }),
})

export const { scenePostprocessorsValueSpec } =
  engineScenePostprocessorsContract
