import { useMachine, useSelector } from '@xstate/react'
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import toast from 'react-hot-toast'
import { useHotkeys } from 'react-hotkeys-hook'
import { useLoaderData } from 'react-router-dom'
import type { Actor, ContextFrom, Prop, SnapshotFrom, StateFrom } from 'xstate'
import { assign, fromPromise } from 'xstate'

import type { OutputFormat3d } from '@rust/kcl-lib/bindings/ModelingCmd'
import type { Node } from '@rust/kcl-lib/bindings/Node'

import { useAppState } from '@src/AppState'
import { letEngineAnimateAndSyncCamAfter } from '@src/clientSideScene/CameraControls'
import {
  applyConstraintAngleLength,
  applyConstraintLength,
} from '@src/components/Toolbar/setAngleLength'
import {
  SEGMENT_BODIES_PLUS_PROFILE_START,
  getParentGroup,
} from '@src/clientSideScene/sceneConstants'
import { useFileContext } from '@src/hooks/useFileContext'
import {
  useMenuListener,
  useSketchModeMenuEnableDisable,
} from '@src/hooks/useMenu'
import useModelingMachineCommands from '@src/hooks/useStateMachineCommands'
import { useKclContext } from '@src/lang/KclProvider'
import { updateModelingState } from '@src/lang/modelingWorkflows'
import {
  sketchOnExtrudedFace,
  sketchOnOffsetPlane,
  splitPipedProfile,
  startSketchOnDefault,
} from '@src/lang/modifyAst'
import {
  doesSketchPipeNeedSplitting,
  getNodeFromPath,
  traverse,
} from '@src/lang/queryAst'
import {
  EngineConnectionStateType,
  EngineConnectionEvents,
} from '@src/lang/std/engineConnection'
import { err, reportRejection, trap, reject } from '@src/lib/trap'
import { isNonNullable, platform, uuidv4 } from '@src/lib/utils'
import { promptToEditFlow } from '@src/lib/promptToEdit'
import type { FileMeta } from '@src/lib/types'
import { commandBarActor } from '@src/lib/singletons'
import { useToken, useSettings } from '@src/lib/singletons'
import type { IndexLoaderData } from '@src/lib/types'
import {
  EXPORT_TOAST_MESSAGES,
  MAKE_TOAST_MESSAGES,
  EXECUTION_TYPE_MOCK,
  FILE_EXT,
  PROJECT_ENTRYPOINT,
} from '@src/lib/constants'
import { exportMake } from '@src/lib/exportMake'
import { exportSave } from '@src/lib/exportSave'
import { isDesktop } from '@src/lib/isDesktop'
import type { FileEntry } from '@src/lib/project'
import type { WebContentSendPayload } from '@src/menu/channels'
import {
  getPersistedContext,
  modelingMachine,
  modelingMachineDefaultContext,
} from '@src/machines/modelingMachine'
import {
  codeManager,
  editorManager,
  engineCommandManager,
  kclManager,
  rustContext,
  sceneEntitiesManager,
  sceneInfra,
} from '@src/lib/singletons'
import type { MachineManager } from '@src/components/MachineManagerProvider'
import { MachineManagerContext } from '@src/components/MachineManagerProvider'
import { updateSelections } from '@src/lib/selections'
import { updateSketchDetailsNodePaths } from '@src/lang/util'
import {
  modelingMachineCommandConfig,
  type ModelingCommandSchema,
} from '@src/lib/commandBarConfigs/modelingCommandConfig'
import type {
  PipeExpression,
  Program,
  VariableDeclaration,
} from '@src/lang/wasm'
import { parse, recast, resultIsOk } from '@src/lang/wasm'
import { applyConstraintHorzVertDistance } from '@src/components/Toolbar/SetHorzVertDistance'
import {
  angleBetweenInfo,
  applyConstraintAngleBetween,
} from '@src/components/Toolbar/SetAngleBetween'
import { applyConstraintIntersect } from '@src/components/Toolbar/Intersect'
import { applyConstraintAbsDistance } from '@src/components/Toolbar/SetAbsDistance'
import type { SidebarType } from '@src/components/ModelingSidebar/ModelingPanes'
import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'

