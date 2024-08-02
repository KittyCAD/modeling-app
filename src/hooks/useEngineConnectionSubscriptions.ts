import { useEffect } from 'react'
import {
  editorManager,
  engineCommandManager,
  kclManager,
  sceneInfra,
} from 'lib/singletons'
import { useModelingContext } from './useModelingContext'
import { getEventForSelectWithPoint } from 'lib/selections'
import { DefaultPlaneStr, getFaceDetails } from 'clientSideScene/sceneEntities'
import { getNodePathFromSourceRange } from 'lang/queryAst'

export function useEngineConnectionSubscriptions() {
  const { send, context, state } = useModelingContext()

  useEffect(() => {
    if (!engineCommandManager) return

    const unSubHover = engineCommandManager.subscribeToUnreliable({
      // Note this is our hover logic, "highlight_set_entity" is the event that is fired when we hover over an entity
      event: 'highlight_set_entity',
      callback: ({ data }) => {
        if (data?.entity_id) {
          const sourceRange = engineCommandManager.artifactMap?.[data.entity_id]
            ?.range || [0, 0]
          editorManager.setHighlightRange(sourceRange)
        } else if (
          !editorManager.highlightRange ||
          (editorManager.highlightRange[0] !== 0 &&
            editorManager.highlightRange[1] !== 0)
        ) {
          editorManager.setHighlightRange([0, 0])
        }
      },
    })
    const unSubClick = engineCommandManager.subscribeTo({
      event: 'select_with_point',
      callback: async (engineEvent) => {
        const event = await getEventForSelectWithPoint(engineEvent, {
          sketchEnginePathId: context.sketchEnginePathId,
        })
        event && send(event)
      },
    })
    return () => {
      unSubHover()
      unSubClick()
    }
  }, [engineCommandManager, context?.sketchEnginePathId])

  useEffect(() => {
    if (state.matches('Sketch no face')) {
      engineCommandManager.onPlaneSelected(async (planeId) => {
        if (!planeId) return
        if (
          engineCommandManager.defaultPlanes?.xy === planeId ||
          engineCommandManager.defaultPlanes?.xz === planeId ||
          engineCommandManager.defaultPlanes?.yz === planeId ||
          engineCommandManager.defaultPlanes?.negXy === planeId ||
          engineCommandManager.defaultPlanes?.negXz === planeId ||
          engineCommandManager.defaultPlanes?.negYz === planeId
        ) {
          const defaultPlaneStrMap: Record<string, DefaultPlaneStr> = {
            [engineCommandManager.defaultPlanes.xy]: 'XY',
            [engineCommandManager.defaultPlanes.xz]: 'XZ',
            [engineCommandManager.defaultPlanes.yz]: 'YZ',
            [engineCommandManager.defaultPlanes.negXy]: '-XY',
            [engineCommandManager.defaultPlanes.negXz]: '-XZ',
            [engineCommandManager.defaultPlanes.negYz]: '-YZ',
          }
          // TODO can we get this information from rust land when it creates the default planes?
          // maybe returned from make_default_planes (src/wasm-lib/src/wasm.rs)
          let zAxis: [number, number, number] = [0, 0, 1]
          let yAxis: [number, number, number] = [0, 1, 0]

          // get unit vector from camera position to target
          const camVector = sceneInfra.camControls.camera.position
            .clone()
            .sub(sceneInfra.camControls.target)

          if (engineCommandManager.defaultPlanes?.xy === planeId) {
            zAxis = [0, 0, 1]
            yAxis = [0, 1, 0]
            if (camVector.z < 0) {
              zAxis = [0, 0, -1]
              planeId = engineCommandManager.defaultPlanes?.negXy || ''
            }
          } else if (engineCommandManager.defaultPlanes?.yz === planeId) {
            zAxis = [1, 0, 0]
            yAxis = [0, 0, 1]
            if (camVector.x < 0) {
              zAxis = [-1, 0, 0]
              planeId = engineCommandManager.defaultPlanes?.negYz || ''
            }
          } else if (engineCommandManager.defaultPlanes?.xz === planeId) {
            zAxis = [0, 1, 0]
            yAxis = [0, 0, 1]
            planeId = engineCommandManager.defaultPlanes?.negXz || ''
            if (camVector.y < 0) {
              zAxis = [0, -1, 0]
              planeId = engineCommandManager.defaultPlanes?.xz || ''
            }
          }

          sceneInfra.modelingSend({
            type: 'Select default plane',
            data: {
              type: 'defaultPlane',
              planeId: planeId,
              plane: defaultPlaneStrMap[planeId],
              zAxis,
              yAxis,
            },
          })
          return
        }
        const artifact = engineCommandManager.artifactMap[planeId]
        // If we clicked on an extrude wall, we climb up the parent Id
        // to get the sketch profile's face ID. If we clicked on an endcap,
        // we already have it.
        const pathId =
          artifact?.type === 'extrudeWall' || artifact?.type === 'extrudeCap'
            ? artifact.pathId
            : ''

        const path = engineCommandManager.artifactMap?.[pathId || '']
        const extrusionId =
          path?.type === 'startPath' ? path.extrusionIds[0] : ''

        // TODO: We get the first extrusion command ID,
        // which is fine while backend systems only support one extrusion.
        // but we need to more robustly handle resolving to the correct extrusion
        // if there are multiple.
        const extrusions = engineCommandManager.artifactMap?.[extrusionId]

        if (artifact?.type !== 'extrudeCap' && artifact?.type !== 'extrudeWall')
          return

        const faceInfo = await getFaceDetails(planeId)
        if (!faceInfo?.origin || !faceInfo?.z_axis || !faceInfo?.y_axis) return
        const { z_axis, y_axis, origin } = faceInfo
        const sketchPathToNode = getNodePathFromSourceRange(
          kclManager.ast,
          artifact.range
        )

        const extrudePathToNode = extrusions?.range
          ? getNodePathFromSourceRange(kclManager.ast, extrusions.range)
          : []

        sceneInfra.modelingSend({
          type: 'Select default plane',
          data: {
            type: 'extrudeFace',
            zAxis: [z_axis.x, z_axis.y, z_axis.z],
            yAxis: [y_axis.x, y_axis.y, y_axis.z],
            position: [origin.x, origin.y, origin.z].map(
              (num) => num / sceneInfra._baseUnitMultiplier
            ) as [number, number, number],
            sketchPathToNode,
            extrudePathToNode,
            cap: artifact.type === 'extrudeCap' ? artifact.cap : 'none',
            faceId: planeId,
          },
        })
        return
      })
    } else {
      engineCommandManager.onPlaneSelected(() => {})
    }
  }, [state])
}
