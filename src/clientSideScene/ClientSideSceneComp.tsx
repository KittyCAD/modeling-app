import { useRef, useEffect, useState, useMemo, Fragment } from 'react'
import { useModelingContext } from 'hooks/useModelingContext'

import { cameraMouseDragGuards } from 'lib/cameraControls'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { ARROWHEAD, DEBUG_SHOW_BOTH_SCENES } from './sceneInfra'
import { ReactCameraProperties } from './CameraControls'
import { throttle, toSync } from 'lib/utils'
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
  CallExpressionKw,
  PathToNode,
  Program,
  Expr,
  parse,
  recast,
  defaultSourceRange,
  resultIsOk,
  topLevelRange,
} from 'lang/wasm'
import { CustomIcon, CustomIconName } from 'components/CustomIcon'
import { ConstrainInfo } from 'lang/std/stdTypes'
import { getConstraintInfo, getConstraintInfoKw } from 'lang/std/sketch'
import { Dialog, Popover, Transition } from '@headlessui/react'
import toast from 'react-hot-toast'
import { InstanceProps, create } from 'react-modal-promise'
import { executeAst } from 'lang/langHelpers'
import {
  deleteSegmentFromPipeExpression,
  removeSingleConstraintInfo,
} from 'lang/modifyAst'
import { ActionButton } from 'components/ActionButton'
import { err, reportRejection, trap } from 'lib/trap'
import { Node } from 'wasm-lib/kcl/bindings/Node'
import { commandBarActor } from 'machines/commandBarMachine'

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
    canvas.appendChild(sceneInfra.labelRenderer.domElement)
    sceneInfra.animate()
    canvas.addEventListener(
      'mousemove',
      toSync(sceneInfra.onMouseMove, reportRejection),
      false
    )
    canvas.addEventListener('mousedown', sceneInfra.onMouseDown, false)
    canvas.addEventListener(
      'mouseup',
      toSync(sceneInfra.onMouseUp, reportRejection),
      false
    )
    sceneInfra.setSend(send)
    engineCommandManager.modelingSend = send
    return () => {
      canvas?.removeEventListener(
        'mousemove',
        toSync(sceneInfra.onMouseMove, reportRejection)
      )
      canvas?.removeEventListener('mousedown', sceneInfra.onMouseDown)
      canvas?.removeEventListener(
        'mouseup',
        toSync(sceneInfra.onMouseUp, reportRejection)
      )
      sceneEntitiesManager.tearDownSketch({ removeAxis: true })
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
      state.matches({ Sketch: 'Line tool' }) ||
      state.matches({ Sketch: 'Tangential arc to' }) ||
      state.matches({ Sketch: 'Rectangle tool' }) ||
      state.matches({ Sketch: 'Circle tool' }) ||
      state.matches({ Sketch: 'Circle three point tool' })
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
        data-testid="client-side-scene"
        className={`absolute inset-0 h-full w-full transition-all duration-300 ${
          hideClient ? 'opacity-0' : 'opacity-100'
        } ${hideServer ? 'bg-chalkboard-10 dark:bg-chalkboard-100' : ''} ${
          !hideClient && !hideServer && state.matches('Sketch')
            ? 'bg-chalkboard-10/80 dark:bg-chalkboard-100/80'
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
  // Set a large zIndex, the overlay for hover dropdown menu on line segments needs to render
  // over the length labels on the line segments
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: '99999999' }}
    >
      {Object.entries(context.segmentOverlays)
        .flatMap((a) =>
          a[1].map((b) => ({ pathToNodeString: a[0], overlay: b }))
        )
        .filter((a) => a.overlay.visible)
        .map(({ pathToNodeString, overlay }, index) => {
          return (
            <Overlay
              overlay={overlay}
              key={pathToNodeString + String(index)}
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

  // It's possible for the pathToNode to request a newer AST node
  // than what's available in the AST at the moment of query.
  // It eventually settles on being updated.
  const _node1 = getNodeFromPath<Node<CallExpression | CallExpressionKw>>(
    kclManager.ast,
    overlay.pathToNode,
    ['CallExpression', 'CallExpressionKw']
  )

  // For that reason, to prevent console noise, we do not use err here.
  if (_node1 instanceof Error) {
    console.warn('ast older than pathToNode, not fatal, eventually settles', '')
    return
  }
  const callExpression = _node1.node

  const constraints =
    callExpression.type === 'CallExpression'
      ? getConstraintInfo(
          callExpression,
          codeManager.code,
          overlay.pathToNode,
          overlay.filterValue
        )
      : getConstraintInfoKw(
          callExpression,
          codeManager.code,
          overlay.pathToNode,
          overlay.filterValue
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
      state.matches({ Sketch: 'Line tool' }) ||
      state.matches({ Sketch: 'Tangential arc to' }) ||
      state.matches({ Sketch: 'Rectangle tool' })
    )
  return (
    <div className={`absolute w-0 h-0`}>
      <div
        data-testid="segment-overlay"
        data-path-to-node={pathToNodeString}
        data-overlay-index={overlayIndex}
        data-overlay-visible={shouldShow}
        data-overlay-angle={overlay.angle}
        className="pointer-events-auto absolute w-0 h-0"
        style={{
          transform: `translate3d(${overlay.windowCoords[0]}px, ${overlay.windowCoords[1]}px, 0)`,
        }}
      ></div>
      {shouldShow && (
        <div
          data-overlay-toolbar-index={overlayIndex}
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
          {/* delete circle is complicated by the fact it's the only segment in the
          pipe expression. Maybe it should delete the entire pipeExpression, however
          this will likely change soon when we implement multi-profile so we'll leave it for now
          issue: https://github.com/KittyCAD/modeling-app/issues/3910
          */}
          {callExpression?.callee?.name !== 'circle' &&
            callExpression?.callee?.name !== 'circleThreePoint' && (
              <SegmentMenu
                verticalPosition={
                  overlay.windowCoords[1] > window.innerHeight / 2
                    ? 'top'
                    : 'bottom'
                }
                pathToNode={overlay.pathToNode}
                stdLibFnName={constraints[0]?.stdLibFnName}
              />
            )}
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
  let modifiedAst: Node<Program> | Error = kclManager.ast
  const dependentRanges = findUsesOfTagInPipe(modifiedAst, pathToNode)

  const shouldContinueSegDelete = dependentRanges.length
    ? await confirmModal({
        text: `At least ${dependentRanges.length} segment rely on the segment you're deleting.\nDo you want to continue and unconstrain these segments?`,
        isOpen: true,
      })
    : true

  if (!shouldContinueSegDelete) return

  modifiedAst = deleteSegmentFromPipeExpression(
    dependentRanges,
    modifiedAst,
    kclManager.variables,
    codeManager.code,
    pathToNode
  )
  if (err(modifiedAst)) return Promise.reject(modifiedAst)

  const newCode = recast(modifiedAst)
  const pResult = parse(newCode)
  if (err(pResult) || !resultIsOk(pResult)) return Promise.reject(pResult)
  modifiedAst = pResult.program

  const testExecute = await executeAst({
    ast: modifiedAst,
    engineCommandManager: engineCommandManager,
    isMock: true,
    usePrevMemory: false,
  })
  if (testExecute.errors.length) {
    toast.error('Segment tag used outside of current Sketch. Could not delete.')
    return
  }

  if (!sketchDetails) return
  await sceneEntitiesManager.updateAstAndRejigSketch(
    pathToNode,
    sketchDetails.sketchNodePaths,
    sketchDetails.planeNodePath,
    modifiedAst,
    sketchDetails.zAxis,
    sketchDetails.yAxis,
    sketchDetails.origin
  )

  // Now 'Set sketchDetails' is called with the modified pathToNode
}

