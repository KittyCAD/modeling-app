import { useRef, useEffect, useState, useMemo, Fragment } from 'react'
import { useModelingContext } from 'hooks/useModelingContext'

import { cameraMouseDragGuards } from 'lib/cameraControls'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { ARROWHEAD, DEBUG_SHOW_BOTH_SCENES } from './sceneInfra'
import { ReactCameraProperties } from './CameraControls'
import { throttle } from 'lib/utils'
import {
  sceneInfra,
  kclManager,
  codeManager,
  editorManager,
  sceneEntitiesManager,
  engineCommandManager,
} from 'lib/singletons'
import {
  EXTRA_SEGMENT_HANDLE,
  PROFILE_START,
  getParentGroup,
} from './sceneEntities'
import { SegmentOverlay, SketchDetails } from 'machines/modelingMachine'
import { findUsesOfTagInPipe, getNodeFromPath } from 'lang/queryAst'
import {
  CallExpression,
  PathToNode,
  Program,
  SourceRange,
  Value,
  parse,
  recast,
} from 'lang/wasm'
import { CustomIcon, CustomIconName } from 'components/CustomIcon'
import { ConstrainInfo } from 'lang/std/stdTypes'
import { getConstraintInfo } from 'lang/std/sketch'
import { Dialog, Popover, Transition } from '@headlessui/react'
import { useConvertToVariable } from 'hooks/useToolbarGuards'
import { useKclContext } from 'lang/KclProvider'
import { LineInputsType } from 'lang/std/sketchcombos'
import toast from 'react-hot-toast'
import { InstanceProps, create } from 'react-modal-promise'
import { executeAst } from 'useStore'
import {
  deleteSegmentFromPipeExpression,
  makeRemoveSingleConstraintInput,
  removeSingleConstraintInfo,
} from 'lang/modifyAst'
import { ActionButton } from 'components/ActionButton'

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
        } ${hideServer ? 'bg-[#1C1C1C]' : ''} ${
          !hideClient && !hideServer && state.matches('Sketch')
            ? 'bg-[#1C1C1C]/80'
            : ''
        }`}
      ></div>
      <Overlays />
    </>
  )
}

const Overlays = () => {
  const { context } = useModelingContext()
  if (context.mouseState.type === 'isDragging') return null
  return (
    <div className="absolute inset-0 pointer-events-none">
      {Object.entries(context.segmentOverlays)
        .filter((a) => a[1].visible)
        .map(([pathToNodeString, overlay], index) => {
          return (
            <Overlay
              overlay={overlay}
              key={pathToNodeString}
              pathToNodeString={pathToNodeString}
              overlayIndex={index}
            />
          )
        })}
    </div>
  )
}

const Overlay = ({
  overlay,
  overlayIndex,
  pathToNodeString,
}: {
  overlay: SegmentOverlay
  overlayIndex: number
  pathToNodeString: string
}) => {
  const { context, send, state } = useModelingContext()
  let xAlignment = overlay.angle < 0 ? '0%' : '-100%'
  let yAlignment = overlay.angle < -90 || overlay.angle >= 90 ? '0%' : '-100%'

  const callExpression = getNodeFromPath<CallExpression>(
    kclManager.ast,
    overlay.pathToNode,
    'CallExpression'
  ).node
  const constraints = getConstraintInfo(
    callExpression,
    codeManager.code,
    overlay.pathToNode
  )

  const offset = 20 // px
  // We could put a boolean in settings that
  const offsetAngle = 90

  const xOffset =
    Math.cos(((overlay.angle + offsetAngle) * Math.PI) / 180) * offset
  const yOffset =
    Math.sin(((overlay.angle + offsetAngle) * Math.PI) / 180) * offset

  const shouldShow =
    overlay.visible &&
    typeof context?.segmentHoverMap?.[pathToNodeString] === 'number' &&
    !(
      state.matches('Sketch.Line tool') ||
      state.matches('Sketch.Tangential arc to') ||
      state.matches('Sketch.Rectangle tool')
    )

  return (
    <div className={`absolute w-0 h-0`}>
      <div
        data-testid="segment-overlay"
        data-path-to-node={pathToNodeString}
        data-overlay-index={overlayIndex}
        data-overlay-angle={overlay.angle}
        className="pointer-events-auto absolute w-0 h-0"
        style={{
          transform: `translate3d(${overlay.windowCoords[0]}px, ${overlay.windowCoords[1]}px, 0)`,
        }}
      ></div>
      {shouldShow && (
        <div
          className={`px-0 pointer-events-auto absolute flex gap-1`}
          style={{
            transform: `translate3d(calc(${
              overlay.windowCoords[0] + xOffset
            }px + ${xAlignment}), calc(${
              overlay.windowCoords[1] - yOffset
            }px + ${yAlignment}), 0)`,
          }}
          onMouseEnter={() =>
            send({
              type: 'Set mouse state',
              data: {
                type: 'isHovering',
                on: overlay.group,
              },
            })
          }
          onMouseLeave={() =>
            send({
              type: 'Set mouse state',
              data: { type: 'idle' },
            })
          }
        >
          {constraints &&
            constraints.map((constraintInfo, i) => (
              <ConstraintSymbol
                constrainInfo={constraintInfo}
                key={i}
                verticalPosition={
                  overlay.windowCoords[1] > window.innerHeight / 2
                    ? 'top'
                    : 'bottom'
                }
              />
            ))}
          <SegmentMenu
            verticalPosition={
              overlay.windowCoords[1] > window.innerHeight / 2
                ? 'top'
                : 'bottom'
            }
            pathToNode={overlay.pathToNode}
          />
        </div>
      )}
    </div>
  )
}

type ConfirmModalProps = InstanceProps<boolean, boolean> & { text: string }

export const ConfirmModal = ({
  isOpen,
  onResolve,
  onReject,
  text,
}: ConfirmModalProps) => {
  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-10"
        onClose={() => onResolve(false)}
      >
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-25" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="rounded relative mx-auto px-4 py-8 bg-chalkboard-10 dark:bg-chalkboard-100 border dark:border-chalkboard-70 max-w-xl w-full shadow-lg">
                <div>{text}</div>
                <div className="mt-8 flex justify-between">
                  <ActionButton
                    Element="button"
                    onClick={() => onResolve(true)}
                  >
                    Continue and unconstrain
                  </ActionButton>
                  <ActionButton
                    Element="button"
                    onClick={() => onReject(false)}
                  >
                    Cancel
                  </ActionButton>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}

export const confirmModal = create<ConfirmModalProps, boolean, boolean>(
  ConfirmModal
)

export async function deleteSegment({
  pathToNode,
  sketchDetails,
}: {
  pathToNode: PathToNode
  sketchDetails: SketchDetails | null
}) {
  let modifiedAst: Program = kclManager.ast
  const dependantRanges = findUsesOfTagInPipe(modifiedAst, pathToNode)

  const shouldContinueSegDelete = dependantRanges.length
    ? await confirmModal({
        text: "At least 2 segment rely on the segment you're deleting.\nDo you want to continue and unconstrain these segments?",
        isOpen: true,
      })
    : true

  if (!shouldContinueSegDelete) return
  modifiedAst = deleteSegmentFromPipeExpression(
    dependantRanges,
    modifiedAst,
    kclManager.programMemory,
    codeManager.code,
    pathToNode
  )

  const newCode = recast(modifiedAst)
  modifiedAst = parse(newCode)
  const testExecute = await executeAst({
    ast: modifiedAst,
    useFakeExecutor: true,
    engineCommandManager: engineCommandManager,
  })
  if (testExecute.errors.length) {
    toast.error('Segment tag used outside of current Sketch. Could not delete.')
    return
  }

  if (!sketchDetails) return
  sceneEntitiesManager.updateAstAndRejigSketch(
    sketchDetails.sketchPathToNode,
    modifiedAst,
    sketchDetails.zAxis,
    sketchDetails.yAxis,
    sketchDetails.origin
  )
}

const SegmentMenu = ({
  verticalPosition,
  pathToNode,
}: {
  verticalPosition: 'top' | 'bottom'
  pathToNode: PathToNode
}) => {
  const { send } = useModelingContext()
  const dependantSourceRanges = findUsesOfTagInPipe(kclManager.ast, pathToNode)
  return (
    <Popover className="relative">
      {({ open }) => (
        <>
          <Popover.Button className="bg-white/50 hover:bg-white/80 text-black border-2 border-transparent hover:border-gray-400 h-[26px] w-[26px] rounded-sm p-0 m-0">
            <CustomIcon name={'three-dots'} />
          </Popover.Button>
          <Popover.Panel
            className={`absolute ${
              verticalPosition === 'top' ? 'bottom-full' : 'top-full'
            } z-10`}
          >
            <div className="text-black">
              {/* <button className="hover:bg-white/80 bg-white/50 rounded p-1 text-nowrap">
                Remove segment constraints
              </button> */}
              <button
                className="hover:bg-white/80 bg-white/50 rounded p-1 text-nowrap"
                // disabled={dependantSourceRanges.length > 0}
                title={
                  dependantSourceRanges.length > 0
                    ? `At least ${dependantSourceRanges.length} segment rely on this segment's tag.`
                    : ''
                }
                onClick={() => {
                  send({ type: 'Delete segment', data: pathToNode })
                }}
              >
                Delete Segment
              </button>
            </div>
          </Popover.Panel>
        </>
      )}
    </Popover>
  )
}

