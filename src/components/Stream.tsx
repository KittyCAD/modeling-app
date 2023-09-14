import {
  MouseEventHandler,
  WheelEventHandler,
  useEffect,
  useRef,
  useState,
} from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useStore } from '../useStore'
import { getNormalisedCoordinates, roundOff } from '../lib/utils'
import Loading from './Loading'
import { cameraMouseDragGuards } from 'lib/cameraControls'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'
import { CameraDragInteractionType_type } from '@kittycad/lib/dist/types/src/models'
import { Models } from '@kittycad/lib'
import { addStartSketch } from 'lang/modifyAst'
import {
  addCloseToPipe,
  addNewSketchLn,
  compareVec2Epsilon,
} from 'lang/std/sketch'
import { getNodeFromPath } from 'lang/queryAst'
import { Program, VariableDeclarator } from 'lang/abstractSyntaxTreeTypes'

export const Stream = ({ className = '' }) => {
  const [isLoading, setIsLoading] = useState(true)
  const [clickCoords, setClickCoords] = useState<{ x: number; y: number }>()
  const videoRef = useRef<HTMLVideoElement>(null)
  const {
    mediaStream,
    engineCommandManager,
    setButtonDownInStream,
    didDragInStream,
    setDidDragInStream,
    streamDimensions,
    isExecuting,
    guiMode,
    ast,
    updateAst,
    setGuiMode,
    programMemory,
  } = useStore((s) => ({
    mediaStream: s.mediaStream,
    engineCommandManager: s.engineCommandManager,
    setButtonDownInStream: s.setButtonDownInStream,
    fileId: s.fileId,
    didDragInStream: s.didDragInStream,
    setDidDragInStream: s.setDidDragInStream,
    streamDimensions: s.streamDimensions,
    isExecuting: s.isExecuting,
    guiMode: s.guiMode,
    ast: s.ast,
    updateAst: s.updateAst,
    setGuiMode: s.setGuiMode,
    programMemory: s.programMemory,
  }))
  const {
    settings: {
      context: { cameraControls },
    },
  } = useGlobalStateContext()

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof RTCPeerConnection === 'undefined'
    )
      return
    if (!videoRef.current) return
    if (!mediaStream) return
    videoRef.current.srcObject = mediaStream
  }, [mediaStream, engineCommandManager])

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

    if (guiMode.mode === 'sketch' && guiMode.sketchMode === ('move' as any)) {
      engineCommandManager?.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd: {
          type: 'handle_mouse_drag_start',
          window: { x, y },
        },
        cmd_id: newId,
      })
    } else if (
      !(
        guiMode.mode === 'sketch' &&
        guiMode.sketchMode === ('sketch_line' as any)
      )
    ) {
      engineCommandManager?.sendSceneCommand({
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

    engineCommandManager?.sendSceneCommand({
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

    if (!didDragInStream) {
      engineCommandManager?.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd: {
          type: 'select_with_point',
          selection_type: 'add',
          selected_at_window: { x, y },
        },
        cmd_id: uuidv4(),
      })
    }

    if (!didDragInStream && guiMode.mode === 'default') {
      command.cmd = {
        type: 'select_with_point',
        selection_type: 'add',
        selected_at_window: { x, y },
      }
    } else if (
      (!didDragInStream &&
        guiMode.mode === 'sketch' &&
        ['move', 'select'].includes(guiMode.sketchMode)) ||
      (guiMode.mode === 'sketch' &&
        guiMode.sketchMode === ('sketch_line' as any))
    ) {
      command.cmd = {
        type: 'mouse_click',
        window: { x, y },
      }
    } else if (
      guiMode.mode === 'sketch' &&
      guiMode.sketchMode === ('move' as any)
    ) {
      command.cmd = {
        type: 'handle_mouse_drag_end',
        window: { x, y },
      }
    }
    engineCommandManager?.sendSceneCommand(command).then(async (resp) => {
      if (command?.cmd?.type !== 'mouse_click' || !ast) return
      if (
        !(
          guiMode.mode === 'sketch' &&
          guiMode.sketchMode === ('sketch_line' as any as 'line')
        )
      )
        return

      if (
        resp?.data?.data?.entities_modified?.length &&
        guiMode.waitingFirstClick
      ) {
        const curve = await engineCommandManager?.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'curve_get_control_points',
            curve_id: resp?.data?.data?.entities_modified[0],
          },
        })
        const coords: { x: number; y: number }[] =
          curve.data.data.control_points
        const _addStartSketch = addStartSketch(
          ast,
          [roundOff(coords[0].x), roundOff(coords[0].y)],
          [
            roundOff(coords[1].x - coords[0].x),
            roundOff(coords[1].y - coords[0].y),
          ]
        )
        const _modifiedAst = _addStartSketch.modifiedAst
        const _pathToNode = _addStartSketch.pathToNode

        setGuiMode({
          ...guiMode,
          pathToNode: _pathToNode,
          waitingFirstClick: false,
        })
        updateAst(_modifiedAst)
      } else if (
        resp?.data?.data?.entities_modified?.length &&
        !guiMode.waitingFirstClick
      ) {
        const curve = await engineCommandManager?.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'curve_get_control_points',
            curve_id: resp?.data?.data?.entities_modified[0],
          },
        })
        const coords: { x: number; y: number }[] =
          curve.data.data.control_points

        const { node: varDec } = getNodeFromPath<VariableDeclarator>(
          ast,
          guiMode.pathToNode,
          'VariableDeclarator'
        )
        const variableName = varDec.id.name
        const sketchGroup = programMemory.root[variableName]
        if (!sketchGroup || sketchGroup.type !== 'SketchGroup') return
        const initialCoords = sketchGroup.value[0].from

        const isClose = compareVec2Epsilon(initialCoords, [
          coords[1].x,
          coords[1].y,
        ])

        let _modifiedAst: Program
        if (!isClose) {
          _modifiedAst = addNewSketchLn({
            node: ast,
            programMemory,
            to: [coords[1].x, coords[1].y],
            fnName: 'line',
            pathToNode: guiMode.pathToNode,
          }).modifiedAst
        } else {
          _modifiedAst = addCloseToPipe({
            node: ast,
            programMemory,
            pathToNode: guiMode.pathToNode,
          })
          setGuiMode({
            mode: 'default',
          })
        }
        updateAst(_modifiedAst)
      }
    })
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
        className={`w-full h-full ${isExecuting && 'blur-md'}`}
        style={{ transitionDuration: '200ms', transitionProperty: 'filter' }}
      />
      {isLoading && (
        <div className="text-center absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <Loading>Loading stream...</Loading>
        </div>
      )}
    </div>
  )
}
