import { useMachine } from '@xstate/react'
import React, {
  createContext,
  useEffect,
  useMemo,
  useRef,
  useContext,
} from 'react'
import {
  Actor,
  AnyStateMachine,
  ContextFrom,
  Prop,
  StateFrom,
  assign,
  fromPromise,
} from 'xstate'
import {
  getPersistedContext,
  modelingMachine,
  modelingMachineDefaultContext,
} from 'machines/modelingMachine'
import { useSetupEngineManager } from 'hooks/useSetupEngineManager'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import {
  isCursorInSketchCommandRange,
  updatePathToNodeFromMap,
} from 'lang/util'
import {
  kclManager,
  sceneInfra,
  engineCommandManager,
  codeManager,
  editorManager,
  sceneEntitiesManager,
} from 'lib/singletons'
import { MachineManagerContext } from 'components/MachineManagerProvider'
import { useHotkeys } from 'react-hotkeys-hook'
import { applyConstraintHorzVertDistance } from './Toolbar/SetHorzVertDistance'
import {
  angleBetweenInfo,
  applyConstraintAngleBetween,
} from './Toolbar/SetAngleBetween'
import { applyConstraintAngleLength } from './Toolbar/setAngleLength'
import {
  canSweepSelection,
  handleSelectionBatch,
  isSelectionLastLine,
  isRangeBetweenCharacters,
  isSketchPipe,
  convertSelectionsToOld,
  Selections,
  updateSelections2,
} from 'lib/selections'
import { applyConstraintIntersect } from './Toolbar/Intersect'
import { applyConstraintAbsDistance } from './Toolbar/SetAbsDistance'
import useStateMachineCommands from 'hooks/useStateMachineCommands'
import { modelingMachineCommandConfig } from 'lib/commandBarConfigs/modelingCommandConfig'
import {
  SEGMENT_BODIES,
  getParentGroup,
  getSketchOrientationDetails,
} from 'clientSideScene/sceneEntities'
import {
  moveValueIntoNewVariablePath,
  sketchOnExtrudedFace,
  startSketchOnDefault,
} from 'lang/modifyAst'
import { Program, parse, recast } from 'lang/wasm'
import {
  doesSceneHaveSweepableSketch,
  getNodePathFromSourceRange,
  isSingleCursorInPipe,
} from 'lang/queryAst'
import { exportFromEngine } from 'lib/exportFromEngine'
import { Models } from '@kittycad/lib/dist/types/src'
import toast from 'react-hot-toast'
import { EditorSelection, Transaction } from '@codemirror/state'
import { useLoaderData, useNavigate, useSearchParams } from 'react-router-dom'
import { letEngineAnimateAndSyncCamAfter } from 'clientSideScene/CameraControls'
import { getVarNameModal } from 'hooks/useToolbarGuards'
import { err, reportRejection, trap } from 'lib/trap'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { modelingMachineEvent } from 'editor/manager'
import { hasValidFilletSelection } from 'lang/modifyAst/addFillet'
import {
  ExportIntent,
  EngineConnectionStateType,
  EngineConnectionEvents,
} from 'lang/std/engineConnection'
import { submitAndAwaitTextToKcl } from 'lib/textToCad'
import { useFileContext } from 'hooks/useFileContext'
import { uuidv4 } from 'lib/utils'
import { IndexLoaderData } from 'lib/types'
import { Node } from 'wasm-lib/kcl/bindings/Node'

