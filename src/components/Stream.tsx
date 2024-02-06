import {
  MouseEventHandler,
  WheelEventHandler,
  useEffect,
  useRef,
  useState,
} from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useStore } from '../useStore'
import { getNormalisedCoordinates, isOverlap, throttle } from '../lib/utils'
import Loading from './Loading'
import { cameraMouseDragGuards } from 'lib/cameraControls'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'
import { CameraDragInteractionType_type } from '@kittycad/lib/dist/types/src/models'
import { Models } from '@kittycad/lib'
import { getNodeFromPath } from 'lang/queryAst'
import { VariableDeclarator, recast, CallExpression } from 'lang/wasm'
import { engineCommandManager } from '../lang/std/engineConnection'
import { useModelingContext } from 'hooks/useModelingContext'
import { kclManager, useKclContext } from 'lang/KclSingleton'
import { changeSketchArguments } from 'lang/std/sketch'
import toast from 'react-hot-toast'
import { DragWarningToast } from './DragWarningToast'

type Point2d = Models['Point2d_type']

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
    if (state.matches('Sketch')) return
    if (state.matches('Sketch no face')) return
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

    if (state.matches('Sketch.Move Tool.No move')) {
      // skip scene commands
    } else if (state.matches('Sketch.Move Tool')) {
      void engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd: {
          type: 'handle_mouse_drag_start',
          window: { x, y },
        },
        cmd_id: newId,
      })
    } else if (!state.matches('Sketch.Line Tool')) {
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

  const fps = 60
  const handleScroll: WheelEventHandler<HTMLVideoElement> = throttle((e) => {
    if (!cameraMouseDragGuards[cameraControls].zoom.scrollCallback(e)) return
    engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd: {
        type: 'default_camera_zoom',
        magnitude: e.deltaY * 0.4,
      },
      cmd_id: uuidv4(),
    })
  }, Math.round(1000 / fps))

  const handleMouseUp: MouseEventHandler<HTMLVideoElement> = ({
    clientX,
    clientY,
    ctrlKey,
  }) => {
    if (!videoRef.current) return
    setButtonDownInStream(undefined)
    if (state.matches('Sketch')) return
    if (state.matches('Sketch no face')) return
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
    } else if (!didDragInStream && state.matches('Sketch.Line Tool')) {
      command.cmd = {
        type: 'mouse_click',
        window: { x, y },
      }
      engineCommandManager.sendSceneCommand(command).then(async (resp) => {
        const entities_modified = resp?.data?.data?.entities_modified
        if (!entities_modified) return
        if (state.matches('Sketch.Line Tool.No Points')) {
          send('Add point')
        } else if (state.matches('Sketch.Line Tool.Point Added')) {
          const curve = await engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: {
              type: 'curve_get_end_points',
              curve_id: entities_modified[0],
            },
          })
          const coords: Models['CurveGetEndPoints_type'] = curve.data.data

          send({
            type: 'Add point',
            data: {
              coords: [coords.start, coords.end],
              axis: null,
              segmentId: entities_modified[0],
            },
          })
        } else if (state.matches('Sketch.Line Tool.Segment Added')) {
          const curveEndpoints = await engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: {
              type: 'curve_get_end_points',
              curve_id: entities_modified[0],
            },
          })
          const coords: { end: Point2d; start: Point2d; center: Point2d } =
            curveEndpoints.data.data
          send({
            type: 'Add point',
            data: {
              coords: [coords.start, coords.end],
              axis: null,
              segmentId: entities_modified[0],
            },
          })
        }
      })
    } else if (
      !didDragInStream &&
      (state.matches('Sketch.SketchIdle') || state.matches('idle'))
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
      if (state.matches('Sketch.Move Tool.No move')) {
        const toastJsx = DragWarningToast(context.moveDescs)
        if (toastJsx) {
          toast.custom(toastJsx, {
            position: 'bottom-center',
            duration: 1000,
            icon: '🔒',
          })
        }
      }
      command.cmd = {
        type: 'handle_mouse_drag_end',
        window: { x, y },
      }
      void engineCommandManager.sendSceneCommand(command)
    } else {
      engineCommandManager.sendSceneCommand(command)
    }

    setDidDragInStream(false)
    setClickCoords(undefined)
  }

  const handleMouseMove: MouseEventHandler<HTMLVideoElement> = (e) => {
    if (state.matches('Sketch')) return
    if (state.matches('Sketch no face')) return
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
