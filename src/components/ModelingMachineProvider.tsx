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
  updateSketchDetailsNodePaths,
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
import {
  applyConstraintAngleLength,
  applyConstraintLength,
} from './Toolbar/setAngleLength'
import {
  canSweepSelection,
  handleSelectionBatch,
  isSelectionLastLine,
  isRangeBetweenCharacters,
  isSketchPipe,
  Selections,
  updateSelections,
  canLoftSelection,
  canShellSelection,
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
  insertNamedConstant,
  replaceValueAtNodePath,
  sketchOnExtrudedFace,
  sketchOnOffsetPlane,
  startSketchOnDefault,
} from 'lang/modifyAst'
import {
  PathToNode,
  Program,
  VariableDeclaration,
  parse,
  recast,
  resultIsOk,
} from 'lang/wasm'
import {
  doesSceneHaveExtrudedSketch,
  doesSceneHaveSweepableSketch,
  getNodeFromPath,
  isCursorInFunctionDefinition,
  traverse,
} from 'lang/queryAst'
import { exportFromEngine } from 'lib/exportFromEngine'
import { Models } from '@kittycad/lib/dist/types/src'
import toast from 'react-hot-toast'
import { EditorSelection, Transaction } from '@codemirror/state'
import { useLoaderData, useNavigate, useSearchParams } from 'react-router-dom'
import { letEngineAnimateAndSyncCamAfter } from 'clientSideScene/CameraControls'
import { err, reportRejection, trap, reject } from 'lib/trap'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { modelingMachineEvent } from 'editor/manager'
import { hasValidEdgeTreatmentSelection } from 'lang/modifyAst/addEdgeTreatment'
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
import {
  getPathsFromArtifact,
  getPlaneFromArtifact,
} from 'lang/std/artifactGraph'

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
              sketchEntryNodePath: event.data,
            },
          }
        }),
        'Set selection': assign(
          ({ context: { selectionRanges, sketchDetails }, event }) => {
            // this was needed for ts after adding 'Set selection' action to on done modal events
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
                selections = {
                  graphSelections: [setSelections.selection],
                  otherSelections: [],
                }
              } else if (setSelections.selection && editorManager.isShiftDown) {
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
                selections,
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

            if (
              setSelections.selectionType === 'axisSelection' ||
              setSelections.selectionType === 'defaultPlaneSelection'
            ) {
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
                  sketchEntryNodePath:
                    setSelections.updatedSketchEntryNodePath ||
                    sketchDetails?.sketchEntryNodePath ||
                    [],
                  sketchNodePaths:
                    setSelections.updatedSketchNodePaths ||
                    sketchDetails?.sketchNodePaths ||
                    [],
                  planeNodePath:
                    setSelections.updatedPlaneNodePath ||
                    sketchDetails?.planeNodePath ||
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
            name: file?.name?.replace('.kcl', `.${event.data.type}`) || '',
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
          const hasNoSelection =
            selectionRanges.graphSelections.length === 0 ||
            isRangeBetweenCharacters(selectionRanges) ||
            isSelectionLastLine(selectionRanges, codeManager.code)

          if (hasNoSelection) {
            // they have no selection, we should enable the button
            // so they can select the face through the cmdbar
            // BUT only if there's extrudable geometry
            return doesSceneHaveSweepableSketch(kclManager.ast)
          }
          if (!isSketchPipe(selectionRanges)) return false

          const canSweep = canSweepSelection(selectionRanges)
          if (err(canSweep)) return false
          return canSweep
        },
        'has valid loft selection': ({ context: { selectionRanges } }) => {
          const hasNoSelection =
            selectionRanges.graphSelections.length === 0 ||
            isRangeBetweenCharacters(selectionRanges) ||
            isSelectionLastLine(selectionRanges, codeManager.code)

          if (hasNoSelection) {
            const count = 2
            return doesSceneHaveSweepableSketch(kclManager.ast, count)
          }

          const canLoft = canLoftSelection(selectionRanges)
          if (err(canLoft)) return false
          return canLoft
        },
        'has valid shell selection': ({
          context: { selectionRanges },
          event,
        }) => {
          const hasNoSelection =
            selectionRanges.graphSelections.length === 0 ||
            isRangeBetweenCharacters(selectionRanges) ||
            isSelectionLastLine(selectionRanges, codeManager.code)

          if (hasNoSelection) {
            return doesSceneHaveExtrudedSketch(kclManager.ast)
          }

          const canShell = canShellSelection(selectionRanges)
          if (err(canShell)) return false
          return canShell
        },
        'has valid selection for deletion': ({
          context: { selectionRanges },
        }) => {
          if (!commandBarState.matches('Closed')) return false
          if (selectionRanges.graphSelections.length <= 0) return false
          return true
        },
        'has valid edge treatment selection': ({
          context: { selectionRanges },
        }) => {
          return hasValidEdgeTreatmentSelection({
            selectionRanges,
            ast: kclManager.ast,
            code: codeManager.code,
          })
        },
        'Selection is on face': ({ context: { selectionRanges }, event }) => {
          if (event.type !== 'Enter sketch') return false
          if (event.data?.forceNewSketch) return false
          if (
            isCursorInFunctionDefinition(
              kclManager.ast,
              selectionRanges.graphSelections[0]
            )
          )
            return false
          return !!isCursorInSketchCommandRange(
            engineCommandManager.artifactGraph,
            selectionRanges
          )
        },
        'Has exportable geometry': () => {
          if (!kclManager.hasErrors() && kclManager.ast.body.length > 0)
            return true
          else {
            let errorMessage = 'Unable to Export '
            if (kclManager.hasErrors()) errorMessage += 'due to KCL Errors'
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
              const varDecIndex = sketchDetails.planeNodePath[1][0]

              const varDec = getNodeFromPath<VariableDeclaration>(
                newAst,
                sketchDetails.planeNodePath,
                'VariableDeclaration'
              )
              if (err(varDec)) return reject(new Error('No varDec'))
              const variableName = varDec.node.declaration.id.name
              let isIdentifierUsed = false
              traverse(newAst, {
                enter: (node) => {
                  if (
                    node.type === 'Identifier' &&
                    node.name === variableName
                  ) {
                    isIdentifierUsed = true
                  }
                },
              })
              if (isIdentifierUsed) return

              // remove body item at varDecIndex
              newAst.body = newAst.body.filter((_, i) => i !== varDecIndex)
              await kclManager.executeAstMock(newAst)
              await codeManager.updateEditorWithAstAndWriteToFile(newAst)
            }
            sceneInfra.setCallbacks({
              onClick: () => {},
              onDrag: () => {},
            })
            return undefined
          }
        ),
        'animate-to-face': fromPromise(async ({ input }) => {
          if (!input) return null
          if (input.type === 'extrudeFace' || input.type === 'offsetPlane') {
            const sketched =
              input.type === 'extrudeFace'
                ? sketchOnExtrudedFace(
                    kclManager.ast,
                    input.sketchPathToNode,
                    input.extrudePathToNode,
                    input.faceInfo
                  )
                : sketchOnOffsetPlane(kclManager.ast, input.pathToNode)
            if (err(sketched)) {
              const sketchedError = new Error(
                'Incompatible face, please try another'
              )
              trap(sketchedError)
              return Promise.reject(sketchedError)
            }
            const { modifiedAst, pathToNode: pathToNewSketchNode } = sketched

            await kclManager.executeAstMock(modifiedAst)

            const id =
              input.type === 'extrudeFace' ? input.faceId : input.planeId
            await letEngineAnimateAndSyncCamAfter(engineCommandManager, id)
            sceneInfra.camControls.syncDirection = 'clientToEngine'
            return {
              sketchEntryNodePath: [],
              planeNodePath: pathToNewSketchNode,
              sketchNodePaths: [],
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
            sketchEntryNodePath: [],
            planeNodePath: pathToNode,
            sketchNodePaths: [],
            zAxis: input.zAxis,
            yAxis: input.yAxis,
            origin: [0, 0, 0],
          }
        }),
        'animate-to-sketch': fromPromise(
          async ({ input: { selectionRanges } }) => {
            const sketchPathToNode =
              selectionRanges.graphSelections[0]?.codeRef?.pathToNode
            const plane = getPlaneFromArtifact(
              selectionRanges.graphSelections[0].artifact,
              engineCommandManager.artifactGraph
            )
            if (err(plane)) return Promise.reject(plane)

            const info = await getSketchOrientationDetails(
              sketchPathToNode || []
            )
            await letEngineAnimateAndSyncCamAfter(
              engineCommandManager,
              info?.sketchDetails?.faceId || ''
            )
            const sketchPaths = getPathsFromArtifact({
              artifact: selectionRanges.graphSelections[0].artifact,
              sketchPathToNode: sketchPathToNode || [],
            })
            if (err(sketchPaths)) return Promise.reject(sketchPaths)
            if (!plane.codeRef)
              return Promise.reject(new Error('No plane codeRef'))
            return {
              sketchEntryNodePath: sketchPathToNode || [],
              sketchNodePaths: sketchPaths,
              planeNodePath: plane.codeRef.pathToNode,
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
            const { modifiedAst, pathToNodeMap, exprInsertIndex } =
              await applyConstraintHorzVertDistance({
                constraint: 'setHorzDistance',
                selectionRanges,
              })
            const pResult = parse(recast(modifiedAst))
            if (trap(pResult) || !resultIsOk(pResult))
              return Promise.reject(new Error('Unexpected compilation error'))
            const _modifiedAst = pResult.program

            if (!sketchDetails)
              return Promise.reject(new Error('No sketch details'))

            const {
              updatedSketchEntryNodePath,
              updatedSketchNodePaths,
              updatedPlaneNodePath,
            } = updateSketchDetailsNodePaths({
              sketchEntryNodePath: sketchDetails.sketchEntryNodePath,
              sketchNodePaths: sketchDetails.sketchNodePaths,
              planeNodePath: sketchDetails.planeNodePath,
              exprInsertIndex,
            })

            const updatedAst =
              await sceneEntitiesManager.updateAstAndRejigSketch(
                updatedSketchEntryNodePath,
                updatedSketchNodePaths,
                updatedPlaneNodePath,
                _modifiedAst,
                sketchDetails.zAxis,
                sketchDetails.yAxis,
                sketchDetails.origin
              )
            if (err(updatedAst)) return Promise.reject(updatedAst)

            await codeManager.updateEditorWithAstAndWriteToFile(
              updatedAst.newAst
            )

            const selection = updateSelections(
              pathToNodeMap,
              selectionRanges,
              updatedAst.newAst
            )
            if (err(selection)) return Promise.reject(selection)
            return {
              selectionType: 'completeSelection',
              selection,
              updatedSketchEntryNodePath,
              updatedSketchNodePaths,
              updatedPlaneNodePath,
            }
          }
        ),
        'Get vertical info': fromPromise(
          async ({ input: { selectionRanges, sketchDetails } }) => {
            const { modifiedAst, pathToNodeMap, exprInsertIndex } =
              await applyConstraintHorzVertDistance({
                constraint: 'setVertDistance',
                selectionRanges,
              })
            const pResult = parse(recast(modifiedAst))
            if (trap(pResult) || !resultIsOk(pResult))
              return Promise.reject(new Error('Unexpected compilation error'))
            const _modifiedAst = pResult.program
            if (!sketchDetails)
              return Promise.reject(new Error('No sketch details'))

            const {
              updatedSketchEntryNodePath,
              updatedSketchNodePaths,
              updatedPlaneNodePath,
            } = updateSketchDetailsNodePaths({
              sketchEntryNodePath: sketchDetails.sketchEntryNodePath,
              sketchNodePaths: sketchDetails.sketchNodePaths,
              planeNodePath: sketchDetails.planeNodePath,
              exprInsertIndex,
            })

            const updatedAst =
              await sceneEntitiesManager.updateAstAndRejigSketch(
                updatedSketchEntryNodePath,
                updatedSketchNodePaths,
                updatedPlaneNodePath,
                _modifiedAst,
                sketchDetails.zAxis,
                sketchDetails.yAxis,
                sketchDetails.origin
              )
            if (err(updatedAst)) return Promise.reject(updatedAst)

            await codeManager.updateEditorWithAstAndWriteToFile(
              updatedAst.newAst
            )

            const selection = updateSelections(
              pathToNodeMap,
              selectionRanges,
              updatedAst.newAst
            )
            if (err(selection)) return Promise.reject(selection)
            return {
              selectionType: 'completeSelection',
              selection,
              updatedSketchEntryNodePath,
              updatedSketchNodePaths,
              updatedPlaneNodePath,
            }
          }
        ),
        'Get angle info': fromPromise(
          async ({ input: { selectionRanges, sketchDetails } }) => {
            const info = angleBetweenInfo({
              selectionRanges,
            })
            if (err(info)) return Promise.reject(info)
            const { modifiedAst, pathToNodeMap, exprInsertIndex } =
              await (info.enabled
                ? applyConstraintAngleBetween({
                    selectionRanges,
                  })
                : applyConstraintAngleLength({
                    selectionRanges,
                    angleOrLength: 'setAngle',
                  }))
            const pResult = parse(recast(modifiedAst))
            if (trap(pResult) || !resultIsOk(pResult))
              return Promise.reject(new Error('Unexpected compilation error'))
            const _modifiedAst = pResult.program
            if (err(_modifiedAst)) return Promise.reject(_modifiedAst)

            if (!sketchDetails)
              return Promise.reject(new Error('No sketch details'))

            const {
              updatedSketchEntryNodePath,
              updatedSketchNodePaths,
              updatedPlaneNodePath,
            } = updateSketchDetailsNodePaths({
              sketchEntryNodePath: sketchDetails.sketchEntryNodePath,
              sketchNodePaths: sketchDetails.sketchNodePaths,
              planeNodePath: sketchDetails.planeNodePath,
              exprInsertIndex,
            })

            const updatedAst =
              await sceneEntitiesManager.updateAstAndRejigSketch(
                updatedSketchEntryNodePath,
                updatedSketchNodePaths,
                updatedPlaneNodePath,
                _modifiedAst,
                sketchDetails.zAxis,
                sketchDetails.yAxis,
                sketchDetails.origin
              )
            if (err(updatedAst)) return Promise.reject(updatedAst)

            await codeManager.updateEditorWithAstAndWriteToFile(
              updatedAst.newAst
            )

            const selection = updateSelections(
              pathToNodeMap,
              selectionRanges,
              updatedAst.newAst
            )
            if (err(selection)) return Promise.reject(selection)
            return {
              selectionType: 'completeSelection',
              selection,
              updatedSketchEntryNodePath,
              updatedSketchNodePaths,
              updatedPlaneNodePath,
            }
          }
        ),
        astConstrainLength: fromPromise(
          async ({
            input: { selectionRanges, sketchDetails, lengthValue },
          }) => {
            if (!lengthValue)
              return Promise.reject(new Error('No length value'))
            const constraintResult = await applyConstraintLength({
              selectionRanges,
              length: lengthValue,
            })
            if (err(constraintResult)) return Promise.reject(constraintResult)
            const { modifiedAst, pathToNodeMap, exprInsertIndex } =
              constraintResult
            const pResult = parse(recast(modifiedAst))
            if (trap(pResult) || !resultIsOk(pResult))
              return Promise.reject(new Error('Unexpected compilation error'))
            const _modifiedAst = pResult.program
            if (!sketchDetails)
              return Promise.reject(new Error('No sketch details'))

            const {
              updatedSketchEntryNodePath,
              updatedSketchNodePaths,
              updatedPlaneNodePath,
            } = updateSketchDetailsNodePaths({
              sketchEntryNodePath: sketchDetails.sketchEntryNodePath,
              sketchNodePaths: sketchDetails.sketchNodePaths,
              planeNodePath: sketchDetails.planeNodePath,
              exprInsertIndex,
            })
            const updatedAst =
              await sceneEntitiesManager.updateAstAndRejigSketch(
                updatedSketchEntryNodePath,
                updatedSketchNodePaths,
                updatedPlaneNodePath,
                _modifiedAst,
                sketchDetails.zAxis,
                sketchDetails.yAxis,
                sketchDetails.origin
              )
            if (err(updatedAst)) return Promise.reject(updatedAst)

            await codeManager.updateEditorWithAstAndWriteToFile(
              updatedAst.newAst
            )

            const selection = updateSelections(
              pathToNodeMap,
              selectionRanges,
              updatedAst.newAst
            )
            if (err(selection)) return Promise.reject(selection)
            return {
              selectionType: 'completeSelection',
              selection,
              updatedSketchEntryNodePath,
              updatedSketchNodePaths,
              updatedPlaneNodePath,
            }
          }
        ),
        'Get perpendicular distance info': fromPromise(
          async ({ input: { selectionRanges, sketchDetails } }) => {
            const { modifiedAst, pathToNodeMap, exprInsertIndex } =
              await applyConstraintIntersect({
                selectionRanges,
              })
            const pResult = parse(recast(modifiedAst))
            if (trap(pResult) || !resultIsOk(pResult))
              return Promise.reject(new Error('Unexpected compilation error'))
            const _modifiedAst = pResult.program
            if (!sketchDetails)
              return Promise.reject(new Error('No sketch details'))

            const {
              updatedSketchEntryNodePath,
              updatedSketchNodePaths,
              updatedPlaneNodePath,
            } = updateSketchDetailsNodePaths({
              sketchEntryNodePath: sketchDetails.sketchEntryNodePath,
              sketchNodePaths: sketchDetails.sketchNodePaths,
              planeNodePath: sketchDetails.planeNodePath,
              exprInsertIndex,
            })
            const updatedAst =
              await sceneEntitiesManager.updateAstAndRejigSketch(
                updatedSketchEntryNodePath,
                updatedSketchNodePaths,
                updatedPlaneNodePath,
                _modifiedAst,
                sketchDetails.zAxis,
                sketchDetails.yAxis,
                sketchDetails.origin
              )
            if (err(updatedAst)) return Promise.reject(updatedAst)

            await codeManager.updateEditorWithAstAndWriteToFile(
              updatedAst.newAst
            )

            const selection = updateSelections(
              pathToNodeMap,
              selectionRanges,
              updatedAst.newAst
            )
            if (err(selection)) return Promise.reject(selection)
            return {
              selectionType: 'completeSelection',
              selection,
              updatedSketchEntryNodePath,
              updatedSketchNodePaths,
              updatedPlaneNodePath,
            }
          }
        ),
        'Get ABS X info': fromPromise(
          async ({ input: { selectionRanges, sketchDetails } }) => {
            const { modifiedAst, pathToNodeMap, exprInsertIndex } =
              await applyConstraintAbsDistance({
                constraint: 'xAbs',
                selectionRanges,
              })
            const pResult = parse(recast(modifiedAst))
            if (trap(pResult) || !resultIsOk(pResult))
              return Promise.reject(new Error('Unexpected compilation error'))
            const _modifiedAst = pResult.program
            if (!sketchDetails)
              return Promise.reject(new Error('No sketch details'))

            const {
              updatedSketchEntryNodePath,
              updatedSketchNodePaths,
              updatedPlaneNodePath,
            } = updateSketchDetailsNodePaths({
              sketchEntryNodePath: sketchDetails.sketchEntryNodePath,
              sketchNodePaths: sketchDetails.sketchNodePaths,
              planeNodePath: sketchDetails.planeNodePath,
              exprInsertIndex,
            })
            const updatedAst =
              await sceneEntitiesManager.updateAstAndRejigSketch(
                updatedSketchEntryNodePath,
                updatedSketchNodePaths,
                updatedPlaneNodePath,
                _modifiedAst,
                sketchDetails.zAxis,
                sketchDetails.yAxis,
                sketchDetails.origin
              )
            if (err(updatedAst)) return Promise.reject(updatedAst)

            await codeManager.updateEditorWithAstAndWriteToFile(
              updatedAst.newAst
            )

            const selection = updateSelections(
              pathToNodeMap,
              selectionRanges,
              updatedAst.newAst
            )
            if (err(selection)) return Promise.reject(selection)
            return {
              selectionType: 'completeSelection',
              selection,
              updatedSketchEntryNodePath,
              updatedSketchNodePaths,
              updatedPlaneNodePath,
            }
          }
        ),
        'Get ABS Y info': fromPromise(
          async ({ input: { selectionRanges, sketchDetails } }) => {
            const { modifiedAst, pathToNodeMap, exprInsertIndex } =
              await applyConstraintAbsDistance({
                constraint: 'yAbs',
                selectionRanges,
              })
            const pResult = parse(recast(modifiedAst))
            if (trap(pResult) || !resultIsOk(pResult))
              return Promise.reject(new Error('Unexpected compilation error'))
            const _modifiedAst = pResult.program
            if (!sketchDetails)
              return Promise.reject(new Error('No sketch details'))

            const {
              updatedSketchEntryNodePath,
              updatedSketchNodePaths,
              updatedPlaneNodePath,
            } = updateSketchDetailsNodePaths({
              sketchEntryNodePath: sketchDetails.sketchEntryNodePath,
              sketchNodePaths: sketchDetails.sketchNodePaths,
              planeNodePath: sketchDetails.planeNodePath,
              exprInsertIndex,
            })
            const updatedAst =
              await sceneEntitiesManager.updateAstAndRejigSketch(
                updatedSketchEntryNodePath,
                updatedSketchNodePaths,
                updatedPlaneNodePath,
                _modifiedAst,
                sketchDetails.zAxis,
                sketchDetails.yAxis,
                sketchDetails.origin
              )
            if (err(updatedAst)) return Promise.reject(updatedAst)

            await codeManager.updateEditorWithAstAndWriteToFile(
              updatedAst.newAst
            )

            const selection = updateSelections(
              pathToNodeMap,
              selectionRanges,
              updatedAst.newAst
            )
            if (err(selection)) return Promise.reject(selection)
            return {
              selectionType: 'completeSelection',
              selection,
              updatedSketchEntryNodePath,
              updatedSketchNodePaths,
              updatedPlaneNodePath,
            }
          }
        ),
        'Apply named value constraint': fromPromise(
          async ({ input: { selectionRanges, sketchDetails, data } }) => {
            if (!sketchDetails) {
              return Promise.reject(new Error('No sketch details'))
            }
            if (!data) {
              return Promise.reject(new Error('No data from command flow'))
            }
            let pResult = parse(recast(kclManager.ast))
            if (trap(pResult) || !resultIsOk(pResult))
              return Promise.reject(new Error('Unexpected compilation error'))
            let parsed = pResult.program

            let result: {
              modifiedAst: Node<Program>
              pathToReplaced: PathToNode | null
              exprInsertIndex: number
            } = {
              modifiedAst: parsed,
              pathToReplaced: null,
              exprInsertIndex: -1,
            }
            // If the user provided a constant name,
            // we need to insert the named constant
            // and then replace the node with the constant's name.
            if ('variableName' in data.namedValue) {
              const astAfterReplacement = replaceValueAtNodePath({
                ast: parsed,
                pathToNode: data.currentValue.pathToNode,
                newExpressionString: data.namedValue.variableName,
              })
              if (trap(astAfterReplacement)) {
                return Promise.reject(astAfterReplacement)
              }
              const parseResultAfterInsertion = parse(
                recast(
                  insertNamedConstant({
                    node: astAfterReplacement.modifiedAst,
                    newExpression: data.namedValue,
                  })
                )
              )
              if (
                trap(parseResultAfterInsertion) ||
                !resultIsOk(parseResultAfterInsertion)
              )
                return Promise.reject(parseResultAfterInsertion)
              result = {
                modifiedAst: parseResultAfterInsertion.program,
                pathToReplaced: astAfterReplacement.pathToReplaced,
                exprInsertIndex: astAfterReplacement.exprInsertIndex,
              }
            } else if ('valueText' in data.namedValue) {
              // If they didn't provide a constant name,
              // just replace the node with the value.
              const astAfterReplacement = replaceValueAtNodePath({
                ast: parsed,
                pathToNode: data.currentValue.pathToNode,
                newExpressionString: data.namedValue.valueText,
              })
              if (trap(astAfterReplacement)) {
                return Promise.reject(astAfterReplacement)
              }
              // The `replacer` function returns a pathToNode that assumes
              // an identifier is also being inserted into the AST, creating an off-by-one error.
              // This corrects that error, but TODO we should fix this upstream
              // to avoid this kind of error in the future.
              astAfterReplacement.pathToReplaced[1][0] =
                (astAfterReplacement.pathToReplaced[1][0] as number) - 1
              result = astAfterReplacement
            }

            pResult = parse(recast(result.modifiedAst))
            if (trap(pResult) || !resultIsOk(pResult))
              return Promise.reject(new Error('Unexpected compilation error'))
            parsed = pResult.program

            if (trap(parsed)) return Promise.reject(parsed)
            parsed = parsed as Node<Program>
            if (!result.pathToReplaced)
              return Promise.reject(new Error('No path to replaced node'))
            const {
              updatedSketchEntryNodePath,
              updatedSketchNodePaths,
              updatedPlaneNodePath,
            } = updateSketchDetailsNodePaths({
              sketchEntryNodePath: sketchDetails.sketchEntryNodePath,
              sketchNodePaths: sketchDetails.sketchNodePaths,
              planeNodePath: sketchDetails.planeNodePath,
              exprInsertIndex: result.exprInsertIndex,
            })

            const updatedAst =
              await sceneEntitiesManager.updateAstAndRejigSketch(
                updatedSketchEntryNodePath,
                updatedSketchNodePaths,
                updatedPlaneNodePath,
                parsed,
                sketchDetails.zAxis,
                sketchDetails.yAxis,
                sketchDetails.origin
              )
            if (err(updatedAst)) return Promise.reject(updatedAst)

            await codeManager.updateEditorWithAstAndWriteToFile(
              updatedAst.newAst
            )

            const selection = updateSelections(
              { 0: result.pathToReplaced },
              selectionRanges,
              updatedAst.newAst
            )
            if (err(selection)) return Promise.reject(selection)
            return {
              selectionType: 'completeSelection',
              selection,
              updatedSketchEntryNodePath,
              updatedSketchNodePaths,
              updatedPlaneNodePath,
            }
          }
        ),
        'set-up-draft-circle': fromPromise(
          async ({ input: { sketchDetails, data } }) => {
            if (!sketchDetails || !data)
              return reject('No sketch details or data')
            await sceneEntitiesManager.tearDownSketch({ removeAxis: false })

            const result = await sceneEntitiesManager.setupDraftCircle(
              sketchDetails.sketchEntryNodePath,
              sketchDetails.sketchNodePaths,
              sketchDetails.planeNodePath,
              sketchDetails.zAxis,
              sketchDetails.yAxis,
              sketchDetails.origin,
              data
            )
            if (err(result)) return reject(result)
            await codeManager.updateEditorWithAstAndWriteToFile(kclManager.ast)

            return result
          }
        ),
        'set-up-draft-rectangle': fromPromise(
          async ({ input: { sketchDetails, data } }) => {
            if (!sketchDetails || !data)
              return reject('No sketch details or data')
            await sceneEntitiesManager.tearDownSketch({ removeAxis: false })

            const result = await sceneEntitiesManager.setupDraftRectangle(
              sketchDetails.sketchEntryNodePath,
              sketchDetails.sketchNodePaths,
              sketchDetails.planeNodePath,
              sketchDetails.zAxis,
              sketchDetails.yAxis,
              sketchDetails.origin,
              data
            )
            if (err(result)) return reject(result)
            await codeManager.updateEditorWithAstAndWriteToFile(kclManager.ast)

            return result
          }
        ),
        'set-up-draft-center-rectangle': fromPromise(
          async ({ input: { sketchDetails, data } }) => {
            if (!sketchDetails || !data)
              return reject('No sketch details or data')
            await sceneEntitiesManager.tearDownSketch({ removeAxis: false })
            const result = await sceneEntitiesManager.setupDraftCenterRectangle(
              sketchDetails.sketchEntryNodePath,
              sketchDetails.sketchNodePaths,
              sketchDetails.planeNodePath,
              sketchDetails.zAxis,
              sketchDetails.yAxis,
              sketchDetails.origin,
              data
            )
            if (err(result)) return reject(result)
            await codeManager.updateEditorWithAstAndWriteToFile(kclManager.ast)

            return result
          }
        ),
        'setup-client-side-sketch-segments': fromPromise(
          async ({ input: { sketchDetails, selectionRanges } }) => {
            if (!sketchDetails) return
            if (!sketchDetails.sketchEntryNodePath.length) return
            if (Object.keys(sceneEntitiesManager.activeSegments).length > 0) {
              sceneEntitiesManager.tearDownSketch({ removeAxis: false })
            }
            sceneInfra.resetMouseListeners()
            await sceneEntitiesManager.setupSketch({
              sketchEntryNodePath: sketchDetails?.sketchEntryNodePath || [],
              sketchNodePaths: sketchDetails.sketchNodePaths,
              forward: sketchDetails.zAxis,
              up: sketchDetails.yAxis,
              position: sketchDetails.origin,
              maybeModdedAst: kclManager.ast,
              selectionRanges,
            })
            sceneInfra.resetMouseListeners()

            sceneEntitiesManager.setupSketchIdleCallbacks({
              sketchEntryNodePath: sketchDetails?.sketchEntryNodePath || [],
              forward: sketchDetails.zAxis,
              up: sketchDetails.yAxis,
              position: sketchDetails.origin,
              sketchNodePaths: sketchDetails.sketchNodePaths,
              planeNodePath: sketchDetails.planeNodePath,
            })
            return undefined
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