type MachineContext<T extends AnyStateMachine> = {
  state: StateFrom<T>
  context: ContextFrom<T>
  send: Prop<Actor<T>, 'send'>
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
        modeling: {
          defaultUnit,
          cameraProjection,
          highlightEdges,
          showScaleGrid,
        },
      },
    },
  } = useSettingsAuthContext()
  const navigate = useNavigate()
  const { context, send: fileMachineSend } = useFileContext()
  const { file } = useLoaderData() as IndexLoaderData
  const token = auth?.context?.token
  const streamRef = useRef<HTMLDivElement>(null)
  const persistedContext = useMemo(() => getPersistedContext(), [])

  let [searchParams] = useSearchParams()
  const pool = searchParams.get('pool')

  const { commandBarState, commandBarSend } = useCommandsContext()

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

  const machineManager = useContext(MachineManagerContext)

  const [modelingState, modelingSend, modelingActor] = useMachine(
    modelingMachine.provide({
      actions: {
        'disable copilot': () => {
          editorManager.setCopilotEnabled(false)
        },
        'enable copilot': () => {
          editorManager.setCopilotEnabled(true)
        },
        // tsc reports this typing as perfectly fine, but eslint is complaining.
        // It's actually nonsensical, so I'm quieting.
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        'sketch exit execute': async ({
          context: { store },
        }): Promise<void> => {
          // When cancelling the sketch mode we should disable sketch mode within the engine.
          await engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: { type: 'sketch_mode_disable' },
          })

          sceneInfra.camControls.syncDirection = 'clientToEngine'

          if (cameraProjection.current === 'perspective') {
            await sceneInfra.camControls.snapToPerspectiveBeforeHandingBackControlToEngine()
          }

          sceneInfra.camControls.syncDirection = 'engineToClient'

          store.videoElement?.pause()

          return kclManager
            .executeCode()
            .then(() => {
              if (engineCommandManager.engineConnection?.idleMode) return

              store.videoElement?.play().catch((e) => {
                console.warn('Video playing was prevented', e)
              })
            })
            .catch(reportRejection)
        },
        'Set mouse state': assign(({ context, event }) => {
          if (event.type !== 'Set mouse state') return {}
          const nextSegmentHoverMap = () => {
            if (event.data.type === 'isHovering') {
              const parent = getParentGroup(event.data.on, SEGMENT_BODIES)
              const pathToNode = parent?.userData?.pathToNode
              const pathToNodeString = JSON.stringify(pathToNode)
              if (!parent || !pathToNode) return context.segmentHoverMap
              if (context.segmentHoverMap[pathToNodeString] !== undefined)
                clearTimeout(
                  context.segmentHoverMap[JSON.stringify(pathToNode)]
                )
              return {
                ...context.segmentHoverMap,
                [pathToNodeString]: 0,
              }
            } else if (
              event.data.type === 'idle' &&
              context.mouseState.type === 'isHovering'
            ) {
              const mouseOnParent = getParentGroup(
                context.mouseState.on,
                SEGMENT_BODIES
              )
              if (!mouseOnParent || !mouseOnParent?.userData?.pathToNode)
                return context.segmentHoverMap
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
                // overlay timeout is 1s
              }, 1000) as unknown as number
              return {
                ...context.segmentHoverMap,
                [pathToNodeString]: timeoutId,
              }
            } else if (event.data.type === 'timeoutEnd') {
              const copy = { ...context.segmentHoverMap }
              delete copy[event.data.pathToNodeString]
              return copy
            }
            return {}
          }
          return {
            mouseState: event.data,
            segmentHoverMap: nextSegmentHoverMap(),
          }
        }),
        'Set Segment Overlays': assign({
          segmentOverlays: ({ context: { segmentOverlays }, event }) => {
            if (event.type !== 'Set Segment Overlays') return {}
            if (event.data.type === 'set-many') return event.data.overlays
            if (event.data.type === 'set-one')
              return {
                ...segmentOverlays,
                [event.data.pathToNodeString]: event.data.seg,
              }
            if (event.data.type === 'delete-one') {
              const copy = { ...segmentOverlays }
              delete copy[event.data.pathToNodeString]
              return copy
            }
            // data.type === 'clear'
            return {}
          },
        }),
        'Center camera on selection': () => {
          engineCommandManager
            .sendSceneCommand({
              type: 'modeling_cmd_req',
              cmd_id: uuidv4(),
              cmd: {
                type: 'default_camera_center_to_selection',
              },
            })
            .catch(reportRejection)
        },
        'Set sketchDetails': assign(({ context: { sketchDetails }, event }) => {
          if (event.type !== 'Delete segment') return {}
          if (!sketchDetails) return {}
          return {
            sketchDetails: {
              ...sketchDetails,
              sketchPathToNode: event.data,
            },
          }
        }),
        'Set selection': assign(
          ({ context: { selectionRanges, sketchDetails }, event }) => {
            // this was needed for ts after adding 'Set selection' action to on done modal events
            // const oldSelections = convertSelectionsToOld(selectionRanges)
            const setSelections =
              ('data' in event &&
                event.data &&
                'selectionType' in event.data &&
                event.data) ||
              ('output' in event &&
                event.output &&
                'selectionType' in event.output &&
                event.output) ||
              null
            if (!setSelections) return {}

            const dispatchSelection = (selection?: EditorSelection) => {
              if (!selection) return // TODO less of hack for the below please
              if (!editorManager.editorView) return
              setTimeout(() => {
                if (!editorManager.editorView) return
                editorManager.editorView.dispatch({
                  selection,
                  annotations: [
                    modelingMachineEvent,
                    Transaction.addToHistory.of(false),
                  ],
                })
              })
            }
            // let selections: Selections__old = {
            //   codeBasedSelections: [],
            //   otherSelections: [],
            // }
            let selections: Selections = {
              graphSelections: [],
              otherSelections: [],
            }
            if (setSelections.selectionType === 'singleCodeCursor') {
              if (!setSelections.selection && editorManager.isShiftDown) {
              } else if (
                !setSelections.selection &&
                !editorManager.isShiftDown
              ) {
                selections = {
                  graphSelections: [],
                  otherSelections: [],
                }
              } else if (
                setSelections.selection &&
                !editorManager.isShiftDown
              ) {
                // const oldSelection = convertSelectionToOld(setSelections.selection)
                // if (oldSelection) {

                // }
                selections = {
                  graphSelections: [setSelections.selection],
                  otherSelections: [],
                }
              } else if (setSelections.selection && editorManager.isShiftDown) {
                // const oldSelection = convertSelectionToOld(setSelections.selection)
                // if (oldSelection) {
                // }
                selections = {
                  graphSelections: [
                    ...selectionRanges.graphSelections,
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
                selections: convertSelectionsToOld(selections),
              })
              codeMirrorSelection && dispatchSelection(codeMirrorSelection)
              engineEvents &&
                engineEvents.forEach((event) => {
                  // eslint-disable-next-line @typescript-eslint/no-floating-promises
                  engineCommandManager.sendSceneCommand(event)
                })
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
                  graphSelections: selectionRanges.graphSelections,
                  otherSelections: [setSelections.selection],
                }
              } else {
                selections = {
                  graphSelections: [],
                  otherSelections: [setSelections.selection],
                }
              }
              const { engineEvents, updateSceneObjectColors } =
                handleSelectionBatch({
                  selections: convertSelectionsToOld(selections),
                })
              engineEvents &&
                engineEvents.forEach((event) => {
                  // eslint-disable-next-line @typescript-eslint/no-floating-promises
                  engineCommandManager.sendSceneCommand(event)
                })
              updateSceneObjectColors()
              return {
                selectionRanges: selections,
              }
            }
            if (setSelections.selectionType === 'completeSelection') {
              editorManager.selectRange(setSelections.selection)
              if (!sketchDetails)
                return {
                  selectionRanges: setSelections.selection,
                }
              return {
                selectionRanges: setSelections.selection,
                sketchDetails: {
                  ...sketchDetails,
                  sketchPathToNode:
                    setSelections.updatedPathToNode ||
                    sketchDetails?.sketchPathToNode ||
                    [],
                },
              }
            }

            return {}
          }
        ),
        Make: ({ context, event }) => {
          if (event.type !== 'Make') return
          // Check if we already have an export intent.
          if (engineCommandManager.exportInfo) {
            toast.error('Already exporting')
            return
          }
          // Set the export intent.
          engineCommandManager.exportInfo = {
            intent: ExportIntent.Make,
            name: file?.name || '',
          }

          // Set the current machine.
          // Due to our use of singeton pattern, we need to do this to reliably
          // update this object across React and non-React boundary.
          // We need to do this eagerly because of the exportToEngine call below.
          if (engineCommandManager.machineManager === null) {
            console.warn(
              "engineCommandManager.machineManager is null. It shouldn't be at this point. Aborting operation."
            )
            return
          } else {
            engineCommandManager.machineManager.currentMachine =
              event.data.machine
          }

          // Update the rest of the UI that needs to know the current machine
          context.machineManager.setCurrentMachine(event.data.machine)

          const format: Models['OutputFormat_type'] = {
            type: 'stl',
            coords: {
              forward: {
                axis: 'y',
                direction: 'negative',
              },
              up: {
                axis: 'z',
                direction: 'positive',
              },
            },
            storage: 'ascii',
            // Convert all units to mm since that is what the slicer expects.
            units: 'mm',
            selection: { type: 'default_scene' },
          }

          exportFromEngine({
            format: format,
          }).catch(reportRejection)
        },
        'Engine export': ({ event }) => {
          if (event.type !== 'Export') return
          if (engineCommandManager.exportInfo) {
            toast.error('Already exporting')
            return
          }
          // Set the export intent.
          engineCommandManager.exportInfo = {
            intent: ExportIntent.Save,
            // This never gets used its only for make.
            name: '',
          }

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
          }).catch(reportRejection)
        },
        'Submit to Text-to-CAD API': ({ event }) => {
          if (event.type !== 'Text-to-CAD') return
          const trimmedPrompt = event.data.prompt.trim()
          if (!trimmedPrompt) return

          submitAndAwaitTextToKcl({
            trimmedPrompt,
            fileMachineSend,
            navigate,
            commandBarSend,
            context,
            token,
            settings: {
              theme: theme.current,
              highlightEdges: highlightEdges.current,
            },
          }).catch(reportRejection)
        },
      },
      guards: {
        'has valid sweep selection': ({ context: { selectionRanges } }) => {
          // A user can begin extruding if they either have 1+ faces selected or nothing selected
          // TODO: I believe this guard only allows for extruding a single face at a time
          const _selections = convertSelectionsToOld(selectionRanges)
          const hasNoSelection =
            _selections.codeBasedSelections.length === 0 ||
            isRangeBetweenCharacters(_selections) ||
            isSelectionLastLine(_selections, codeManager.code)

          if (hasNoSelection) {
            // they have no selection, we should enable the button
            // so they can select the face through the cmdbar
            // BUT only if there's extrudable geometry
            return doesSceneHaveSweepableSketch(kclManager.ast)
          }
          if (!isSketchPipe(_selections)) return false

          return canSweepSelection(_selections)
        },
        'has valid selection for deletion': ({
          context: { selectionRanges },
        }) => {
          const _selections = convertSelectionsToOld(selectionRanges)
          if (!commandBarState.matches('Closed')) return false
          if (_selections.codeBasedSelections.length <= 0) return false
          return true
        },
        'has valid fillet selection': ({ context: { selectionRanges } }) => {
          const _selections = convertSelectionsToOld(selectionRanges)
          return hasValidFilletSelection({
            selectionRanges: _selections,
            ast: kclManager.ast,
            code: codeManager.code,
          })
        },
        'Selection is on face': ({ context: { selectionRanges }, event }) => {
          if (event.type !== 'Enter sketch') return false
          if (event.data?.forceNewSketch) return false
          const _selections = convertSelectionsToOld(selectionRanges)
          if (!isSingleCursorInPipe(_selections, kclManager.ast)) return false
          return !!isCursorInSketchCommandRange(
            engineCommandManager.artifactGraph,
            _selections
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
            toast.error(errorMessage, {
              id: kclManager.engineCommandManager.pendingExport?.toastId,
            })
            return false
          }
        },
      },
      actors: {
        'AST-undo-startSketchOn': fromPromise(
          async ({ input: { sketchDetails } }) => {
            if (!sketchDetails) return
            if (kclManager.ast.body.length) {
              // this assumes no changes have been made to the sketch besides what we did when entering the sketch
              // i.e. doesn't account for user's adding code themselves, maybe we need store a flag userEditedSinceSketchMode?
              const newAst = structuredClone(kclManager.ast)
              const varDecIndex = sketchDetails.sketchPathToNode[1][0]
              // remove body item at varDecIndex
              newAst.body = newAst.body.filter((_, i) => i !== varDecIndex)
              await kclManager.executeAstMock(newAst)
            }
            sceneInfra.setCallbacks({
              onClick: () => {},
              onDrag: () => {},
            })
            return undefined
          }
        ),
        'animate-to-face': fromPromise(async ({ input }) => {
          if (!input) return undefined
          if (input.type === 'extrudeFace') {
            const sketched = sketchOnExtrudedFace(
              kclManager.ast,
              input.sketchPathToNode,
              input.extrudePathToNode,
              input.faceInfo
            )
            if (err(sketched)) {
              const sketchedError = new Error(
                'Incompatible face, please try another'
              )
              trap(sketchedError)
              return Promise.reject(sketchedError)
            }
            const { modifiedAst, pathToNode: pathToNewSketchNode } = sketched

            await kclManager.executeAstMock(modifiedAst)

            await letEngineAnimateAndSyncCamAfter(
              engineCommandManager,
              input.faceId
            )
            sceneInfra.camControls.syncDirection = 'clientToEngine'
            return {
              sketchPathToNode: pathToNewSketchNode,
              zAxis: input.zAxis,
              yAxis: input.yAxis,
              origin: input.position,
            }
          }
          const { modifiedAst, pathToNode } = startSketchOnDefault(
            kclManager.ast,
            input.plane
          )
          await kclManager.updateAst(modifiedAst, false)
          sceneInfra.camControls.enableRotate = false
          sceneInfra.camControls.syncDirection = 'clientToEngine'

          await letEngineAnimateAndSyncCamAfter(
            engineCommandManager,
            input.planeId
          )

          return {
            sketchPathToNode: pathToNode,
            zAxis: input.zAxis,
            yAxis: input.yAxis,
            origin: [0, 0, 0],
          }
        }),
        'animate-to-sketch': fromPromise(
          async ({ input: { selectionRanges } }) => {
            const _selections = convertSelectionsToOld(selectionRanges)
            const sourceRange = _selections.codeBasedSelections[0].range
            const sketchPathToNode = getNodePathFromSourceRange(
              kclManager.ast,
              sourceRange
            )
            const info = await getSketchOrientationDetails(
              sketchPathToNode || []
            )
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
          }
        ),

        'Get horizontal info': fromPromise(
          async ({ input: { selectionRanges, sketchDetails } }) => {
            const _selections = convertSelectionsToOld(selectionRanges)
            const { modifiedAst, pathToNodeMap } =
              await applyConstraintHorzVertDistance({
                constraint: 'setHorzDistance',
                selectionRanges: _selections,
              })
            const _modifiedAst = parse(recast(modifiedAst))
            if (!sketchDetails)
              return Promise.reject(new Error('No sketch details'))
            const updatedPathToNode = updatePathToNodeFromMap(
              sketchDetails.sketchPathToNode,
              pathToNodeMap
            )
            const updatedAst =
              await sceneEntitiesManager.updateAstAndRejigSketch(
                updatedPathToNode,
                _modifiedAst,
                sketchDetails.zAxis,
                sketchDetails.yAxis,
                sketchDetails.origin
              )
            if (err(updatedAst)) return Promise.reject(updatedAst)
            // const selection = updateSelections(
            const selection = updateSelections2(
              pathToNodeMap,
              selectionRanges,
              updatedAst.newAst
            )
            if (err(selection)) return Promise.reject(selection)
            return {
              selectionType: 'completeSelection',
              selection,
              updatedPathToNode,
            }
          }
        ),
        'Get vertical info': fromPromise(
          async ({ input: { selectionRanges, sketchDetails } }) => {
            const _selections = convertSelectionsToOld(selectionRanges)
            const { modifiedAst, pathToNodeMap } =
              await applyConstraintHorzVertDistance({
                constraint: 'setVertDistance',
                selectionRanges: _selections,
              })
            const _modifiedAst = parse(recast(modifiedAst))
            if (!sketchDetails)
              return Promise.reject(new Error('No sketch details'))
            const updatedPathToNode = updatePathToNodeFromMap(
              sketchDetails.sketchPathToNode,
              pathToNodeMap
            )
            const updatedAst =
              await sceneEntitiesManager.updateAstAndRejigSketch(
                updatedPathToNode,
                _modifiedAst,
                sketchDetails.zAxis,
                sketchDetails.yAxis,
                sketchDetails.origin
              )
            if (err(updatedAst)) return Promise.reject(updatedAst)
            const selection = updateSelections2(
              // const selection = updateSelections(
              pathToNodeMap,
              selectionRanges,
              updatedAst.newAst
            )
            if (err(selection)) return Promise.reject(selection)
            return {
              selectionType: 'completeSelection',
              selection,
              updatedPathToNode,
            }
          }
        ),
        'Get angle info': fromPromise(
          async ({ input: { selectionRanges, sketchDetails } }) => {
            const info = angleBetweenInfo({
              selectionRanges: convertSelectionsToOld(selectionRanges),
            })
            if (err(info)) return Promise.reject(info)
            const { modifiedAst, pathToNodeMap } = await (info.enabled
              ? applyConstraintAngleBetween({
                  selectionRanges: convertSelectionsToOld(selectionRanges),
                })
              : applyConstraintAngleLength({
                  selectionRanges: convertSelectionsToOld(selectionRanges),
                  angleOrLength: 'setAngle',
                }))
            const _modifiedAst = parse(recast(modifiedAst))
            if (err(_modifiedAst)) return Promise.reject(_modifiedAst)

            if (!sketchDetails)
              return Promise.reject(new Error('No sketch details'))
            const updatedPathToNode = updatePathToNodeFromMap(
              sketchDetails.sketchPathToNode,
              pathToNodeMap
            )
            const updatedAst =
              await sceneEntitiesManager.updateAstAndRejigSketch(
                updatedPathToNode,
                _modifiedAst,
                sketchDetails.zAxis,
                sketchDetails.yAxis,
                sketchDetails.origin
              )
            if (err(updatedAst)) return Promise.reject(updatedAst)
            const selection = updateSelections2(
              pathToNodeMap,
              selectionRanges,
              updatedAst.newAst
            )
            if (err(selection)) return Promise.reject(selection)
            return {
              selectionType: 'completeSelection',
              selection,
              updatedPathToNode,
            }
          }
        ),
        'Get length info': fromPromise(
          async ({ input: { selectionRanges, sketchDetails } }) => {
            const { modifiedAst, pathToNodeMap } =
              await applyConstraintAngleLength({
                selectionRanges: convertSelectionsToOld(selectionRanges),
              })
            const _modifiedAst = parse(recast(modifiedAst))
            if (!sketchDetails)
              return Promise.reject(new Error('No sketch details'))
            const updatedPathToNode = updatePathToNodeFromMap(
              sketchDetails.sketchPathToNode,
              pathToNodeMap
            )
            const updatedAst =
              await sceneEntitiesManager.updateAstAndRejigSketch(
                updatedPathToNode,
                _modifiedAst,
                sketchDetails.zAxis,
                sketchDetails.yAxis,
                sketchDetails.origin
              )
            if (err(updatedAst)) return Promise.reject(updatedAst)
            const selection = updateSelections2(
              pathToNodeMap,
              selectionRanges,
              updatedAst.newAst
            )
            if (err(selection)) return Promise.reject(selection)
            return {
              selectionType: 'completeSelection',
              selection,
              updatedPathToNode,
            }
          }
        ),
        'Get perpendicular distance info': fromPromise(
          async ({ input: { selectionRanges, sketchDetails } }) => {
            const { modifiedAst, pathToNodeMap } =
              await applyConstraintIntersect({
                selectionRanges: convertSelectionsToOld(selectionRanges),
              })
            const _modifiedAst = parse(recast(modifiedAst))
            if (!sketchDetails)
              return Promise.reject(new Error('No sketch details'))
            const updatedPathToNode = updatePathToNodeFromMap(
              sketchDetails.sketchPathToNode,
              pathToNodeMap
            )
            const updatedAst =
              await sceneEntitiesManager.updateAstAndRejigSketch(
                updatedPathToNode,
                _modifiedAst,
                sketchDetails.zAxis,
                sketchDetails.yAxis,
                sketchDetails.origin
              )
            if (err(updatedAst)) return Promise.reject(updatedAst)
            const selection = updateSelections2(
              pathToNodeMap,
              selectionRanges,
              updatedAst.newAst
            )
            if (err(selection)) return Promise.reject(selection)
            return {
              selectionType: 'completeSelection',
              selection,
              updatedPathToNode,
            }
          }
        ),
        'Get ABS X info': fromPromise(
          async ({ input: { selectionRanges, sketchDetails } }) => {
            const { modifiedAst, pathToNodeMap } =
              await applyConstraintAbsDistance({
                constraint: 'xAbs',
                selectionRanges: convertSelectionsToOld(selectionRanges),
              })
            const _modifiedAst = parse(recast(modifiedAst))
            if (!sketchDetails)
              return Promise.reject(new Error('No sketch details'))
            const updatedPathToNode = updatePathToNodeFromMap(
              sketchDetails.sketchPathToNode,
              pathToNodeMap
            )
            const updatedAst =
              await sceneEntitiesManager.updateAstAndRejigSketch(
                updatedPathToNode,
                _modifiedAst,
                sketchDetails.zAxis,
                sketchDetails.yAxis,
                sketchDetails.origin
              )
            if (err(updatedAst)) return Promise.reject(updatedAst)
            const selection = updateSelections2(
              pathToNodeMap,
              selectionRanges,
              updatedAst.newAst
            )
            if (err(selection)) return Promise.reject(selection)
            return {
              selectionType: 'completeSelection',
              selection,
              updatedPathToNode,
            }
          }
        ),
        'Get ABS Y info': fromPromise(
          async ({ input: { selectionRanges, sketchDetails } }) => {
            const { modifiedAst, pathToNodeMap } =
              await applyConstraintAbsDistance({
                constraint: 'yAbs',
                selectionRanges: convertSelectionsToOld(selectionRanges),
              })
            const _modifiedAst = parse(recast(modifiedAst))
            if (!sketchDetails)
              return Promise.reject(new Error('No sketch details'))
            const updatedPathToNode = updatePathToNodeFromMap(
              sketchDetails.sketchPathToNode,
              pathToNodeMap
            )
            const updatedAst =
              await sceneEntitiesManager.updateAstAndRejigSketch(
                updatedPathToNode,
                _modifiedAst,
                sketchDetails.zAxis,
                sketchDetails.yAxis,
                sketchDetails.origin
              )
            if (err(updatedAst)) return Promise.reject(updatedAst)
            const selection = updateSelections2(
              pathToNodeMap,
              selectionRanges,
              updatedAst.newAst
            )
            if (err(selection)) return Promise.reject(selection)
            return {
              selectionType: 'completeSelection',
              selection,
              updatedPathToNode,
            }
          }
        ),
        'Get convert to variable info': fromPromise(
          async ({ input: { selectionRanges, sketchDetails, data } }) => {
            if (!sketchDetails)
              return Promise.reject(new Error('No sketch details'))
            const { variableName } = await getVarNameModal({
              valueName: data?.variableName || 'var',
            })
            let parsed = parse(recast(kclManager.ast))
            if (trap(parsed)) return Promise.reject(parsed)
            parsed = parsed as Node<Program>

            const { modifiedAst: _modifiedAst, pathToReplacedNode } =
              moveValueIntoNewVariablePath(
                parsed,
                kclManager.programMemory,
                data?.pathToNode || [],
                variableName
              )
            parsed = parse(recast(_modifiedAst))
            if (trap(parsed)) return Promise.reject(parsed)
            parsed = parsed as Node<Program>
            if (!pathToReplacedNode)
              return Promise.reject(new Error('No path to replaced node'))

            const updatedAst =
              await sceneEntitiesManager.updateAstAndRejigSketch(
                pathToReplacedNode || [],
                parsed,
                sketchDetails.zAxis,
                sketchDetails.yAxis,
                sketchDetails.origin
              )
            if (err(updatedAst)) return Promise.reject(updatedAst)
            const selection = updateSelections2(
              { 0: pathToReplacedNode },
              selectionRanges,
              updatedAst.newAst
            )
            if (err(selection)) return Promise.reject(selection)
            return {
              selectionType: 'completeSelection',
              selection,
              updatedPathToNode: pathToReplacedNode,
            }
          }
        ),
      },
    }),
    {
      input: {
        ...modelingMachineDefaultContext,
        store: {
          ...modelingMachineDefaultContext.store,
          ...persistedContext,
        },
        machineManager,
      },
      // devTools: true,
    }
  )

  useSetupEngineManager(
    streamRef,
    modelingSend,
    modelingState.context,
    {
      pool: pool,
      theme: theme.current,
      highlightEdges: highlightEdges.current,
      enableSSAO: enableSSAO.current,
      showScaleGrid: showScaleGrid.current,
      cameraProjection: cameraProjection.current,
    },
    token
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
    editorManager.modelingState = modelingState
  }, [modelingState])

  useEffect(() => {
    editorManager.selectionRanges = modelingState.context.selectionRanges
  }, [modelingState.context.selectionRanges])

  useEffect(() => {
    const onConnectionStateChanged = ({ detail }: CustomEvent) => {
      // If we are in sketch mode we need to exit it.
      // TODO: how do i check if we are in a sketch mode, I only want to call
      // this then.
      if (detail.type === EngineConnectionStateType.Disconnecting) {
        modelingSend({ type: 'Cancel' })
      }
    }
    engineCommandManager.engineConnection?.addEventListener(
      EngineConnectionEvents.ConnectionStateChanged,
      onConnectionStateChanged as EventListener
    )
    return () => {
      engineCommandManager.engineConnection?.removeEventListener(
        EngineConnectionEvents.ConnectionStateChanged,
        onConnectionStateChanged as EventListener
      )
    }
  }, [engineCommandManager.engineConnection, modelingSend])

  // Allow using the delete key to delete solids
  useHotkeys(['backspace', 'delete', 'del'], () => {
    modelingSend({ type: 'Delete selection' })
  })

  // Allow ctrl+alt+c to center to selection
  useHotkeys(['mod + alt + c'], () => {
    modelingSend({ type: 'Center camera on selection' })
  })

  useStateMachineCommands({
    machineId: 'modeling',
    state: modelingState,
    send: modelingSend,
    actor: modelingActor,
    commandBarConfig: modelingMachineCommandConfig,
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