const ConstraintSymbol = ({
  constrainInfo: {
    type: _type,
    isConstrained,
    value,
    pathToNode,
    stblidFnName,
    argPosition,
  },
  verticalPosition,
}: {
  constrainInfo: ConstrainInfo
  verticalPosition: 'top' | 'bottom'
}) => {
  const { context, send } = useModelingContext()
  const varNameMap: {
    [key in ConstrainInfo['type']]: {
      varName: string
      displayName: string
      iconName: CustomIconName
      implicitConstraintDesc?: string
    }
  } = {
    xRelative: {
      varName: 'xRel',
      displayName: 'X Relative',
      iconName: 'xRelative',
    },
    xAbsolute: {
      varName: 'xAbs',
      displayName: 'X Absolute',
      iconName: 'xAbsolute',
    },
    yRelative: {
      varName: 'yRel',
      displayName: 'Y Relative',
      iconName: 'yRelative',
    },
    yAbsolute: {
      varName: 'yAbs',
      displayName: 'Y Absolute',
      iconName: 'yAbsolute',
    },
    angle: {
      varName: 'angle',
      displayName: 'Angle',
      iconName: 'angle',
    },
    length: {
      varName: 'len',
      displayName: 'Length',
      iconName: 'dimension',
    },
    intersectionOffset: {
      varName: 'perpDist',
      displayName: 'Intersection Offset',
      iconName: 'intersection-offset',
    },

    // implicit constraints
    vertical: {
      varName: '',
      displayName: '',
      iconName: 'vertical',
      implicitConstraintDesc: 'vertically',
    },
    horizontal: {
      varName: '',
      displayName: '',
      iconName: 'horizontal',
      implicitConstraintDesc: 'horizontally',
    },
    tangentialWithPrevious: {
      varName: '',
      displayName: '',
      iconName: 'tangent',
      implicitConstraintDesc: 'tangential to previous segment',
    },
  }
  const varName =
    _type in varNameMap ? varNameMap[_type as LineInputsType].varName : 'var'
  const name: CustomIconName = varNameMap[_type as LineInputsType].iconName
  const displayName = varNameMap[_type as LineInputsType]?.displayName
  const implicitDesc =
    varNameMap[_type as LineInputsType]?.implicitConstraintDesc
  const { ast } = useKclContext()

  const node = useMemo(
    () => getNodeFromPath<Value>(parse(recast(ast)), pathToNode).node,
    [ast, pathToNode]
  )
  const range: SourceRange = node ? [node.start, node.end] : [0, 0]

  return (
    <div className="relative group">
      <button
        data-testid="constraint-symbol"
        data-is-implicit-constraint={implicitDesc ? 'true' : 'false'}
        data-constraint-type={_type}
        data-is-constrained={isConstrained ? 'true' : 'false'}
        className={`${
          implicitDesc
            ? 'bg-[#1C1C1C]/90 border-transparent border-0 rounded'
            : isConstrained
            ? 'bg-white/50 group-hover:bg-white/80 text-black border-transparent group-hover:border-gray-400 rounded-sm'
            : 'bg-primary/30 text-primary border-transparent group-hover:bg-primary/40 group-hover:border-primary/50 group-hover:brightness-125'
        } h-[26px] w-[26px] rounded-sm relative m-0 p-0`}
        onMouseEnter={() => {
          editorManager.setHighlightRange(range)
        }}
        onMouseLeave={() => {
          editorManager.setHighlightRange([0, 0])
        }}
        // disabled={isConstrained || !convertToVarEnabled}
        // disabled={implicitDesc} TODO why does this change styles that are hard to override?
        onClick={async () => {
          if (!isConstrained) {
            send({
              type: 'Convert to variable',
              data: {
                pathToNode,
                variableName: varName,
              },
            })
          } else if (isConstrained) {
            try {
              const shallowPath = getNodeFromPath<CallExpression>(
                parse(recast(kclManager.ast)),
                pathToNode,
                'CallExpression',
                true
              ).shallowPath
              const input = makeRemoveSingleConstraintInput(
                argPosition,
                shallowPath
              )
              if (!input || !context.sketchDetails) return
              const transform = removeSingleConstraintInfo(
                input,
                kclManager.ast,
                kclManager.programMemory
              )
              if (!transform) return
              const { modifiedAst } = transform
              kclManager.updateAst(modifiedAst, true)
            } catch (e) {
              console.log('error', e)
            }
            toast.success('Constraint removed')
          }
        }}
      >
        <CustomIcon name={name} />
      </button>

      <div
        className={`absolute ${
          verticalPosition === 'top'
            ? 'top-0 -translate-y-full'
            : 'bottom-0 translate-y-full'
        } group-hover:block hidden w-[2px] h-2 translate-x-[12px] bg-white/40`}
      ></div>
      <div
        className={`absolute ${
          verticalPosition === 'top' ? 'top-0' : 'bottom-0'
        } group-hover:block hidden`}
        style={{
          transform: `translate3d(calc(-50% + 13px), ${
            verticalPosition === 'top' ? '-100%' : '100%'
          }, 0)`,
        }}
      >
        <div
          className="bg-gray-800 p-2 px-3 rounded-sm"
          data-testid="constraint-symbol-popover"
        >
          {implicitDesc ? (
            <div className="min-w-48">
              <pre className="inline-block">
                <code className="text-primary">{value}</code>
              </pre>{' '}
              <span>is implicitly constrained {implicitDesc}</span>
            </div>
          ) : (
            <>
              <div className="flex mb-1">
                <span className="text-nowrap">
                  <span className="font-bold">
                    {isConstrained ? 'Constrained' : 'Unconstrained'}
                  </span>
                  <span className="text-white/80 text-sm pl-2">
                    {displayName}
                  </span>
                </span>
              </div>
              <div className="flex mb-1">
                <span className="pr-2 whitespace-nowrap">Set to</span>
                <pre>
                  <code className="text-primary">{value}</code>
                </pre>
              </div>
              <div className="text-sm text-white/70 text-nowrap">
                {isConstrained
                  ? 'Click to unconstrain with raw number'
                  : 'Click to constrain with variable'}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
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
