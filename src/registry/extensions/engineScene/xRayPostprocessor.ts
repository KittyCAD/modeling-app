import { signal } from '@preact/signals-core'
import type { Color } from '@rust/kcl-lib/bindings/ModelingCmd'
import type { OpKclValue, Operation } from '@rust/kcl-lib/bindings/Operation'
import { getBodiesFromArtifactGraph } from '@src/lang/std/artifactGraph'
import type { ArtifactGraph } from '@src/lang/wasm'
import { KCL_DEFAULT_COLOR } from '@src/lib/constants'
import { uuidv4 } from '@src/lib/utils'
import type {
  ScenePostprocessor,
  ScenePostprocessorContext,
} from './scenePostprocessors'

const DEFAULT_X_RAY_TRANSPARENCY = 1
const DEFAULT_X_RAY_METALNESS = 0
const DEFAULT_X_RAY_ROUGHNESS = 0.01
const DEFAULT_X_RAY_AMBIENT_OCCLUSION = 0

export const xRayTransparency = signal(DEFAULT_X_RAY_TRANSPARENCY)

const clampTransparency = (value: number) => Math.max(0, Math.min(1, value))

type XRayMaterial = {
  color: Color
  metalness: number
  roughness: number
  ambient_occlusion: number
}

const xRayDefaultMaterial: XRayMaterial = {
  color: parseHexColor(KCL_DEFAULT_COLOR, 1),
  metalness: DEFAULT_X_RAY_METALNESS,
  roughness: DEFAULT_X_RAY_ROUGHNESS,
  ambient_occlusion: DEFAULT_X_RAY_AMBIENT_OCCLUSION,
}

export function getXRayEntityIdsFromArtifactGraph(
  artifactGraph: ArtifactGraph
) {
  return [...getBodiesFromArtifactGraph(artifactGraph).keys()].filter(
    (entityId) => {
      const artifact = artifactGraph.get(entityId)
      return !artifact || !('consumed' in artifact) || !artifact.consumed
    }
  )
}

function parseHexColor(hexColor: string, alpha: number): Color {
  const match =
    /^#(?<red>[0-9a-f]{2})(?<green>[0-9a-f]{2})(?<blue>[0-9a-f]{2})$/i.exec(
      hexColor
    )
  if (!match?.groups) {
    return { ...xRayDefaultMaterial.color, a: alpha }
  }

  return {
    r: Number.parseInt(match.groups.red, 16) / 255,
    g: Number.parseInt(match.groups.green, 16) / 255,
    b: Number.parseInt(match.groups.blue, 16) / 255,
    a: alpha,
  }
}

function getOperationNumberPercent(
  operation: Extract<Operation, { type: 'StdLibCall' }>,
  argName: string,
  fallback: number
) {
  const value = operation.labeledArgs[argName]?.value
  if (value?.type !== 'Number') {
    return fallback
  }

  return value.value / 100
}

function getOperationStringArg(
  operation: Extract<Operation, { type: 'StdLibCall' }>,
  argName: string
) {
  const value = operation.labeledArgs[argName]?.value
  return value?.type === 'String' ? value.value : undefined
}

function getArtifactIdsFromOperationValue(value: OpKclValue): string[] {
  switch (value.type) {
    case 'Solid':
    case 'Sketch':
    case 'Helix':
      return [value.value.artifactId]
    case 'ImportedGeometry':
    case 'Face':
    case 'GdtAnnotation':
    case 'Plane':
    case 'Segment':
      return [value.artifact_id]
    case 'Array':
      return value.value.flatMap(getArtifactIdsFromOperationValue)
    case 'Object':
      return Object.values(value.value).flatMap(
        getArtifactIdsFromOperationValue
      )
    default:
      return []
  }
}

