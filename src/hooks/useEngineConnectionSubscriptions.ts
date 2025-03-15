import { useEffect, useRef } from 'react'
import {
  editorManager,
  engineCommandManager,
  kclManager,
  sceneInfra,
} from 'lib/singletons'
import { useModelingContext } from './useModelingContext'
import { getEventForSelectWithPoint } from 'lib/selections'
import {
  getCapCodeRef,
  getSweepFromSuspectedSweepSurface,
  getWallCodeRef,
  getCodeRefsByArtifactId,
  getArtifactOfTypes,
  SegmentArtifact,
} from 'lang/std/artifactGraph'
import { err, reportRejection } from 'lib/trap'
import { getFaceDetails } from 'clientSideScene/sceneEntities'
import { DefaultPlaneStr } from 'lib/planes'
import { getNodeFromPath } from 'lang/queryAst'
import { getNodePathFromSourceRange } from 'lang/queryAstNodePathUtils'
import { CallExpression, CallExpressionKw, defaultSourceRange } from 'lang/wasm'
import { EdgeCutInfo, ExtrudeFacePlane } from 'machines/modelingMachine'
import { rustContext } from 'lib/rustContext'

export function useEngineConnectionSubscriptions() {
  const { send, context, state } = useModelingContext()
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    if (!engineCommandManager) return

    const unSubHover = engineCommandManager.subscribeToUnreliable({
      // Note this is our hover logic, "highlight_set_entity" is the event that is fired when we hover over an entity
      event: 'highlight_set_entity',
      callback: ({ data }) => {
        if (data?.entity_id) {
          const codeRefs = getCodeRefsByArtifactId(
            data.entity_id,
            engineCommandManager.artifactGraph
          )
          if (codeRefs) {
            editorManager.setHighlightRange(codeRefs.map(({ range }) => range))
          }
        } else if (
          !editorManager.highlightRange ||
          (editorManager.highlightRange[0][0] !== 0 &&
            editorManager.highlightRange[0][1] !== 0)
        ) {
          editorManager.setHighlightRange([defaultSourceRange()])
        }
      },
    })
    const unSubClick = engineCommandManager.subscribeTo({
      event: 'select_with_point',
      callback: (engineEvent) => {
        ;(async () => {
          if (stateRef.current.matches('Sketch no face')) return
          const event = await getEventForSelectWithPoint(engineEvent)
          event && send(event)
        })().catch(reportRejection)
      },
    })
    return () => {
      unSubHover()
      unSubClick()
    }
  }, [engineCommandManager, context?.sketchEnginePathId])

  useEffect(() => {
    const unSub = engineCommandManager.subscribeTo({
      event: 'select_with_point',
      callback: state.matches('Sketch no face')
        ? ({ data }) => {
            ;(async () => {
              let planeOrFaceId = data.entity_id
              if (!planeOrFaceId) return
              if (
                rustContext.defaultPlanes?.xy === planeOrFaceId ||
                rustContext.defaultPlanes?.xz === planeOrFaceId ||
                rustContext.defaultPlanes?.yz === planeOrFaceId ||
                rustContext.defaultPlanes?.negXy === planeOrFaceId ||
                rustContext.defaultPlanes?.negXz === planeOrFaceId ||
                rustContext.defaultPlanes?.negYz === planeOrFaceId
              ) {
                let planeId = planeOrFaceId
                const defaultPlaneStrMap: Record<string, DefaultPlaneStr> = {
                  [rustContext.defaultPlanes.xy]: 'XY',
                  [rustContext.defaultPlanes.xz]: 'XZ',
                  [rustContext.defaultPlanes.yz]: 'YZ',
                  [rustContext.defaultPlanes.negXy]: '-XY',
                  [rustContext.defaultPlanes.negXz]: '-XZ',
                  [rustContext.defaultPlanes.negYz]: '-YZ',
                }
                // TODO can we get this information from rust land when it creates the default planes?
                // maybe returned from make_default_planes (src/wasm-lib/src/wasm.rs)
                let zAxis: [number, number, number] = [0, 0, 1]
                let yAxis: [number, number, number] = [0, 1, 0]

                // get unit vector from camera position to target
                const camVector = sceneInfra.camControls.camera.position
                  .clone()
                  .sub(sceneInfra.camControls.target)

                if (rustContext.defaultPlanes?.xy === planeId) {
                  zAxis = [0, 0, 1]
                  yAxis = [0, 1, 0]
                  if (camVector.z < 0) {
                    zAxis = [0, 0, -1]
                    planeId = rustContext.defaultPlanes?.negXy || ''
                  }
                } else if (rustContext.defaultPlanes?.yz === planeId) {
                  zAxis = [1, 0, 0]
                  yAxis = [0, 0, 1]
                  if (camVector.x < 0) {
                    zAxis = [-1, 0, 0]
                    planeId = rustContext.defaultPlanes?.negYz || ''
                  }
                } else if (rustContext.defaultPlanes?.xz === planeId) {
                  zAxis = [0, 1, 0]
                  yAxis = [0, 0, 1]
                  planeId = rustContext.defaultPlanes?.negXz || ''
                  if (camVector.y < 0) {
                    zAxis = [0, -1, 0]
                    planeId = rustContext.defaultPlanes?.xz || ''
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
              const artifact =
                engineCommandManager.artifactGraph.get(planeOrFaceId)

              if (artifact?.type === 'plane') {
                const planeInfo = await getFaceDetails(planeOrFaceId)
                sceneInfra.modelingSend({
                  type: 'Select default plane',
                  data: {
                    type: 'offsetPlane',
                    zAxis: [
                      planeInfo.z_axis.x,
                      planeInfo.z_axis.y,
                      planeInfo.z_axis.z,
                    ],
                    yAxis: [
                      planeInfo.y_axis.x,
                      planeInfo.y_axis.y,
                      planeInfo.y_axis.z,
                    ],
                    position: [
                      planeInfo.origin.x,
                      planeInfo.origin.y,
                      planeInfo.origin.z,
                    ].map((num) => num / sceneInfra._baseUnitMultiplier) as [
                      number,
                      number,
                      number
                    ],
                    planeId: planeOrFaceId,
                    pathToNode: artifact.codeRef.pathToNode,
                  },
                })
                return
              }

              // Artifact is likely an extrusion face
              const faceId = planeOrFaceId
              const extrusion = getSweepFromSuspectedSweepSurface(
                faceId,
                engineCommandManager.artifactGraph
              )

              if (
                artifact?.type !== 'cap' &&
                artifact?.type !== 'wall' &&
                !(
                  artifact?.type === 'edgeCut' && artifact.subType === 'chamfer'
                )
              )
                return

              const codeRef =
                artifact.type === 'cap'
                  ? getCapCodeRef(artifact, engineCommandManager.artifactGraph)
                  : artifact.type === 'wall'
                  ? getWallCodeRef(artifact, engineCommandManager.artifactGraph)
                  : artifact.codeRef

              const faceInfo = await getFaceDetails(faceId)
              if (!faceInfo?.origin || !faceInfo?.z_axis || !faceInfo?.y_axis)
                return
              const { z_axis, y_axis, origin } = faceInfo
              const sketchPathToNode = getNodePathFromSourceRange(
                kclManager.ast,
                err(codeRef) ? defaultSourceRange() : codeRef.range
              )

              const getEdgeCutMeta = (): null | EdgeCutInfo => {
                let chamferInfo: {
                  segment: SegmentArtifact
                  type: EdgeCutInfo['subType']
                } | null = null
                if (
                  artifact?.type === 'edgeCut' &&
                  artifact.subType === 'chamfer'
                ) {
                  const consumedArtifact = getArtifactOfTypes(
                    {
                      key: artifact.consumedEdgeId,
                      types: ['segment', 'sweepEdge'],
                    },
                    engineCommandManager.artifactGraph
                  )
                  if (err(consumedArtifact)) return null
                  if (consumedArtifact.type === 'segment') {
                    chamferInfo = {
                      type: 'base',
                      segment: consumedArtifact,
                    }
                  } else {
                    const segment = getArtifactOfTypes(
                      { key: consumedArtifact.segId, types: ['segment'] },
                      engineCommandManager.artifactGraph
                    )
                    if (err(segment)) return null
                    chamferInfo = {
                      type: consumedArtifact.subType,
                      segment,
                    }
                  }
                }
                if (!chamferInfo) return null
                const segmentCallExpr = getNodeFromPath<
                  CallExpression | CallExpressionKw
                >(
                  kclManager.ast,
                  chamferInfo?.segment.codeRef.pathToNode || [],
                  ['CallExpression', 'CallExpressionKw']
                )
                if (err(segmentCallExpr)) return null
                if (
                  segmentCallExpr.node.type !== 'CallExpression' &&
                  segmentCallExpr.node.type !== 'CallExpressionKw'
                )
                  return null
                const sketchNodeArgs =
                  segmentCallExpr.node.type == 'CallExpression'
                    ? segmentCallExpr.node.arguments
                    : segmentCallExpr.node.arguments.map((la) => la.arg)
                const tagDeclarator = sketchNodeArgs.find(
                  ({ type }) => type === 'TagDeclarator'
                )
                if (!tagDeclarator || tagDeclarator.type !== 'TagDeclarator')
                  return null

                return {
                  type: 'edgeCut',
                  subType: chamferInfo.type,
                  tagName: tagDeclarator.value,
                }
              }
              const edgeCutMeta = getEdgeCutMeta()

              const _faceInfo: ExtrudeFacePlane['faceInfo'] = edgeCutMeta
                ? edgeCutMeta
                : artifact.type === 'cap'
                ? {
                    type: 'cap',
                    subType: artifact.subType,
                  }
                : { type: 'wall' }

              const extrudePathToNode = !err(extrusion)
                ? getNodePathFromSourceRange(
                    kclManager.ast,
                    extrusion.codeRef.range
                  )
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
                  faceInfo: _faceInfo,
                  faceId: faceId,
                },
              })
              return
            })().catch(reportRejection)
          }
        : () => {},
    })
    return unSub
  }, [state])
}
