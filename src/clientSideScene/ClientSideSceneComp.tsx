import { useRef, useEffect, useState } from 'react'
import { useModelingContext } from 'hooks/useModelingContext'

import { cameraMouseDragGuards } from 'lib/cameraControls'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { ToolTip } from 'useStore'
import { ARROWHEAD, DEBUG_SHOW_BOTH_SCENES } from './sceneInfra'
import { ReactCameraProperties } from './CameraControls'
import { throttle } from 'lib/utils'
import { sceneInfra, kclManager } from 'lib/singletons'
import {
  EXTRA_SEGMENT_HANDLE,
  PROFILE_START,
  getParentGroup,
} from './sceneEntities'
import { SegmentOverlay } from 'machines/modelingMachine'
import { ConstrainInfo, getConstraintInfo } from 'lang/std/sketchcombos'
import { getNodeFromPath } from 'lang/queryAst'
import { CallExpression } from 'lang/wasm'
import { CustomIcon, CustomIconName } from 'components/CustomIcon'

function useShouldHideScene(): { hideClient: boolean; hideServer: boolean } {
  const [isCamMoving, setIsCamMoving] = useState(false)
  const [isTween, setIsTween] = useState(false)

  const { state } = useModelingContext()

  useEffect(() => {
    sceneInfra.camControls.setIsCamMovingCallback((isMoving, isTween) => {
      setIsCamMoving(isMoving)
      setIsTween(isTween)
    })
  }, [])

  if (DEBUG_SHOW_BOTH_SCENES || !isCamMoving)
    return { hideClient: false, hideServer: false }
  let hideServer = state.matches('Sketch')
  if (isTween) {
    hideServer = false
  }

  return { hideClient: !hideServer, hideServer }
}

export const ClientSideScene = ({
  cameraControls,
}: {
  cameraControls: ReturnType<
    typeof useSettingsAuthContext
  >['settings']['context']['modeling']['mouseControls']['current']
}) => {
  const canvasRef = useRef<HTMLDivElement>(null)
  const { state, send, context } = useModelingContext()
  const { hideClient, hideServer } = useShouldHideScene()

  // Listen for changes to the camera controls setting
  // and update the client-side scene's controls accordingly.
  useEffect(() => {
    sceneInfra.camControls.interactionGuards =
      cameraMouseDragGuards[cameraControls]
  }, [cameraControls])
  useEffect(() => {
    sceneInfra.updateOtherSelectionColors(
      state?.context?.selectionRanges?.otherSelections || []
    )
  }, [state?.context?.selectionRanges?.otherSelections])

  useEffect(() => {
    if (!canvasRef.current) return
    const canvas = canvasRef.current
    canvas.appendChild(sceneInfra.renderer.domElement)
    sceneInfra.animate()
    canvas.addEventListener('mousemove', sceneInfra.onMouseMove, false)
    canvas.addEventListener('mousedown', sceneInfra.onMouseDown, false)
    canvas.addEventListener('mouseup', sceneInfra.onMouseUp, false)
    sceneInfra.setSend(send)
    return () => {
      canvas?.removeEventListener('mousemove', sceneInfra.onMouseMove)
      canvas?.removeEventListener('mousedown', sceneInfra.onMouseDown)
      canvas?.removeEventListener('mouseup', sceneInfra.onMouseUp)
    }
  }, [])

  let cursor = 'default'
  if (state.matches('Sketch')) {
    if (
      context.mouseState.type === 'isHovering' &&
      getParentGroup(context.mouseState.on, [
        ARROWHEAD,
        EXTRA_SEGMENT_HANDLE,
        PROFILE_START,
      ])
    ) {
      cursor = 'move'
    } else if (context.mouseState.type === 'isDragging') {
      cursor = 'grabbing'
    } else if (
      state.matches('Sketch.Line tool') ||
      state.matches('Sketch.Tangential arc to')
    ) {
      cursor = 'crosshair'
    } else {
      cursor = 'default'
    }
  }

  return (
    <>
      <div
        ref={canvasRef}
        style={{ cursor: cursor }}
        className={`absolute inset-0 h-full w-full transition-all duration-300 ${
          hideClient ? 'opacity-0' : 'opacity-100'
        } ${hideServer ? 'bg-black' : ''} ${
          !hideClient && !hideServer && state.matches('Sketch')
            ? 'bg-black/80'
            : ''
        }`}
      ></div>
      <Overlays />
    </>
  )
}

const Overlays = () => {
  const { context } = useModelingContext()
  return (
    <div className="absolute inset-0 pointer-events-none">
      {Object.entries(context.segmentOverlays).map(
        ([pathToNodeString, overlay]) => {
          return <Overlay overlay={overlay} key={pathToNodeString} />
        }
      )}
    </div>
  )
}

