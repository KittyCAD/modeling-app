import {
  MouseEventHandler,
  WheelEventHandler,
  useEffect,
  useRef,
  useState,
} from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useStore } from '../useStore'
import { getNormalisedCoordinates } from '../lib/utils'
import Loading from './Loading'
import { cameraMouseDragGuards } from 'lib/cameraControls'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'
import { CameraDragInteractionType_type } from '@kittycad/lib/dist/types/src/models'
import { Models } from '@kittycad/lib'
import { getNodeFromPath } from 'lang/queryAst'
import { VariableDeclarator, recast, CallExpression } from 'lang/wasm'
import { engineCommandManager } from '../lang/std/engineConnection'
import { useModelingContext } from 'hooks/useModelingContext'
import { kclManager, useKclContext } from 'lang/KclSinglton'
import { changeSketchArguments } from 'lang/std/sketch'

export const Stream = ({ className = '' }) => {
  const [isLoading, setIsLoading] = useState(true)
  const [clickCoords, setClickCoords] = useState<{ x: number; y: number }>()
  const videoRef = useRef<HTMLVideoElement>(null)
  const {
    mediaStream,
    setButtonDownInStream,
    didDragInStream,
    setDidDragInStream,
    streamDimensions,
  } = useStore((s) => ({
    mediaStream: s.mediaStream,
    setButtonDownInStream: s.setButtonDownInStream,
    didDragInStream: s.didDragInStream,
    setDidDragInStream: s.setDidDragInStream,
    streamDimensions: s.streamDimensions,
  }))
  const { settings } = useGlobalStateContext()
  const cameraControls = settings?.context?.cameraControls
  const { send, state, context } = useModelingContext()
  const { isExecuting } = useKclContext()

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof RTCPeerConnection === 'undefined'
    )
      return
    if (!videoRef.current) return
    if (!mediaStream) return
    videoRef.current.srcObject = mediaStream
  }, [mediaStream])

  const handleMouseDown: MouseEventHandler<HTMLVideoElement> = (e) => {
    if (!videoRef.current) return
    const { x, y } = getNormalisedCoordinates({
      clientX: e.clientX,
      clientY: e.clientY,
      el: videoRef.current,
      ...streamDimensions,
    })

    const newId = uuidv4()

    const interactionGuards = cameraMouseDragGuards[cameraControls]
    let interaction: CameraDragInteractionType_type = 'rotate'

    if (
      interactionGuards.pan.callback(e) ||
      interactionGuards.pan.lenientDragStartButton === e.button
    ) {
      interaction = 'pan'
    } else if (
      interactionGuards.rotate.callback(e) ||
      interactionGuards.rotate.lenientDragStartButton === e.button
    ) {
      interaction = 'rotate'
    } else if (
      interactionGuards.zoom.dragCallback(e) ||
      interactionGuards.zoom.lenientDragStartButton === e.button
    ) {
      interaction = 'zoom'
    }

    if (state.matches('Sketch.Move Tool')) {
      if (
        state.matches('Sketch.Move Tool.No move') ||
        state.matches('Sketch.Move Tool.Move with execute')
      ) {
        return
      }
      engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd: {
          type: 'handle_mouse_drag_start',
          window: { x, y },
        },
        cmd_id: newId,
      })
    } else if (
      !state.matches('Sketch.Line Tool') &&
      !state.matches('Sketch.TangentialArc Tool')
    ) {
      engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd: {
          type: 'camera_drag_start',
          interaction,
          window: { x, y },
        },
        cmd_id: newId,
      })
    }

    setButtonDownInStream(e.button)
    setClickCoords({ x, y })
  }

  const handleScroll: WheelEventHandler<HTMLVideoElement> = (e) => {
    if (!cameraMouseDragGuards[cameraControls].zoom.scrollCallback(e)) return

    engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd: {
        type: 'default_camera_zoom',
        magnitude: e.deltaY * 0.4,
      },
      cmd_id: uuidv4(),
    })
  }

  const handleMouseUp: MouseEventHandler<HTMLVideoElement> = ({
    clientX,
    clientY,
    ctrlKey,
  }) => {
    if (!videoRef.current) return
    setButtonDownInStream(undefined)
    const { x, y } = getNormalisedCoordinates({
      clientX,
      clientY,
      el: videoRef.current,
      ...streamDimensions,
    })

    const newCmdId = uuidv4()
    const interaction = ctrlKey ? 'pan' : 'rotate'

    const command: Models['WebSocketRequest_type'] = {
      type: 'modeling_cmd_req',
      cmd: {
        type: 'camera_drag_end',
        interaction,
        window: { x, y },
      },
      cmd_id: newCmdId,
    }

    if (!didDragInStream && state.matches('Sketch no face')) {
      command.cmd = {
        type: 'select_with_point',
        selection_type: 'add',
        selected_at_window: { x, y },
      }
      engineCommandManager.sendSceneCommand(command)
    } else if (
      !didDragInStream &&
      (state.matches('Sketch.Line Tool') ||
        state.matches('Sketch.TangentialArc Tool'))
    ) {
      command.cmd = {
        type: 'mouse_click',
        window: { x, y },
      }
      engineCommandManager.sendSceneCommand(command).then(async (resp) => {
        const entities_modified = resp?.data?.data?.entities_modified
        if (!entities_modified) return
        if (
          state.matches('Sketch.Line Tool.No Points') ||
          state.matches('Sketch.TangentialArc Tool.No Points')
        ) {
          send('Add point')
        } else if (
          state.matches('Sketch.Line Tool.Point Added') ||
          state.matches('Sketch.TangentialArc Tool.Point Added')
        ) {
          const curve = await engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: {
              type: 'curve_get_control_points',
              curve_id: entities_modified[0],
            },
          })
          const coords: { x: number; y: number }[] =
            curve.data.data.control_points
          // We need the normal for the plane we are on.
          const plane = await engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: {
              type: 'get_sketch_mode_plane',
            },
          })
          const z_axis = plane.data.data.z_axis

          // Get the current axis.
          let currentAxis: 'xy' | 'xz' | 'yz' | '-xy' | '-xz' | '-yz' | null =
            null
          if (context.sketchPlaneId === kclManager.getPlaneId('xy')) {
            if (z_axis.z === -1) {
              currentAxis = '-xy'
            } else {
              currentAxis = 'xy'
            }
          } else if (context.sketchPlaneId === kclManager.getPlaneId('yz')) {
            if (z_axis.x === -1) {
              currentAxis = '-yz'
            } else {
              currentAxis = 'yz'
            }
          } else if (context.sketchPlaneId === kclManager.getPlaneId('xz')) {
            if (z_axis.y === -1) {
              currentAxis = '-xz'
            } else {
              currentAxis = 'xz'
            }
          }

          send({
            type: 'Add point',
            data: {
              coords,
              axis: currentAxis,
              segmentId: entities_modified[0],
            },
          })
        } else if (
          state.matches('Sketch.Line Tool.Segment Added') ||
          state.matches('Sketch.TangentialArc Tool.Segment Added')
        ) {
          const curve = await engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: {
              type: 'curve_get_control_points',
              curve_id: entities_modified[0],
            },
          })
          const coords: { x: number; y: number }[] =
            curve.data.data.control_points
          send({
            type: 'Add point',
            data: { coords, axis: null, segmentId: entities_modified[0] },
          })
        }
      })
    } else if (
      !didDragInStream &&
      (state.matches('Sketch.SketchIdle') ||
        state.matches('idle') ||
        state.matches('awaiting selection'))
    ) {
      command.cmd = {
        type: 'select_with_point',
        selected_at_window: { x, y },
        selection_type: 'add',
      }
      engineCommandManager.sendSceneCommand(command)
    } else if (!didDragInStream && state.matches('Sketch.Move Tool')) {
      command.cmd = {
        type: 'select_with_point',
        selected_at_window: { x, y },
        selection_type: 'add',
      }
      engineCommandManager.sendSceneCommand(command)
    } else if (didDragInStream && state.matches('Sketch.Move Tool')) {
      command.cmd = {
        type: 'handle_mouse_drag_end',
        window: { x, y },
      }
      engineCommandManager.sendSceneCommand(command).then(async () => {
        if (!context.sketchPathToNode) return
        getNodeFromPath<VariableDeclarator>(
          kclManager.ast,
          context.sketchPathToNode,
          'VariableDeclarator'
        )
        // Get the current plane string for plane we are on.
        let currentPlaneString = ''
        if (context.sketchPlaneId === kclManager.getPlaneId('xy')) {
          currentPlaneString = 'XY'
        } else if (context.sketchPlaneId === kclManager.getPlaneId('yz')) {
          currentPlaneString = 'YZ'
        } else if (context.sketchPlaneId === kclManager.getPlaneId('xz')) {
          currentPlaneString = 'XZ'
        }

        // Do not supporting editing/moving lines on a non-default plane.
        // Eventually we can support this but for now we will just throw an
        // error.
        if (currentPlaneString === '') return

        const pathInfo = await engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'path_get_info',
            path_id: context.sketchEnginePathId,
          },
        })
        const segmentsWithMappings = (
          pathInfo?.data?.data?.segments as { command_id: string }[]
        )
          .filter(({ command_id }) => {
            return command_id && engineCommandManager.artifactMap[command_id]
          })
          .map(({ command_id }) => command_id)
        const segment2dInfo = await Promise.all(
          segmentsWithMappings.map(async (segmentId) => {
            const response = await engineCommandManager.sendSceneCommand({
              type: 'modeling_cmd_req',
              cmd_id: uuidv4(),
              cmd: {
                type: 'curve_get_control_points',
                curve_id: segmentId,
              },
            })
            const controlPoints: [
              { x: number; y: number },
              { x: number; y: number }
            ] = response.data.data.control_points
            return {
              controlPoints,
              segmentId,
            }
          })
        )

        let modifiedAst = { ...kclManager.ast }
        let code = kclManager.code
        for (const controlPoint of segment2dInfo) {
          const range =
            engineCommandManager.artifactMap[controlPoint.segmentId].range
          if (!range) continue
          const from = controlPoint.controlPoints[0]
          const to = controlPoint.controlPoints[1]
          const modded = changeSketchArguments(
            modifiedAst,
            kclManager.programMemory,
            range,
            [to.x, to.y],
            [from.x, from.y]
          )
          modifiedAst = modded.modifiedAst

          // update artifact map ranges now that we have updated the ast.
          code = recast(modded.modifiedAst)
          const astWithCurrentRanges = kclManager.safeParse(code)
          if (!astWithCurrentRanges) return
          const updateNode = getNodeFromPath<CallExpression>(
            astWithCurrentRanges,
            modded.pathToNode
          ).node
          engineCommandManager.artifactMap[controlPoint.segmentId].range = [
            updateNode.start,
            updateNode.end,
          ]
        }

        kclManager.executeAstMock(modifiedAst, true)
      })
    } else {
      engineCommandManager.sendSceneCommand(command)
    }

    setDidDragInStream(false)
    setClickCoords(undefined)
  }

  const handleMouseMove: MouseEventHandler<HTMLVideoElement> = (e) => {
    if (!clickCoords) return

    const delta =
      ((clickCoords.x - e.clientX) ** 2 + (clickCoords.y - e.clientY) ** 2) **
      0.5

    if (delta > 5 && !didDragInStream) {
      setDidDragInStream(true)
    }
  }

  return (
    <div id="stream" className={className}>
      <video
        ref={videoRef}
        muted
        autoPlay
        controls={false}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onContextMenu={(e) => e.preventDefault()}
        onContextMenuCapture={(e) => e.preventDefault()}
        onWheel={handleScroll}
        onPlay={() => setIsLoading(false)}
        onMouseMoveCapture={handleMouseMove}
        className={`w-full cursor-pointer h-full ${isExecuting && 'blur-md'}`}
        disablePictureInPicture
        style={{ transitionDuration: '200ms', transitionProperty: 'filter' }}
      />
      {isLoading && (
        <div className="text-center absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <Loading>
            <span data-testid="loading-stream">Loading stream...</span>
          </Loading>
        </div>
      )}
    </div>
  )
}