const SegmentMenu = ({
  verticalPosition,
  pathToNode,
  stdLibFnName,
}: {
  verticalPosition: 'top' | 'bottom'
  pathToNode: PathToNode
  stdLibFnName: string
}) => {
  const { send } = useModelingContext()
  const dependentSourceRanges = findUsesOfTagInPipe(kclManager.ast, pathToNode)
  return (
    <Popover className="relative">
      {({ open }) => (
        <>
          <Popover.Button
            data-testid="overlay-menu"
            data-stdlib-fn-name={stdLibFnName}
            className="bg-chalkboard-10 dark:bg-chalkboard-100 border !border-transparent hover:!border-chalkboard-40 dark:hover:!border-chalkboard-70 ui-open:!border-chalkboard-40 dark:ui-open:!border-chalkboard-70 h-[26px] w-[26px] rounded-sm p-0 m-0"
          >
            <CustomIcon name={'three-dots'} />
          </Popover.Button>
          <Popover.Panel
            as="menu"
            className={`absolute ${
              verticalPosition === 'top' ? 'bottom-full' : 'top-full'
            } z-10 w-36 flex flex-col gap-1 divide-y divide-chalkboard-20 dark:divide-chalkboard-70 align-stretch px-0 py-1 bg-chalkboard-10 dark:bg-chalkboard-100 rounded-sm shadow-lg border border-solid border-chalkboard-20/50 dark:border-chalkboard-80/50`}
          >
            <button
              className="!border-transparent rounded-sm text-left p-1 text-nowrap"
              onClick={() => {
                send({ type: 'Constrain remove constraints', data: pathToNode })
              }}
            >
              Remove constraints
            </button>
            <button
              className="!border-transparent rounded-sm text-left p-1 text-nowrap"
              title={
                dependentSourceRanges.length > 0
                  ? `At least ${dependentSourceRanges.length} segment rely on this segment's tag.`
                  : ''
              }
              onClick={() => {
                send({ type: 'Delete segment', data: pathToNode })
              }}
            >
              Delete Segment
            </button>
          </Popover.Panel>
        </>
      )}
    </Popover>
  )
}

