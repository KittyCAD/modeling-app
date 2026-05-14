import { signal } from '@preact/signals-core'
import { getBodiesFromArtifactGraph } from '@src/lang/std/artifactGraph'
import type { EngineCommand } from '@src/lang/std/artifactGraph'
import type { ArtifactGraph } from '@src/lang/wasm'
import { uuidv4 } from '@src/lib/utils'
import type {
  ScenePostprocessor,
  ScenePostprocessorContext,
} from './scenePostprocessors'

const DEFAULT_X_RAY_TRANSPARENCY = 1

export const xRayTransparency = signal(DEFAULT_X_RAY_TRANSPARENCY)

const clampTransparency = (value: number) => Math.max(0, Math.min(1, value))

export function getXRayEntityIdsFromArtifactGraph(
  artifactGraph: ArtifactGraph
) {
  const entityIds = new Set<string>(
    getBodiesFromArtifactGraph(artifactGraph).keys()
  )

  for (const artifact of artifactGraph.values()) {
    switch (artifact.type) {
      case 'sweep':
      case 'helix':
        entityIds.add(artifact.id)
        break
      case 'compositeSolid':
        entityIds.add(artifact.id)
        for (const id of artifact.solidIds) {
          entityIds.add(id)
        }
        for (const id of artifact.toolIds) {
          entityIds.add(id)
        }
        break
      case 'pattern':
        entityIds.add(artifact.sourceId)
        for (const id of artifact.copyIds) {
          entityIds.add(id)
        }
        break
    }
  }

  return [...entityIds]
}

export async function applyXRayTransparencyToScene({
  transparency,
  artifactGraph,
  engineCommandManager,
  force = false,
}: ScenePostprocessorContext & {
  transparency: number
  force?: boolean
}) {
  const nextTransparency = clampTransparency(transparency)
  if (!force && nextTransparency >= 1) {
    return
  }

  const entityIds = getXRayEntityIdsFromArtifactGraph(artifactGraph)
  if (entityIds.length === 0) {
    return
  }

  if (engineCommandManager.settings.enableSSAO) {
    await engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'set_order_independent_transparency',
        enabled: nextTransparency < 1,
      },
    })
  }

  const materialCommand: EngineCommand = {
    type: 'modeling_cmd_batch_req',
    batch_id: uuidv4(),
    responses: false,
    requests: entityIds.map((entityId) => ({
      cmd_id: uuidv4(),
      cmd: {
        type: 'entity_set_opacity',
        entity_id: entityId,
        opacity: nextTransparency,
      },
    })),
  }

  await engineCommandManager.sendSceneCommand(materialCommand)
}

export const xRayOverrideTransparencyPostprocessor: ScenePostprocessor = {
  id: 'engine-scene.x-ray.override-transparency',
  order: 100,
  postprocess: (context) =>
    applyXRayTransparencyToScene({
      ...context,
      transparency: xRayTransparency.value,
    }),
}
