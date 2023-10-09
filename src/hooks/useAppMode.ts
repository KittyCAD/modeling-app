// needed somewhere to dump this logic,
// Once we have xState this should be removed

import { useStore, Selections } from 'useStore'
import { useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { ArtifactMap, EngineCommandManager } from 'lang/std/engineConnection'
import { Models } from '@kittycad/lib/dist/types/src'
import { isReducedMotion } from 'lang/util'
import { isOverlap } from 'lib/utils'
import { engineCommandManager } from '../lang/std/engineConnection'
import { useModelingContext } from './useModelingContext'
import { kclManager } from 'lang/KclSinglton'

export function useAppMode() {
  const { guiMode, setGuiMode } = useStore((s) => ({
    guiMode: s.guiMode,
    setGuiMode: s.setGuiMode,
  }))
  const { context } = useModelingContext()
  useEffect(() => {
    if (
      guiMode.mode === 'sketch' &&
      guiMode.sketchMode === 'selectFace' &&
      engineCommandManager
    ) {
      kclManager.showPlanes()
    }
    if (
      guiMode.mode === 'sketch' &&
      guiMode.sketchMode === 'enterSketchEdit' &&
      engineCommandManager
    ) {
      const enableSketchMode = async () => {
        kclManager.hidePlanes()

        await engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'sketch_mode_enable',
            plane_id: context.sketchPlaneId,
            ortho: true,
            animated: !isReducedMotion(),
          },
        })
        const proms: any[] = []
        proms.push(
          engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: {
              type: 'edit_mode_enter',
              target: guiMode.pathId,
            },
          })
        )
        await Promise.all(proms)
      }
      enableSketchMode()
      setGuiMode({
        ...guiMode,
        sketchMode: 'sketchEdit',
      })
    }
    if (guiMode.mode !== 'sketch') {
      kclManager.hidePlanes()
    }
    if (guiMode.mode === 'default') {
      const pathId =
        engineCommandManager &&
        isCursorInSketchCommandRange(
          engineCommandManager.artifactMap,
          context.selectionRanges
        )
      if (pathId) {
        setGuiMode({
          mode: 'canEditSketch',
          rotation: [0, 0, 0, 1],
          position: [0, 0, 0],
          pathToNode: [],
          pathId,
        })
      }
    } else if (guiMode.mode === 'canEditSketch') {
      if (
        !engineCommandManager ||
        !isCursorInSketchCommandRange(
          engineCommandManager.artifactMap,
          context.selectionRanges
        )
      ) {
        setGuiMode({
          mode: 'default',
        })
      }
    }
  }, [guiMode, guiMode.mode, engineCommandManager, context.selectionRanges])

  useEffect(() => {
    const unSub = engineCommandManager.subscribeTo({
      event: 'select_with_point',
      callback: async ({ data }) => {
        if (!data.entity_id) return
        if (kclManager.defaultPlanes.xy === '') return
        if (
          !Object.values(kclManager.defaultPlanes || {}).includes(
            data.entity_id
          )
        ) {
          // user clicked something else in the scene
          return
        }

        console.log('plane id', data.entity_id)

        // TODO: Right here we want to set the context.sketchPlaneId to data.entity_id
        const sketchModeResponse = await engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'sketch_mode_enable',
            plane_id: data.entity_id,
            ortho: true,
            animated: !isReducedMotion(),
          },
        })
        kclManager.hidePlanes()
        const sketchUuid = uuidv4()
        const proms: any[] = []
        proms.push(
          engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: sketchUuid,
            cmd: {
              type: 'start_path',
            },
          })
        )
        proms.push(
          engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: {
              type: 'edit_mode_enter',
              target: sketchUuid,
            },
          })
        )
        await Promise.all(proms)
        setGuiMode({
          mode: 'sketch',
          sketchMode: 'sketchEdit',
          rotation: [0, 0, 0, 1],
          position: [0, 0, 0],
          pathToNode: [],
          pathId: sketchUuid,
        })

        console.log('sketchModeResponse', sketchModeResponse)
      },
    })
    return unSub
  }, [engineCommandManager])
}

async function createPlane(
  engineCommandManager: EngineCommandManager,
  {
    x_axis,
    y_axis,
    color,
    hidden,
  }: {
    x_axis: Models['Point3d_type']
    y_axis: Models['Point3d_type']
    color: Models['Color_type']
    hidden: boolean
  }
) {
  const planeId = uuidv4()
  await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd: {
      type: 'make_plane',
      size: 60,
      origin: { x: 0, y: 0, z: 0 },
      x_axis,
      y_axis,
      clobber: false,
      hide: hidden,
    },
    cmd_id: planeId,
  })
  await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd: {
      type: 'plane_set_color',
      plane_id: planeId,
      color,
    },
    cmd_id: uuidv4(),
  })
  return planeId
}

export function setDefaultPlanesHidden(
  engineCommandManager: EngineCommandManager,
  defaultPlanes: DefaultPlanes,
  hidden: boolean
) {
  Object.values(defaultPlanes).forEach((planeId) => {
    hidePlane(engineCommandManager, planeId, hidden)
  })
}

function hidePlane(
  engineCommandManager: EngineCommandManager,
  planeId: string,
  hidden: boolean
) {
  engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'object_visible',
      object_id: planeId,
      hidden: hidden,
    },
  })
}

export async function initDefaultPlanes(
  engineCommandManager: EngineCommandManager,
  hidePlanes?: boolean
): Promise<DefaultPlanes | null> {
  if (!engineCommandManager.engineConnection?.isReady()) {
    return null
  }
  const xy = await createPlane(engineCommandManager, {
    x_axis: { x: 1, y: 0, z: 0 },
    y_axis: { x: 0, y: 1, z: 0 },
    color: { r: 0.7, g: 0.28, b: 0.28, a: 0.4 },
    hidden: hidePlanes ? true : false,
  })
  if (hidePlanes) {
    hidePlane(engineCommandManager, xy, true)
  }
  const yz = await createPlane(engineCommandManager, {
    x_axis: { x: 0, y: 1, z: 0 },
    y_axis: { x: 0, y: 0, z: 1 },
    color: { r: 0.28, g: 0.7, b: 0.28, a: 0.4 },
    hidden: hidePlanes ? true : false,
  })
  if (hidePlanes) {
    hidePlane(engineCommandManager, yz, true)
  }
  const xz = await createPlane(engineCommandManager, {
    x_axis: { x: 1, y: 0, z: 0 },
    y_axis: { x: 0, y: 0, z: 1 },
    color: { r: 0.28, g: 0.28, b: 0.7, a: 0.4 },
    hidden: hidePlanes ? true : false,
  })
  return { xy, yz, xz }
}

export function isCursorInSketchCommandRange(
  artifactMap: ArtifactMap,
  selectionRanges: Selections
): string | false {
  const overlapingEntries = Object.entries(artifactMap || {}).filter(
    ([id, artifact]) =>
      selectionRanges.codeBasedSelections.some(
        (selection) =>
          Array.isArray(selection?.range) &&
          Array.isArray(artifact?.range) &&
          isOverlap(selection.range, artifact.range) &&
          (artifact.commandType === 'start_path' ||
            artifact.commandType === 'extend_path' ||
            artifact.commandType === 'close_path')
      )
  )
  return overlapingEntries.length && overlapingEntries[0][1].parentId
    ? overlapingEntries[0][1].parentId
    : overlapingEntries.find(
        ([, artifact]) => artifact.commandType === 'start_path'
      )?.[0] || false
}