const ConstraintSymbol = ({
  constrainInfo: { type: _type, isConstrained, value, pathToNode, argPosition },
  verticalPosition,
}: {
  constrainInfo: ConstrainInfo
  verticalPosition: 'top' | 'bottom'
}) => {
  const { context } = useModelingContext()
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
    radius: {
      varName: 'radius',
      displayName: 'Radius',
      iconName: 'dimension',
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

    // we don't render this one
    intersectionTag: {
      varName: '',
      displayName: '',
      iconName: 'dimension',
    },
  }
  const varName = varNameMap?.[_type]?.varName || 'var'
  const name: CustomIconName = varNameMap[_type].iconName
  const displayName = varNameMap[_type]?.displayName
  const implicitDesc = varNameMap[_type]?.implicitConstraintDesc

  const _node = useMemo(
    () => getNodeFromPath<Expr>(kclManager.ast, pathToNode),
    [kclManager.ast, pathToNode]
  )
  if (err(_node)) return
  const node = _node.node

  const range = node
    ? topLevelRange(node.start, node.end)
    : defaultSourceRange()

  if (_type === 'intersectionTag') return null

  return (
    <div className="relative group">
      <button
        data-testid="constraint-symbol"
        data-is-implicit-constraint={implicitDesc ? 'true' : 'false'}
        data-constraint-type={_type}
        data-is-constrained={isConstrained ? 'true' : 'false'}
        className={`${
          implicitDesc
            ? 'bg-chalkboard-10 dark:bg-chalkboard-100 border-transparent border-0 rounded'
            : isConstrained
            ? 'bg-chalkboard-10 dark:bg-chalkboard-90 dark:hover:bg-chalkboard-80 border-chalkboard-40 dark:border-chalkboard-70 rounded-sm'
            : 'bg-primary/30 dark:bg-primary text-primary dark:text-chalkboard-10 dark:border-transparent group-hover:bg-primary/40 group-hover:border-primary/50 group-hover:brightness-125'
        } h-[26px] w-[26px] rounded-sm relative m-0 p-0`}
        onMouseEnter={() => {
          editorManager.setHighlightRange([range])
        }}
        onMouseLeave={() => {
          editorManager.setHighlightRange([defaultSourceRange()])
        }}
        // disabled={isConstrained || !convertToVarEnabled}
        // disabled={implicitDesc} TODO why does this change styles that are hard to override?
        onClick={toSync(async () => {
          if (!isConstrained) {
            commandBarActor.send({
              type: 'Find and select command',
              data: {
                name: 'Constrain with named value',
                groupId: 'modeling',
                argDefaultValues: {
                  currentValue: {
                    pathToNode,
                    variableName: varName,
                    valueText: value,
                  },
                },
              },
            })
          } else if (isConstrained) {
            try {
              const pResult = parse(recast(kclManager.ast))
              if (trap(pResult) || !resultIsOk(pResult))
                return Promise.reject(pResult)

              const _node1 = getNodeFromPath<CallExpression | CallExpressionKw>(
                pResult.program!,
                pathToNode,
                ['CallExpression', 'CallExpressionKw'],
                true
              )
              if (trap(_node1)) return Promise.reject(_node1)
              const shallowPath = _node1.shallowPath

              if (!context.sketchDetails || !argPosition) return
              const transform = removeSingleConstraintInfo(
                shallowPath,
                argPosition,
                kclManager.ast,
                kclManager.variables
              )

              if (!transform) return
              const { modifiedAst } = transform

              await kclManager.updateAst(modifiedAst, true)

              // Code editor will be updated in the modelingMachine.
              const newCode = recast(modifiedAst)
              if (err(newCode)) return
              await codeManager.updateCodeEditor(newCode)
            } catch (e) {
              console.log('error', e)
            }
            toast.success('Constraint removed')
          }
        }, reportRejection)}
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
          className="bg-chalkboard-10 dark:bg-chalkboard-90 p-2 px-3 rounded-sm border border-solid border-chalkboard-20 dark:border-chalkboard-80 shadow-sm"
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
              <div className="text-sm text-chalkboard-70 dark:text-chalkboard-40 text-nowrap">
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
    sceneInfra.camControls.dollyZoom(a.fov).catch(reportRejection)
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
        onChange={() =>
          commandBarActor.send({
            type: 'Find and select command',
            data: {
              groupId: 'settings',
              name: 'modeling.cameraProjection',
            },
          })
        }
      />
      <div>
        <button
          onClick={() => {
            sceneInfra.camControls.resetCameraPosition().catch(reportRejection)
          }}
        >
          Reset Camera Position
        </button>
      </div>
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
      <div>
        target
        <ul className="flex">
          <li>
            <span className="pl-2 pr-1">x:</span>
            <input
              type="number"
              step={5}
              data-testid="cam-x-target"
              value={camSettings.target[0]}
              className="text-black w-16"
              onChange={(e) => {
                sceneInfra.camControls.setCam({
                  ...camSettings,
                  target: [
                    parseFloat(e.target.value),
                    camSettings.target[1],
                    camSettings.target[2],
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
              data-testid="cam-y-target"
              value={camSettings.target[1]}
              className="text-black w-16"
              onChange={(e) => {
                sceneInfra.camControls.setCam({
                  ...camSettings,
                  target: [
                    camSettings.target[0],
                    parseFloat(e.target.value),
                    camSettings.target[2],
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
              data-testid="cam-z-target"
              value={camSettings.target[2]}
              className="text-black w-16"
              onChange={(e) => {
                sceneInfra.camControls.setCam({
                  ...camSettings,
                  target: [
                    camSettings.target[0],
                    camSettings.target[1],
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