const Overlay = ({ overlay }: { overlay: SegmentOverlay }) => {
  const { context } = useModelingContext()
  if (context.mouseState.type === 'isDragging') return null

  let xAlignment = overlay.angle < 0 ? '0%' : '-100%'
  let yAlignment = overlay.angle < -90 || overlay.angle >= 90 ? '0%' : '-100%'

  const callExpression = getNodeFromPath<CallExpression>(
    kclManager.ast,
    overlay.pathToNode,
    'CallExpression'
  ).node
  const firstArg = callExpression.arguments?.[0]
  const firstArgValues =
    firstArg.type === 'ArrayExpression' ? firstArg.elements : (firstArg as any)
  const constraints = getConstraintInfo(
    firstArgValues,
    callExpression.callee.name as ToolTip
  )

  const offset = 20 // px
  // We could put a boolean in settings that
  const offsetAngle = 90

  const xOffset =
    Math.cos(((overlay.angle + offsetAngle) * Math.PI) / 180) * offset
  const yOffset =
    Math.sin(((overlay.angle + offsetAngle) * Math.PI) / 180) * offset

  return (
    <div className={`absolute w-0 h-0`}>
      <div
        className="px-0 pointer-events-auto absolute flex gap-1"
        style={{
          transform: `translate3d(calc(${
            overlay.windowCoords[0] + xOffset
          }px + ${xAlignment}), calc(${
            overlay.windowCoords[1] - yOffset
          }px + ${yAlignment}), 0)`,
        }}
      >
        {constraints &&
          constraints.map((y, i) => (
            <ConstraintSymbol constrainInfo={y} key={i} />
          ))}
        <span className="bg-gray-50/80 text-black border-2 border-gray-400 h-[20px] w-[20px] rounded-sm">
          <CustomIcon name={'three-dots'} />
        </span>
      </div>
    </div>
  )
}

const ConstraintSymbol = ({
  constrainInfo: { type: _type, isConstrained },
}: {
  constrainInfo: ConstrainInfo
}) => {
  let name: CustomIconName = 'dimension'
  if (
    _type === 'horizontal' ||
    _type === 'vertical' ||
    _type === 'yAbsolute' ||
    _type === 'yRelative' ||
    _type === 'angle' ||
    _type === 'xAbsolute' ||
    _type === 'xRelative'
  )
    name = _type
  else if (_type === 'length') name = 'dimension'
  return (
    <span
      className={`${
        isConstrained
          ? 'bg-gray-50/80 text-black border-2 border-gray-400'
          : 'bg-blue-700/40 text-blue-700'
      } h-[20px] w-[20px] rounded-sm`}
    >
      <CustomIcon name={name} />
    </span>
  )
}

const throttled = throttle((a: ReactCameraProperties) => {
  if (a.type === 'perspective' && a.fov) {
    sceneInfra.camControls.dollyZoom(a.fov)
  }
}, 1000 / 15)

export const CamDebugSettings = () => {
  const [camSettings, setCamSettings] = useState<ReactCameraProperties>(
    sceneInfra.camControls.reactCameraProperties
  )
  const [fov, setFov] = useState(12)

  useEffect(() => {
    sceneInfra.camControls.setReactCameraPropertiesCallback(setCamSettings)
  }, [sceneInfra])
  useEffect(() => {
    if (camSettings.type === 'perspective' && camSettings.fov) {
      setFov(camSettings.fov)
    }
  }, [(camSettings as any)?.fov])

  return (
    <div>
      <h3>cam settings</h3>
      perspective cam
      <input
        type="checkbox"
        checked={camSettings.type === 'perspective'}
        onChange={(e) => {
          if (camSettings.type === 'perspective') {
            sceneInfra.camControls.useOrthographicCamera()
          } else {
            sceneInfra.camControls.usePerspectiveCamera()
          }
        }}
      />
      {camSettings.type === 'perspective' && (
        <input
          type="range"
          min="4"
          max="90"
          step={0.5}
          value={fov}
          onChange={(e) => {
            setFov(parseFloat(e.target.value))

            throttled({
              ...camSettings,
              fov: parseFloat(e.target.value),
            })
          }}
          className="w-full cursor-pointer pointer-events-auto"
        />
      )}
      {camSettings.type === 'perspective' && (
        <div>
          <span>fov</span>
          <input
            type="number"
            value={camSettings.fov}
            className="text-black w-16"
            onChange={(e) => {
              sceneInfra.camControls.setCam({
                ...camSettings,
                fov: parseFloat(e.target.value),
              })
            }}
          />
        </div>
      )}
      {camSettings.type === 'orthographic' && (
        <>
          <div>
            <span>fov</span>
            <input
              type="number"
              value={camSettings.zoom}
              className="text-black w-16"
              onChange={(e) => {
                sceneInfra.camControls.setCam({
                  ...camSettings,
                  zoom: parseFloat(e.target.value),
                })
              }}
            />
          </div>
        </>
      )}
      <div>
        Position
        <ul className="flex">
          <li>
            <span className="pl-2 pr-1">x:</span>
            <input
              type="number"
              step={5}
              data-testid="cam-x-position"
              value={camSettings.position[0]}
              className="text-black w-16"
              onChange={(e) => {
                sceneInfra.camControls.setCam({
                  ...camSettings,
                  position: [
                    parseFloat(e.target.value),
                    camSettings.position[1],
                    camSettings.position[2],
                  ],
                })
              }}
            />
          </li>
          <li>
            <span className="pl-2 pr-1">y:</span>
            <input
              type="number"
              step={5}
              data-testid="cam-y-position"
              value={camSettings.position[1]}
              className="text-black w-16"
              onChange={(e) => {
                sceneInfra.camControls.setCam({
                  ...camSettings,
                  position: [
                    camSettings.position[0],
                    parseFloat(e.target.value),
                    camSettings.position[2],
                  ],
                })
              }}
            />
          </li>
          <li>
            <span className="pl-2 pr-1">z:</span>
            <input
              type="number"
              step={5}
              data-testid="cam-z-position"
              value={camSettings.position[2]}
              className="text-black w-16"
              onChange={(e) => {
                sceneInfra.camControls.setCam({
                  ...camSettings,
                  position: [
                    camSettings.position[0],
                    camSettings.position[1],
                    parseFloat(e.target.value),
                  ],
                })
              }}
            />
          </li>
        </ul>
      </div>
    </div>
  )
}
