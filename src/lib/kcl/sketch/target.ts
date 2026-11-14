import type { EntityReference } from '@kittycad/lib'
import type { ApiObject, SketchCtor } from '@rust/kcl-lib/bindings/FrontendApi'
import type { KclModelSnapshot } from '@src/lib/kcl/modelingTarget'
import {
  getDefaultSketchPlaneData,
  getSketchIdForEngineRegionEntity,
  getPrimitiveSelectionForEntity,
} from '@src/lib/selections'
import { getSketchBlockForArtifact } from '@src/lang/std/artifactGraph'
import { getSketchPlaneDetails } from '@src/lib/scene/sketchPlane'
import { isErr } from '@src/lib/trap'
import type { PlaneName } from '@rust/kcl-lib/bindings/PlaneName'

export interface SketchPlane {
  origin: [number, number, number]
  yAxis: [number, number, number]
  zAxis: [number, number, number]
  entityId: string
}
export interface SketchTarget {
  plane: SketchPlane
  existing?: number
  create?: (objects: ApiObject[]) => SketchCtor | Error
}

/** Resolve existing app entity references before borrowing native sketch mutation state. */
export async function resolveSketchTarget(
  snapshot: KclModelSnapshot,
  reference: EntityReference,
  intent: 'new' | 'edit'
): Promise<SketchTarget | Error> {
  const { scene, execState } = snapshot
  const infra = scene.sceneInfra
  const graph = execState.artifactGraph
  if (intent === 'edit') {
    const id =
      reference.type === 'region'
        ? await getSketchIdForEngineRegionEntity(
            reference.region_id,
            graph,
            scene.commands
          )
        : reference.type === 'solid2d'
          ? reference.solid2d_id
          : reference.type === 'segment'
            ? reference.path_id
            : undefined
    const artifact = id ? graph.get(id) : undefined
    const block =
      artifact?.type === 'sketchBlock'
        ? artifact
        : artifact
          ? getSketchBlockForArtifact(artifact, graph)
          : undefined
    if (!block || typeof block.sketchId !== 'number')
      return new Error('Select an existing sketch to edit.')
    if (block.codeRef.range[2] !== 0)
      return new Error('Open the sketch source file before editing it.')
    const entityId = block.planeId ?? block.pathId ?? block.id
    const info = block.planeInfo
    const plane = info
      ? {
          entityId,
          origin: [
            info.origin.x / infra.baseUnitMultiplier,
            info.origin.y / infra.baseUnitMultiplier,
            info.origin.z / infra.baseUnitMultiplier,
          ] as [number, number, number],
          yAxis: [info.yAxis.x, info.yAxis.y, info.yAxis.z] as [
            number,
            number,
            number,
          ],
          zAxis: [info.zAxis.x, info.zAxis.y, info.zAxis.z] as [
            number,
            number,
            number,
          ],
        }
      : await queryPlane(snapshot, entityId)
    return { existing: block.sketchId, plane }
  }
  const entityId =
    reference.type === 'plane'
      ? reference.plane_id
      : reference.type === 'face'
        ? reference.face_id
        : undefined
  if (!entityId)
    return new Error('Select a plane or planar face to start a sketch.')
  const standard = getDefaultSketchPlaneData(entityId, {
    sceneInfra: infra,
    rustContext: { defaultPlanes: execState.defaultPlanes },
  })
  if (!isErr(standard) && standard)
    return {
      plane: {
        entityId: standard.planeId,
        origin: [0, 0, 0],
        yAxis: standard.yAxis,
        zAxis: standard.zAxis,
      },
      create: () => ({ on: { default: toPlaneName(standard.plane) } }),
    }
  const plane = await queryPlane(snapshot, entityId)
  const primitive =
    reference.type === 'face'
      ? await getPrimitiveSelectionForEntity(entityId, scene.commands, graph)
      : undefined
  return {
    plane,
    create: (objects) => {
      const object = objects.find((object) => object.artifact_id === entityId)
      if (
        !object &&
        primitive?.primitiveType === 'face' &&
        primitive.parentEntityId
      )
        return {
          on: {
            primitiveFace: {
              solidId: primitive.parentEntityId,
              index: primitive.primitiveIndex,
            },
          },
        }
      return object
        ? { on: { object: object.id } }
        : new Error(
            'The selected surface is not represented in the sketch source.'
          )
    },
  }
}
function toPlaneName(name: string): PlaneName {
  return (
    {
      XY: 'xy',
      XZ: 'xz',
      YZ: 'yz',
      '-XY': 'negXy',
      '-XZ': 'negXz',
      '-YZ': 'negYz',
    } as Record<string, PlaneName>
  )[name]
}
async function queryPlane(
  snapshot: KclModelSnapshot,
  entityId: string
): Promise<SketchPlane> {
  const info = await getSketchPlaneDetails(snapshot.scene.commands, entityId)
  const scale = snapshot.scene.sceneInfra.baseUnitMultiplier
  return {
    entityId,
    origin: [
      info.origin.x / scale,
      info.origin.y / scale,
      info.origin.z / scale,
    ],
    yAxis: [info.y_axis.x, info.y_axis.y, info.y_axis.z],
    zAxis: [info.z_axis.x, info.z_axis.y, info.z_axis.z],
  }
}
