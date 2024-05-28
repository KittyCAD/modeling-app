import { useMachine } from '@xstate/react'
import React, { createContext, useEffect, useRef } from 'react'
import {
  AnyStateMachine,
  ContextFrom,
  InterpreterFrom,
  Prop,
  StateFrom,
  assign,
} from 'xstate'
import { SetSelections, modelingMachine } from 'machines/modelingMachine'
import { useSetupEngineManager } from 'hooks/useSetupEngineManager'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { isCursorInSketchCommandRange } from 'lang/util'
import {
  kclManager,
  sceneInfra,
  engineCommandManager,
  codeManager,
  editorManager,
  sceneEntitiesManager,
} from 'lib/singletons'
import { applyConstraintHorzVertDistance } from './Toolbar/SetHorzVertDistance'
import {
  angleBetweenInfo,
  applyConstraintAngleBetween,
} from './Toolbar/SetAngleBetween'
import { applyConstraintAngleLength } from './Toolbar/setAngleLength'
import { pathMapToSelections } from 'lang/util'
import { useStore } from 'useStore'
import {
  Selections,
  canExtrudeSelection,
  handleSelectionBatch,
  isSelectionLastLine,
  isSketchPipe,
  updateSelections,
} from 'lib/selections'
import { applyConstraintIntersect } from './Toolbar/Intersect'
import { applyConstraintAbsDistance } from './Toolbar/SetAbsDistance'
import useStateMachineCommands from 'hooks/useStateMachineCommands'
import { modelingMachineConfig } from 'lib/commandBarConfigs/modelingCommandConfig'
import {
  STRAIGHT_SEGMENT,
  TANGENTIAL_ARC_TO_SEGMENT,
  getParentGroup,
  getSketchOrientationDetails,
  getSketchQuaternion,
} from 'clientSideScene/sceneEntities'
import {
  moveValueIntoNewVariablePath,
  sketchOnExtrudedFace,
  startSketchOnDefault,
} from 'lang/modifyAst'
import {
  Program,
  Value,
  VariableDeclaration,
  coreDump,
  parse,
  recast,
} from 'lang/wasm'
import {
  getNodeFromPath,
  getNodePathFromSourceRange,
  isSingleCursorInPipe,
} from 'lang/queryAst'
import { TEST } from 'env'
import { exportFromEngine } from 'lib/exportFromEngine'
import { Models } from '@kittycad/lib/dist/types/src'
import toast from 'react-hot-toast'
import { EditorSelection } from '@uiw/react-codemirror'
import { CoreDumpManager } from 'lib/coredump'
import { useSearchParams } from 'react-router-dom'
import { letEngineAnimateAndSyncCamAfter } from 'clientSideScene/CameraControls'
import { getVarNameModal } from 'hooks/useToolbarGuards'
import useHotkeyWrapper from 'lib/hotkeyWrapper'
import { applyConstraintEqualAngle } from './Toolbar/EqualAngle'

type MachineContext<T extends AnyStateMachine> = {
  state: StateFrom<T>
  context: ContextFrom<T>
  send: Prop<InterpreterFrom<T>, 'send'>
}

export const ModelingMachineContext = createContext(
  {} as MachineContext<typeof modelingMachine>
)