const OVERLAY_TIMEOUT_MS = 1_000

export const ModelingMachineContext = createContext(
  {} as {
    state: StateFrom<typeof modelingMachine>
    context: ContextFrom<typeof modelingMachine>
    send: Prop<Actor<typeof modelingMachine>, 'send'>
  }
)

const commandBarIsClosedSelector = (
  state: SnapshotFrom<typeof commandBarActor>
) => state.matches('Closed')

export const ModelingMachineProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const {
    app: { allowOrbitInSketchMode },
    modeling: { defaultUnit, cameraProjection, cameraOrbit },
  } = useSettings()
  const { context } = useFileContext()
  const { file } = useLoaderData() as IndexLoaderData
  const token = useToken()
  const streamRef = useRef<HTMLDivElement>(null)
  const persistedContext = useMemo(() => getPersistedContext(), [])

  const isCommandBarClosed = useSelector(
    commandBarActor,
    commandBarIsClosedSelector
  )

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
        'Set mouse state': assign(({ context, event }) => {
          if (event.type !== 'Set mouse state') return {}
          const nextSegmentHoverMap = () => {
            if (event.data.type === 'isHovering') {
              const parent = getParentGroup(
                event.data.on,
                SEGMENT_BODIES_PLUS_PROFILE_START
              )
              const pathToNode = parent?.userData?.pathToNode
              const pathToNodeString = JSON.stringify(pathToNode)
              if (!parent || !pathToNode) return context.segmentHoverMap
              if (context.segmentHoverMap[pathToNodeString] !== undefined)
                clearTimeout(context.segmentHoverMap[pathToNodeString])
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
                SEGMENT_BODIES_PLUS_PROFILE_START
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
              }, OVERLAY_TIMEOUT_MS) as unknown as number
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
            if (event.data.type === 'set-many') {
              return {
                ...event.data.overlays,
              }
            }
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
                camera_movement: 'vantage',
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
      },
      guards: {
        'has valid selection for deletion': ({
          context: { selectionRanges },
        }) => {
          if (!isCommandBarClosed) return false
          if (selectionRanges.graphSelections.length <= 0) return false
          return true
        },
        'Has exportable geometry': () =>
          !kclManager.hasErrors() && kclManager.ast.body.length > 0,
      },
      actors: {
        exportFromEngine: fromPromise(
          async ({ input }: { input?: ModelingCommandSchema['Export'] }) => {
            if (kclManager.hasErrors() || kclManager.ast.body.length === 0) {
              let errorMessage = 'Unable to Export '
              if (kclManager.hasErrors()) {
                errorMessage += 'due to KCL Errors'
              } else if (kclManager.ast.body.length === 0) {
                errorMessage += 'due to Empty Scene'
              }
              console.error(errorMessage)
              toast.error(errorMessage)
              return new Error(errorMessage)
            } else if (!input) {
              return new Error('No input provided')
            }

            let fileName = file?.name?.replace('.kcl', `.${input.type}`) || ''
            // Ensure the file has an extension.
            if (!fileName.includes('.')) {
              fileName += `.${input.type}`
            }

            const format = {
              ...input,
            } as Partial<OutputFormat3d>

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

            const toastId = toast.loading(EXPORT_TOAST_MESSAGES.START)
            const files = await rustContext.export(
              format,
              {
                settings: { modeling: { base_unit: defaultUnit.current } },
              },
              toastId
            )

            if (files === undefined) {
              // We already sent the toast message in the export function.
              return
            }

            await exportSave({ files, toastId, fileName })
          }
        ),
        makeFromEngine: fromPromise(
          async ({
            input,
          }: {
            input?: {
              machineManager: MachineManager
            } & ModelingCommandSchema['Make']
          }) => {
            if (input === undefined) {
              return new Error('No input provided')
            }

            const name = file?.name || ''

            // Set the current machine.
            // Due to our use of singeton pattern, we need to do this to reliably
            // update this object across React and non-React boundary.
            // We need to do this eagerly because of the exportToEngine call below.
            if (engineCommandManager.machineManager === null) {
              console.warn(
                "engineCommandManager.machineManager is null. It shouldn't be at this point. Aborting operation."
              )
              return new Error('Machine manager is not set')
            } else {
              engineCommandManager.machineManager.currentMachine = input.machine
            }

            // Update the rest of the UI that needs to know the current machine
            input.machineManager.setCurrentMachine(input.machine)

            const format: OutputFormat3d = {
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

            const toastId = toast.loading(MAKE_TOAST_MESSAGES.START)
            const files = await rustContext.export(
              format,
              {
                settings: { modeling: { base_unit: 'mm' } },
              },
              toastId
            )

            if (files === undefined) {
              // We already sent the toast message in the export function.
              return
            }

            await exportMake({
              files,
              toastId,
              name,
              machineManager: engineCommandManager.machineManager,
            })
          }
        ),
        'AST-undo-startSketchOn': fromPromise(
          async ({ input: { sketchDetails } }) => {
            if (!sketchDetails) return
            if (kclManager.ast.body.length) {
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
              const isInitAPipe =
                varDec.node.declaration.init.type === 'PipeExpression'
              if (isInitAPipe) {
                isIdentifierUsed = true
              } else {
                traverse(newAst, {
                  enter: (node) => {
                    if (
                      node.type === 'Name' &&
                      node.name.name === variableName
                    ) {
                      isIdentifierUsed = true
                    }
                  },
                })
              }
              if (isIdentifierUsed) return

              // remove body item at varDecIndex
              newAst.body = newAst.body.filter((_, i) => i !== varDecIndex)
              const didReParse = await kclManager.executeAstMock(newAst)
              if (err(didReParse)) return reject(didReParse)
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
            const originalCode = codeManager.code
            const sketched =
              input.type === 'extrudeFace'
                ? sketchOnExtrudedFace(
                    kclManager.ast,
                    input.sketchPathToNode,
                    input.extrudePathToNode,
                    input.faceInfo
                  )
                : sketchOnOffsetPlane(
                    kclManager.ast,
                    input.pathToNode,
                    input.negated
                  )
            if (err(sketched)) {
              const sketchedError = new Error(
                'Incompatible face, please try another'
              )
              trap(sketchedError)
              return Promise.reject(sketchedError)
            }
            const { modifiedAst, pathToNode: pathToNewSketchNode } = sketched

            const didReParse = await kclManager.executeAstMock(modifiedAst)
            if (err(didReParse)) {
              // there was a problem, restore the original code
              codeManager.code = originalCode
              await kclManager.executeCode()
              return reject(didReParse)
            }

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
          sceneInfra.camControls.enableRotate =
            sceneInfra.camControls._setting_allowOrbitInSketchMode
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
            animateTargetId: input.planeId,
          }
        }),
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
        'set-up-draft-circle': fromPromise(
          async ({ input: { sketchDetails, data } }) => {
            if (!sketchDetails || !data)
              return reject('No sketch details or data')

            const result = await sceneEntitiesManager.setupDraftCircle(
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
        'set-up-draft-circle-three-point': fromPromise(
          async ({ input: { sketchDetails, data } }) => {
            if (!sketchDetails || !data)
              return reject('No sketch details or data')

            const result =
              await sceneEntitiesManager.setupDraftCircleThreePoint(
                sketchDetails.sketchNodePaths,
                sketchDetails.planeNodePath,
                sketchDetails.zAxis,
                sketchDetails.yAxis,
                sketchDetails.origin,
                data.p1,
                data.p2
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

            const result = await sceneEntitiesManager.setupDraftRectangle(
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
            const result = await sceneEntitiesManager.setupDraftCenterRectangle(
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
        'set-up-draft-arc-three-point': fromPromise(
          async ({ input: { sketchDetails, data } }) => {
            if (!sketchDetails || !data)
              return reject('No sketch details or data')
            const result = await sceneEntitiesManager.setupDraftArcThreePoint(
              sketchDetails.sketchEntryNodePath,
              sketchDetails.sketchNodePaths,
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
        'set-up-draft-arc': fromPromise(
          async ({ input: { sketchDetails, data } }) => {
            if (!sketchDetails || !data)
              return reject('No sketch details or data')
            const result = await sceneEntitiesManager.setupDraftArc(
              sketchDetails.sketchEntryNodePath,
              sketchDetails.sketchNodePaths,
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
        'split-sketch-pipe-if-needed': fromPromise(
          async ({ input: { sketchDetails } }) => {
            if (!sketchDetails) return reject('No sketch details')
            const existingSketchInfoNoOp = {
              updatedEntryNodePath: sketchDetails.sketchEntryNodePath,
              updatedSketchNodePaths: sketchDetails.sketchNodePaths,
              updatedPlaneNodePath: sketchDetails.planeNodePath,
              expressionIndexToDelete: -1,
            } as const
            if (!sketchDetails?.sketchEntryNodePath?.length) {
              return existingSketchInfoNoOp
            }
            if (
              !sketchDetails.sketchNodePaths.length &&
              sketchDetails.planeNodePath.length
            ) {
              // new sketch, no profiles yet
              return existingSketchInfoNoOp
            }
            const doesNeedSplitting = doesSketchPipeNeedSplitting(
              kclManager.ast,
              sketchDetails.sketchEntryNodePath
            )
            if (err(doesNeedSplitting)) return reject(doesNeedSplitting)
            let moddedAst: Node<Program> = structuredClone(kclManager.ast)
            let pathToProfile = sketchDetails.sketchEntryNodePath
            let updatedSketchNodePaths = sketchDetails.sketchNodePaths
            if (doesNeedSplitting) {
              const splitResult = splitPipedProfile(
                moddedAst,
                sketchDetails.sketchEntryNodePath
              )
              if (err(splitResult)) return reject(splitResult)
              moddedAst = splitResult.modifiedAst
              pathToProfile = splitResult.pathToProfile
              updatedSketchNodePaths = [pathToProfile]
            }

            const indexToDelete = sketchDetails?.expressionIndexToDelete || -1
            let isLastInPipeThreePointArc = false
            if (indexToDelete >= 0) {
              // this is the expression that was added when as sketch tool was used but not completed
              // i.e first click for the center of the circle, but not the second click for the radius
              // we added a circle to editor, but they bailed out early so we should remove it

              const pipe = getNodeFromPath<PipeExpression>(
                moddedAst,
                pathToProfile,
                'PipeExpression'
              )
              if (err(pipe)) {
                isLastInPipeThreePointArc = false
              } else {
                const lastInPipe = pipe?.node?.body?.[pipe.node.body.length - 1]
                if (
                  lastInPipe &&
                  Number(pathToProfile[1][0]) === indexToDelete &&
                  lastInPipe.type === 'CallExpressionKw' &&
                  lastInPipe.callee.type === 'Name' &&
                  lastInPipe.callee.name.name === 'arcTo'
                ) {
                  isLastInPipeThreePointArc = true
                  pipe.node.body = pipe.node.body.slice(0, -1)
                }
              }

              if (!isLastInPipeThreePointArc) {
                moddedAst.body.splice(indexToDelete, 1)
                // make sure the deleted expression is removed from the sketchNodePaths
                updatedSketchNodePaths = updatedSketchNodePaths.filter(
                  (path) => path[1][0] !== indexToDelete
                )
                // if the deleted expression was the entryNodePath, we should just make it the first sketchNodePath
                // as a safe default
                pathToProfile =
                  pathToProfile[1][0] !== indexToDelete
                    ? pathToProfile
                    : updatedSketchNodePaths[0]
              }
            }

            if (
              doesNeedSplitting ||
              indexToDelete >= 0 ||
              isLastInPipeThreePointArc
            ) {
              await updateModelingState(moddedAst, EXECUTION_TYPE_MOCK, {
                kclManager,
                editorManager,
                codeManager,
              })
            }
            return {
              updatedEntryNodePath: pathToProfile,
              updatedSketchNodePaths: updatedSketchNodePaths,
              updatedPlaneNodePath: sketchDetails.planeNodePath,
              expressionIndexToDelete: -1,
            }
          }
        ),
        'submit-prompt-edit': fromPromise(async ({ input }) => {
          let projectFiles: FileMeta[] = [
            {
              type: 'kcl',
              relPath: 'main.kcl',
              absPath: 'main.kcl',
              fileContents: codeManager.code,
              execStateFileNamesIndex: 0,
            },
          ]
          const execStateNameToIndexMap: { [fileName: string]: number } = {}
          Object.entries(kclManager.execState.filenames).forEach(
            ([index, val]) => {
              if (val?.type === 'Local') {
                execStateNameToIndexMap[val.value] = Number(index)
              }
            }
          )
          let basePath = ''
          if (isDesktop() && context?.project?.children) {
            // Use the entire project directory as the basePath for prompt to edit, do not use relative subdir paths
            basePath = context?.project?.path
            const filePromises: Promise<FileMeta | null>[] = []
            let uploadSize = 0
            const recursivelyPushFilePromises = (files: FileEntry[]) => {
              // mutates filePromises declared above, so this function definition should stay here
              // if pulled out, it would need to be refactored.
              for (const file of files) {
                if (file.children !== null) {
                  // is directory
                  recursivelyPushFilePromises(file.children)
                  continue
                }

                const absolutePathToFileNameWithExtension = file.path
                const fileNameWithExtension = window.electron.path.relative(
                  basePath,
                  absolutePathToFileNameWithExtension
                )

                const filePromise = window.electron
                  .readFile(absolutePathToFileNameWithExtension)
                  .then((file): FileMeta => {
                    uploadSize += file.byteLength
                    const decoder = new TextDecoder('utf-8')
                    const fileType = window.electron.path.extname(
                      absolutePathToFileNameWithExtension
                    )
                    if (fileType === FILE_EXT) {
                      return {
                        type: 'kcl',
                        absPath: absolutePathToFileNameWithExtension,
                        relPath: fileNameWithExtension,
                        fileContents: decoder.decode(file),
                        execStateFileNamesIndex:
                          execStateNameToIndexMap[
                            absolutePathToFileNameWithExtension
                          ],
                      }
                    }
                    const blob = new Blob([file], {
                      type: 'application/octet-stream',
                    })
                    return {
                      type: 'other',
                      relPath: fileNameWithExtension,
                      data: blob,
                    }
                  })
                  .catch((e) => {
                    console.error('error reading file', e)
                    return null
                  })

                filePromises.push(filePromise)
              }
            }
            recursivelyPushFilePromises(context?.project?.children)
            projectFiles = (await Promise.all(filePromises)).filter(
              isNonNullable
            )
            const MB20 = 2 ** 20 * 20
            if (uploadSize > MB20) {
              toast.error(
                'Your project exceeds 20Mb, this will slow down Text-to-CAD\nPlease remove any unnecessary files'
              )
            }
          }
          // route to main.kcl by default for web and desktop
          let filePath: string = PROJECT_ENTRYPOINT
          const possibleFileName = file?.path
          if (possibleFileName && isDesktop()) {
            // When prompt to edit finishes, try to route to the file they were in otherwise go to main.kcl
            filePath = window.electron.path.relative(basePath, possibleFileName)
          }
          return await promptToEditFlow({
            projectFiles,
            prompt: input.prompt,
            selections: input.selection,
            token,
            artifactGraph: kclManager.artifactGraph,
            projectName: context.project.name,
            filePath,
          })
        }),
      },
    }),
    {
      input: {
        ...modelingMachineDefaultContext,
        store: {
          ...modelingMachineDefaultContext.store,
          ...persistedContext,
          cameraProjection,
        },
        machineManager,
      },
      // devTools: true,
    }
  )

  // Register file menu actions based off modeling send
  const cb = (data: WebContentSendPayload) => {
    const openPanes = modelingActor.getSnapshot().context.store.openPanes
    if (data.menuLabel === 'View.Panes.Feature tree') {
      const featureTree: SidebarType = 'feature-tree'
      const alwaysAddFeatureTree: SidebarType[] = [
        ...new Set([...openPanes, featureTree]),
      ]
      modelingSend({
        type: 'Set context',
        data: {
          openPanes: alwaysAddFeatureTree,
        },
      })
    } else if (data.menuLabel === 'View.Panes.KCL code') {
      const code: SidebarType = 'code'
      const alwaysAddCode: SidebarType[] = [...new Set([...openPanes, code])]
      modelingSend({
        type: 'Set context',
        data: {
          openPanes: alwaysAddCode,
        },
      })
    } else if (data.menuLabel === 'View.Panes.Project files') {
      const projectFiles: SidebarType = 'files'
      const alwaysAddProjectFiles: SidebarType[] = [
        ...new Set([...openPanes, projectFiles]),
      ]
      modelingSend({
        type: 'Set context',
        data: {
          openPanes: alwaysAddProjectFiles,
        },
      })
    } else if (data.menuLabel === 'View.Panes.Variables') {
      const variables: SidebarType = 'variables'
      const alwaysAddVariables: SidebarType[] = [
        ...new Set([...openPanes, variables]),
      ]
      modelingSend({
        type: 'Set context',
        data: {
          openPanes: alwaysAddVariables,
        },
      })
    } else if (data.menuLabel === 'View.Panes.Logs') {
      const logs: SidebarType = 'logs'
      const alwaysAddLogs: SidebarType[] = [...new Set([...openPanes, logs])]
      modelingSend({
        type: 'Set context',
        data: {
          openPanes: alwaysAddLogs,
        },
      })
    } else if (data.menuLabel === 'Design.Start sketch') {
      modelingSend({
        type: 'Enter sketch',
        data: { forceNewSketch: true },
      })
    }
  }
  useMenuListener(cb)

  const { overallState } = useNetworkContext()
  const { isExecuting } = useKclContext()
  const { isStreamReady } = useAppState()

  // Assumes all commands are network commands
  useSketchModeMenuEnableDisable(
    modelingState.context.currentMode,
    overallState,
    isExecuting,
    isStreamReady,
    [
      { menuLabel: 'Edit.Modify with Zoo Text-To-CAD' },
      { menuLabel: 'View.Standard views' },
      { menuLabel: 'View.Named views' },
      { menuLabel: 'Design.Start sketch' },
      {
        menuLabel: 'Design.Create an offset plane',
        commandName: 'Offset plane',
        groupId: 'modeling',
      },
      {
        menuLabel: 'Design.Create a helix',
        commandName: 'Helix',
        groupId: 'modeling',
      },
      {
        menuLabel: 'Design.Create an additive feature.Extrude',
        commandName: 'Extrude',
        groupId: 'modeling',
      },
      {
        menuLabel: 'Design.Create an additive feature.Revolve',
        commandName: 'Revolve',
        groupId: 'modeling',
      },
      {
        menuLabel: 'Design.Create an additive feature.Sweep',
        commandName: 'Sweep',
        groupId: 'modeling',
      },
      {
        menuLabel: 'Design.Create an additive feature.Loft',
        commandName: 'Loft',
        groupId: 'modeling',
      },
      {
        menuLabel: 'Design.Apply modification feature.Fillet',
        commandName: 'Fillet',
        groupId: 'modeling',
      },
      {
        menuLabel: 'Design.Apply modification feature.Chamfer',
        commandName: 'Chamfer',
        groupId: 'modeling',
      },
      {
        menuLabel: 'Design.Apply modification feature.Shell',
        commandName: 'Shell',
        groupId: 'modeling',
      },
      {
        menuLabel: 'Design.Modify with Zoo Text-To-CAD',
        commandName: 'Prompt-to-edit',
        groupId: 'modeling',
      },
    ]
  )

  // Add debug function to window object
  useEffect(() => {
    // @ts-ignore - we're intentionally adding this to window
    window.getModelingState = () => {
      const modelingState = modelingActor.getSnapshot()
      return {
        modelingState,
        id: modelingState._nodes[modelingState._nodes.length - 1].id,
      }
    }
  }, [modelingActor])

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

  // When changing camera modes reset the camera to the default orientation to correct
  // the up vector otherwise the conconical orientation for the camera modes will be
  // wrong
  useEffect(() => {
    sceneInfra.camControls.resetCameraPosition().catch(reportRejection)
  }, [cameraOrbit.current])

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

  useEffect(() => {
    const inSketchMode = modelingState.matches('Sketch')

    // If you are in sketch mode and you disable the orbit, return back to the normal view to the target
    if (!allowOrbitInSketchMode.current) {
      const targetId = modelingState.context.sketchDetails?.animateTargetId
      if (inSketchMode && targetId) {
        letEngineAnimateAndSyncCamAfter(engineCommandManager, targetId)
          .then(() => {})
          .catch((e) => {
            console.error(
              'failed to sync engine and client scene after disabling allow orbit in sketch mode'
            )
            console.error(e)
          })
      }
    }

    // While you are in sketch mode you should be able to control the enable rotate
    // Once you exit it goes back to normal
    if (inSketchMode) {
      sceneInfra.camControls.enableRotate = allowOrbitInSketchMode.current
    }
  }, [allowOrbitInSketchMode.current])

  // Allow using the delete key to delete solids. Backspace only on macOS as Windows and Linux have dedicated Delete
  // `navigator.platform` is deprecated, but the alternative `navigator.userAgentData.platform` is not reliable
  const deleteKeys =
    platform() === 'macos' ? ['backspace', 'delete', 'del'] : ['delete', 'del']

  useHotkeys(deleteKeys, () => {
    // When the current selection is a segment, delete that directly ('Delete selection' doesn't support it)
    const segmentNodePaths = Object.keys(modelingState.context.segmentOverlays)
    const selections =
      modelingState.context.selectionRanges.graphSelections.filter((sel) =>
        segmentNodePaths.includes(JSON.stringify(sel.codeRef.pathToNode))
      )
    selections.forEach((selection) => {
      modelingSend({
        type: 'Delete segment',
        data: selection.codeRef.pathToNode,
      })
    })
    if (
      modelingState.context.selectionRanges.graphSelections.length >
      selections.length
    ) {
      // Not all selection were segments -> keep the default delete behavior
      modelingSend({ type: 'Delete selection' })
    }
  })

  // Allow ctrl+alt+c to center to selection
  useHotkeys(['mod + alt + c'], () => {
    modelingSend({ type: 'Center camera on selection' })
  })
  useHotkeys(['mod + alt + x'], () => {
    resetCameraPosition().catch(reportRejection)
  })

  useModelingMachineCommands({
    machineId: 'modeling',
    state: modelingState,
    send: modelingSend,
    actor: modelingActor,
    commandBarConfig: modelingMachineCommandConfig,
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