export function getXRayMaterialsFromOperations(
  operations: readonly Operation[]
) {
  const materials = new Map<string, XRayMaterial>()

  for (const operation of operations) {
    if (operation.type !== 'StdLibCall' || operation.name !== 'appearance') {
      continue
    }

    const color = getOperationStringArg(operation, 'color')
    const objectValue = operation.unlabeledArg?.value
    if (!color || !objectValue) {
      continue
    }

    const material: XRayMaterial = {
      color: parseHexColor(
        color,
        getOperationNumberPercent(operation, 'opacity', 1)
      ),
      metalness: getOperationNumberPercent(operation, 'metalness', 0),
      roughness: getOperationNumberPercent(
        operation,
        'roughness',
        DEFAULT_X_RAY_ROUGHNESS
      ),
      ambient_occlusion: DEFAULT_X_RAY_AMBIENT_OCCLUSION,
    }

    for (const artifactId of getArtifactIdsFromOperationValue(objectValue)) {
      materials.set(artifactId, material)
    }
  }

  return materials
}

function getPatternSourceIdsByCopyId(artifactGraph: ArtifactGraph) {
  const sourceIdsByCopyId = new Map<string, string>()

  for (const artifact of artifactGraph.values()) {
    if (artifact.type !== 'pattern') {
      continue
    }

    for (const copyId of artifact.copyIds) {
      sourceIdsByCopyId.set(copyId, artifact.sourceId)
    }
  }

  return sourceIdsByCopyId
}

function getXRayMaterialForEntity({
  entityId,
  artifactGraph,
  materials,
  patternSourceIdsByCopyId,
  visited = new Set<string>(),
}: {
  entityId: string
  artifactGraph: ArtifactGraph
  materials: Map<string, XRayMaterial>
  patternSourceIdsByCopyId: Map<string, string>
  visited?: Set<string>
}): XRayMaterial {
  const material = materials.get(entityId)
  if (material) {
    return material
  }

  if (visited.has(entityId)) {
    return xRayDefaultMaterial
  }
  visited.add(entityId)

  const sourceId = patternSourceIdsByCopyId.get(entityId)
  if (sourceId) {
    return getXRayMaterialForEntity({
      entityId: sourceId,
      artifactGraph,
      materials,
      patternSourceIdsByCopyId,
      visited,
    })
  }

  const artifact = artifactGraph.get(entityId)
  if (artifact?.type === 'compositeSolid') {
    for (const solidId of [...artifact.solidIds, ...artifact.toolIds]) {
      const sourceMaterial = getXRayMaterialForEntity({
        entityId: solidId,
        artifactGraph,
        materials,
        patternSourceIdsByCopyId,
        visited,
      })
      if (sourceMaterial !== xRayDefaultMaterial) {
        return sourceMaterial
      }
    }
  }

  return xRayDefaultMaterial
}

export async function applyXRayTransparencyToScene({
  transparency,
  artifactGraph,
  operations,
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
  const materials = getXRayMaterialsFromOperations(operations)
  const patternSourceIdsByCopyId = getPatternSourceIdsByCopyId(artifactGraph)
  const overrideAlpha = nextTransparency < 1 ? nextTransparency : null
  const materialByEntityId = new Map(
    entityIds.map((entityId) => {
      const material = getXRayMaterialForEntity({
        entityId,
        artifactGraph,
        materials,
        patternSourceIdsByCopyId,
      })
      const alpha = overrideAlpha ?? material.color.a

      return [
        entityId,
        {
          ...material,
          color: {
            ...material.color,
            a: alpha,
          },
        },
      ]
    })
  )

  if (engineCommandManager.settings.enableSSAO) {
    await engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'set_order_independent_transparency',
        enabled: [...materialByEntityId.values()].some(
          (material) => material.color.a < 1
        ),
      },
    })
  }

  const materialResults = await Promise.allSettled(
    [...materialByEntityId.entries()].map(([entityId, material]) =>
      engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'object_set_material_params_pbr',
          object_id: entityId,
          color: material.color,
          metalness: material.metalness,
          roughness: material.roughness,
          ambient_occlusion: material.ambient_occlusion,
        },
      })
    )
  )
  const rejectedMaterialCommand = materialResults.find(
    (result) => result.status === 'rejected'
  )
  if (rejectedMaterialCommand) {
    throw rejectedMaterialCommand.reason
  }
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