export const ModelingMachineProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const {
    auth,
    settings: {
      context: {
        app: { theme, enableSSAO },
        modeling: { defaultUnit, highlightEdges },
      },
    },
  } = useSettingsAuthContext()
  const token = auth?.context?.token
  const streamRef = useRef<HTMLDivElement>(null)

  let [searchParams] = useSearchParams()
  const pool = searchParams.get('pool')

  useSetupEngineManager(streamRef, token, {
    pool: pool,
    theme: theme.current,
    highlightEdges: highlightEdges.current,
    enableSSAO: enableSSAO.current,
  })
  const { htmlRef } = useStore((s) => ({
    htmlRef: s.htmlRef,
  }))
  const coreDumpManager = new CoreDumpManager(
    engineCommandManager,
    htmlRef,
    token
  )
  useHotkeyWrapper(['meta + shift + .'], () => coreDump(coreDumpManager, true))

  // Settings machine setup
  // const retrievedSettings = useRef(
  // localStorage?.getItem(MODELING_PERSIST_KEY) || '{}'
  // )

  // What should we persist from modeling state? Nothing?
  // const persistedSettings = Object.assign(
  //   settingsMachine.initialState.context,
  //   JSON.parse(retrievedSettings.current) as Partial<
  //     (typeof settingsMachine)['context']
  //   >
  // )

  const [modelingState, modelingSend, modelingActor] = useMachine(
    modelingMachine,
    {
      actions: {
        'sketch exit execute': () => {
          kclManager.executeCode(true)
        },
        'Set mouse state': assign({
          mouseState: (_, event) => event.data,
          segmentHoverMap: ({ mouseState, segmentHoverMap }, event) => {
            if (event.data.type === 'isHovering') {
              const parent = getParentGroup(event.data.on, [
                STRAIGHT_SEGMENT,
                TANGENTIAL_ARC_TO_SEGMENT,
              ])
              const pathToNode = parent?.userData?.pathToNode
              const pathToNodeString = JSON.stringify(pathToNode)
              if (!parent || !pathToNode) return {}
              if (segmentHoverMap[pathToNodeString] !== undefined)
                clearTimeout(segmentHoverMap[JSON.stringify(pathToNode)])
              return {
                ...segmentHoverMap,
                [pathToNodeString]: 0,
              }
            } else if (
              event.data.type === 'idle' &&
              mouseState.type === 'isHovering'
            ) {
              const mouseOnParent = getParentGroup(mouseState.on, [
                STRAIGHT_SEGMENT,
                TANGENTIAL_ARC_TO_SEGMENT,
              ])
              if (!mouseOnParent || !mouseOnParent?.userData?.pathToNode)
                return segmentHoverMap
              const pathToNodeString = JSON.stringify(
                mouseOnParent?.userData?.pathToNode
              )
              const timeoutId = setTimeout(() => {
                sceneInfra.modelingSend({
                  type: 'Set mouse state',
                  data: {
                    type: 'timeoutEnd',
                    pathToNodeString,
                  },
                })
              }, 800) as unknown as number
              return {
                ...segmentHoverMap,
                [pathToNodeString]: timeoutId,
              }
            } else if (event.data.type === 'timeoutEnd') {
              const copy = { ...segmentHoverMap }
              delete copy[event.data.pathToNodeString]
              return copy
            }
            return {}
          },
        }),
        'Set Segment Overlays': assign({
          segmentOverlays: ({ segmentOverlays }, { data }) => {
            if (data.type === 'set-many') return data.overlays
            if (data.type === 'set-one')
              return {
                ...segmentOverlays,
                [data.pathToNodeString]: data.seg,
              }
            if (data.type === 'delete-one') {
              const copy = { ...segmentOverlays }
              delete copy[data.pathToNodeString]
              return copy
            }
            // data.type === 'clear'
            return {}
          },
        }),
        'Set sketchDetails': assign(({ sketchDetails }, event) =>
          sketchDetails
            ? {
                sketchDetails: {
                  ...sketchDetails,
                  sketchPathToNode: event.data,
                },
              }
            : {}
        ),
        'Set selection': assign(({ selectionRanges }, event) => {
          const setSelections = event.data as SetSelections // this was needed for ts after adding 'Set selection' action to on done modal events
          if (!editorManager.editorView) return {}
          const dispatchSelection = (selection?: EditorSelection) => {
            if (!selection) return // TODO less of hack for the below please
            editorManager.lastSelectionEvent = Date.now()
            setTimeout(() => {
              if (editorManager.editorView) {
                editorManager.editorView.dispatch({ selection })
              }
            })
          }
          let selections: Selections = {
            codeBasedSelections: [],
            otherSelections: [],
          }
          if (setSelections.selectionType === 'singleCodeCursor') {
            if (!setSelections.selection && editorManager.isShiftDown) {
            } else if (!setSelections.selection && !editorManager.isShiftDown) {
              selections = {
                codeBasedSelections: [],
                otherSelections: [],
              }
            } else if (setSelections.selection && !editorManager.isShiftDown) {
              selections = {
                codeBasedSelections: [setSelections.selection],
                otherSelections: [],
              }
            } else if (setSelections.selection && editorManager.isShiftDown) {
              selections = {
                codeBasedSelections: [
                  ...selectionRanges.codeBasedSelections,
                  setSelections.selection,
                ],
                otherSelections: selectionRanges.otherSelections,
              }
            }

            const {
              engineEvents,
              codeMirrorSelection,
              updateSceneObjectColors,
            } = handleSelectionBatch({
              selections,
            })
            codeMirrorSelection && dispatchSelection(codeMirrorSelection)
            engineEvents &&
              engineEvents.forEach((event) =>
                engineCommandManager.sendSceneCommand(event)
              )
            updateSceneObjectColors()

            return {
              selectionRanges: selections,
            }
          }

          if (setSelections.selectionType === 'mirrorCodeMirrorSelections') {
            return {
              selectionRanges: setSelections.selection,
            }
          }

          if (setSelections.selectionType === 'otherSelection') {
            if (editorManager.isShiftDown) {
              selections = {
                codeBasedSelections: selectionRanges.codeBasedSelections,
                otherSelections: [setSelections.selection],
              }
            } else {
              selections = {
                codeBasedSelections: [],
                otherSelections: [setSelections.selection],
              }
            }
            const { engineEvents, updateSceneObjectColors } =
              handleSelectionBatch({
                selections,
              })
            engineEvents &&
              engineEvents.forEach((event) =>
                engineCommandManager.sendSceneCommand(event)
              )
            updateSceneObjectColors()
            return {
              selectionRanges: selections,
            }
          }
          if (setSelections.selectionType === 'completeSelection') {
            editorManager.selectRange(setSelections.selection)
            return {
              selectionRanges: setSelections.selection,
            }
          }

          return {}
        }),
        'Engine export': (_, event) => {
          if (event.type !== 'Export' || TEST) return
          const format = {
            ...event.data,
          } as Partial<Models['OutputFormat_type']>

          // Set all the un-configurable defaults here.
          if (format.type === 'gltf') {
            format.presentation = 'pretty'
          }

          if (
            format.type === 'obj' ||
            format.type === 'ply' ||
            format.type === 'step' ||
            format.type === 'stl'
          ) {
            // Set the default coords.
            // In the future we can make this configurable.
            // But for now, its probably best to keep it consistent with the
            // UI.
            format.coords = {
              forward: {
                axis: 'y',
                direction: 'negative',
              },
              up: {
                axis: 'z',
                direction: 'positive',
              },
            }
          }

          if (
            format.type === 'obj' ||
            format.type === 'stl' ||
            format.type === 'ply'
          ) {
            format.units = defaultUnit.current
          }

          if (format.type === 'ply' || format.type === 'stl') {
            format.selection = { type: 'default_scene' }
          }

          exportFromEngine({
            format: format as Models['OutputFormat_type'],
          }).catch((e) => toast.error('Error while exporting', e)) // TODO I think we need to throw the error from engineCommandManager
        },
      },
      guards: {
        'has valid extrude selection': ({ selectionRanges }) => {
          // A user can begin extruding if they either have 1+ faces selected or nothing selected
          // TODO: I believe this guard only allows for extruding a single face at a time
          const isPipe = isSketchPipe(selectionRanges)

          if (
            selectionRanges.codeBasedSelections.length === 0 ||
            isSelectionLastLine(selectionRanges, codeManager.code)
          )
            return true
          if (!isPipe) return false

          return canExtrudeSelection(selectionRanges)
        },
        'Sketch is empty': ({ sketchDetails }) =>
          getNodeFromPath<VariableDeclaration>(
            kclManager.ast,
            sketchDetails?.sketchPathToNode || [],
            'VariableDeclaration'
          )?.node?.declarations?.[0]?.init.type !== 'PipeExpression',
        'Selection is on face': ({ selectionRanges }, { data }) => {
          if (data?.forceNewSketch) return false
          if (!isSingleCursorInPipe(selectionRanges, kclManager.ast))
            return false
          return !!isCursorInSketchCommandRange(
            engineCommandManager.artifactMap,
            selectionRanges
          )
        },
        'Has exportable geometry': () => {
          if (
            kclManager.kclErrors.length === 0 &&
            kclManager.ast.body.length > 0
          )
            return true
          else {
            let errorMessage = 'Unable to Export '
            if (kclManager.kclErrors.length > 0)
              errorMessage += 'due to KCL Errors'
            else if (kclManager.ast.body.length === 0)
              errorMessage += 'due to Empty Scene'
            console.error(errorMessage)
            toast.error(errorMessage)
            return false
          }
        },
      },
      services: {
        'AST-undo-startSketchOn': async ({ sketchDetails }) => {
          if (!sketchDetails) return
          const newAst: Program = JSON.parse(JSON.stringify(kclManager.ast))
          const varDecIndex = sketchDetails.sketchPathToNode[1][0]
          // remove body item at varDecIndex
          newAst.body = newAst.body.filter((_, i) => i !== varDecIndex)
          await kclManager.executeAstMock(newAst)
          sceneInfra.setCallbacks({
            onClick: () => {},
            onDrag: () => {},
          })
        },
        'animate-to-face': async (_, { data }) => {
          if (data.type === 'extrudeFace') {
            const { modifiedAst, pathToNode: pathToNewSketchNode } =
              sketchOnExtrudedFace(
                kclManager.ast,
                data.extrudeSegmentPathToNode,
                kclManager.programMemory,
                data.cap
              )
            await kclManager.executeAstMock(modifiedAst)

            await letEngineAnimateAndSyncCamAfter(
              engineCommandManager,
              data.faceId
            )

            return {
              sketchPathToNode: pathToNewSketchNode,
              zAxis: data.zAxis,
              yAxis: data.yAxis,
              origin: data.position,
            }
          }
          const { modifiedAst, pathToNode } = startSketchOnDefault(
            kclManager.ast,
            data.plane
          )
          await kclManager.updateAst(modifiedAst, false)
          sceneInfra.camControls.syncDirection = 'clientToEngine'
          const quat = await getSketchQuaternion(pathToNode, data.zAxis)
          await sceneInfra.camControls.tweenCameraToQuaternion(quat)
          return {
            sketchPathToNode: pathToNode,
            zAxis: data.zAxis,
            yAxis: data.yAxis,
            origin: [0, 0, 0],
          }
        },
        'animate-to-sketch': async ({ selectionRanges }) => {
          const sourceRange = selectionRanges.codeBasedSelections[0].range
          const sketchPathToNode = getNodePathFromSourceRange(
            kclManager.ast,
            sourceRange
          )
          const info = await getSketchOrientationDetails(sketchPathToNode || [])
          await letEngineAnimateAndSyncCamAfter(
            engineCommandManager,
            info?.sketchDetails?.faceId || ''
          )
          return {
            sketchPathToNode: sketchPathToNode || [],
            zAxis: info.sketchDetails.zAxis || null,
            yAxis: info.sketchDetails.yAxis || null,
            origin: info.sketchDetails.origin.map(
              (a) => a / sceneInfra._baseUnitMultiplier
            ) as [number, number, number],
          }
        },
        'Get horizontal info': async ({
          selectionRanges,
        }): Promise<SetSelections> => {
          const { modifiedAst, pathToNodeMap } =
            await applyConstraintHorzVertDistance({
              constraint: 'setHorzDistance',
              selectionRanges,
            })
          await kclManager.updateAst(modifiedAst, true)
          return {
            selectionType: 'completeSelection',
            selection: pathMapToSelections(
              kclManager.ast,
              selectionRanges,
              pathToNodeMap
            ),
          }
        },
        'Get vertical info': async ({
          selectionRanges,
        }): Promise<SetSelections> => {
          const { modifiedAst, pathToNodeMap } =
            await applyConstraintHorzVertDistance({
              constraint: 'setVertDistance',
              selectionRanges,
            })
          await kclManager.updateAst(modifiedAst, true)
          return {
            selectionType: 'completeSelection',
            selection: pathMapToSelections(
              kclManager.ast,
              selectionRanges,
              pathToNodeMap
            ),
          }
        },
        'Get angle info': async ({
          selectionRanges,
        }): Promise<SetSelections> => {
          const { modifiedAst, pathToNodeMap } = await (angleBetweenInfo({
            selectionRanges,
          }).enabled
            ? applyConstraintAngleBetween({
                selectionRanges,
              })
            : applyConstraintAngleLength({
                selectionRanges,
                angleOrLength: 'setAngle',
              }))
          await kclManager.updateAst(modifiedAst, true)
          return {
            selectionType: 'completeSelection',
            selection: pathMapToSelections(
              kclManager.ast,
              selectionRanges,
              pathToNodeMap
            ),
          }
        },
        'Get length info': async ({
          selectionRanges,
        }): Promise<SetSelections> => {
          const { modifiedAst, pathToNodeMap } =
            await applyConstraintAngleLength({ selectionRanges })
          await kclManager.updateAst(modifiedAst, true)
          return {
            selectionType: 'completeSelection',
            selection: pathMapToSelections(
              kclManager.ast,
              selectionRanges,
              pathToNodeMap
            ),
          }
        },
        'Get perpendicular distance info': async ({
          selectionRanges,
        }): Promise<SetSelections> => {
          const { modifiedAst, pathToNodeMap } = await applyConstraintIntersect(
            {
              selectionRanges,
            }
          )
          await kclManager.updateAst(modifiedAst, true)
          return {
            selectionType: 'completeSelection',
            selection: pathMapToSelections(
              kclManager.ast,
              selectionRanges,
              pathToNodeMap
            ),
          }
        },
        'Get ABS X info': async ({
          selectionRanges,
        }): Promise<SetSelections> => {
          const { modifiedAst, pathToNodeMap } =
            await applyConstraintAbsDistance({
              constraint: 'xAbs',
              selectionRanges,
            })
          await kclManager.updateAst(modifiedAst, true)
          return {
            selectionType: 'completeSelection',
            selection: pathMapToSelections(
              kclManager.ast,
              selectionRanges,
              pathToNodeMap
            ),
          }
        },
        'Get ABS Y info': async ({
          selectionRanges,
        }): Promise<SetSelections> => {
          const { modifiedAst, pathToNodeMap } =
            await applyConstraintAbsDistance({
              constraint: 'yAbs',
              selectionRanges,
            })
          await kclManager.updateAst(modifiedAst, true)
          return {
            selectionType: 'completeSelection',
            selection: pathMapToSelections(
              kclManager.ast,
              selectionRanges,
              pathToNodeMap
            ),
          }
        },
        'Get convert to variable info': async ({ sketchDetails }, { data }) => {
          if (!sketchDetails) return []
          const { variableName } = await getVarNameModal({
            valueName: data.variableName || 'var',
          })
          const { modifiedAst: _modifiedAst, pathToReplacedNode } =
            moveValueIntoNewVariablePath(
              parse(recast(kclManager.ast)),
              kclManager.programMemory,
              data.pathToNode,
              variableName
            )
          await sceneEntitiesManager.updateAstAndRejigSketch(
            pathToReplacedNode || [],
            parse(recast(_modifiedAst)),
            sketchDetails.zAxis,
            sketchDetails.yAxis,
            sketchDetails.origin
          )
          return pathToReplacedNode || sketchDetails.sketchPathToNode
        },
        'do-constrain-parallel': async ({ selectionRanges, sketchDetails }) => {
          const { modifiedAst, pathToNodeMap } = applyConstraintEqualAngle({
            selectionRanges,
          })
          if (!sketchDetails) throw new Error('No sketch details')
          await sceneEntitiesManager.updateAstAndRejigSketch(
            sketchDetails?.sketchPathToNode || [],
            parse(recast(modifiedAst)),
            sketchDetails.zAxis,
            sketchDetails.yAxis,
            sketchDetails.origin
          )
          const updatedSelectionRanges = updateSelections(
            pathToNodeMap,
            selectionRanges,
            parse(recast(modifiedAst))
          )
          return {
            selectionType: 'completeSelection',
            selection: updatedSelectionRanges,
          }
        },
      },
      devTools: true,
    }
  )

  useEffect(() => {
    kclManager.registerExecuteCallback(() => {
      modelingSend({ type: 'Re-execute' })
    })

    // Before this component unmounts, call the 'Cancel'
    // event to clean up any state in the modeling machine.
    return () => {
      modelingSend({ type: 'Cancel' })
    }
  }, [modelingSend])

  // Give the state back to the editorManager.
  useEffect(() => {
    editorManager.modelingSend = modelingSend
  }, [modelingSend])

  useEffect(() => {
    editorManager.modelingEvent = modelingState.event
  }, [modelingState.event])

  useEffect(() => {
    editorManager.selectionRanges = modelingState.context.selectionRanges
  }, [modelingState.context.selectionRanges])

  useEffect(() => {
    const offlineCallback = () => {
      // If we are in sketch mode we need to exit it.
      // TODO: how do i check if we are in a sketch mode, I only want to call
      // this then.
      modelingSend({ type: 'Cancel' })
    }
    window.addEventListener('offline', offlineCallback)
    return () => {
      window.removeEventListener('offline', offlineCallback)
    }
  }, [modelingSend])

  useStateMachineCommands({
    machineId: 'modeling',
    state: modelingState,
    send: modelingSend,
    actor: modelingActor,
    commandBarConfig: modelingMachineConfig,
    allCommandsRequireNetwork: true,
    // TODO for when sketch tools are in the toolbar: This was added when we used one "Cancel" event,
    // but we need to support "SketchCancel" and basically
    // make this function take the actor or state so it
    // can call the correct event.
    onCancel: () => modelingSend({ type: 'Cancel' }),
  })

  return (
    <ModelingMachineContext.Provider
      value={{
        state: modelingState,
        context: modelingState.context,
        send: modelingSend,
      }}
    >
      {/* TODO #818: maybe pass reff down to children/app.ts or render app.tsx directly?
      since realistically it won't ever have generic children that isn't app.tsx */}
      <div className="h-screen overflow-hidden select-none" ref={streamRef}>
        {children}
      </div>
    </ModelingMachineContext.Provider>
  )
}

export default ModelingMachineProvider
