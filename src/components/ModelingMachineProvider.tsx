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
import { useHotkeys } from 'react-hotkeys-hook'
import { applyConstraintHorzVertDistance } from './Toolbar/SetHorzVertDistance'
import {
  angleBetweenInfo,
  applyConstraintAngleBetween,
} from './Toolbar/SetAngleBetween'
import { applyConstraintAngleLength } from './Toolbar/setAngleLength'
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
} from 'clientSideScene/sceneEntities'
import {
  moveValueIntoNewVariablePath,
  sketchOnExtrudedFace,
  startSketchOnDefault,
} from 'lang/modifyAst'
import { Program, VariableDeclaration, parse, recast } from 'lang/wasm'
import {
  getNodeFromPath,
  getNodePathFromSourceRange,
  hasExtrudableGeometry,
  isSingleCursorInPipe,
} from 'lang/queryAst'
import { TEST } from 'env'
import { exportFromEngine } from 'lib/exportFromEngine'
import { Models } from '@kittycad/lib/dist/types/src'
import toast from 'react-hot-toast'
import { EditorSelection, Transaction } from '@uiw/react-codemirror'
import { useSearchParams } from 'react-router-dom'
import { letEngineAnimateAndSyncCamAfter } from 'clientSideScene/CameraControls'
import { getVarNameModal } from 'hooks/useToolbarGuards'
import { uuidv4 } from 'lib/utils'
import { err, trap } from 'lib/trap'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { modelingMachineEvent } from 'editor/manager'

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
        modeling: { defaultUnit, highlightEdges, showScaleGrid },
      },
    },
  } = useSettingsAuthContext()
  const token = auth?.context?.token
  const streamRef = useRef<HTMLDivElement>(null)

  let [searchParams] = useSearchParams()
  const pool = searchParams.get('pool')

  const { commandBarState } = useCommandsContext()

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
        'disable copilot': () => {
          editorManager.setCopilotEnabled(false)
        },
        'enable copilot': () => {
          editorManager.setCopilotEnabled(true)
        },
        'sketch exit execute': ({ store }) => {
          ;(async () => {
            await sceneInfra.camControls.snapToPerspectiveBeforeHandingBackControlToEngine()

            sceneInfra.camControls.syncDirection = 'engineToClient'

            const settings: Models['CameraSettings_type'] = (
              await engineCommandManager.sendSceneCommand({
                type: 'modeling_cmd_req',
                cmd_id: uuidv4(),
                cmd: {
                  type: 'default_camera_get_settings',
                },
              })
            )?.data?.data?.settings
            if (settings.up.z !== 1) {
              // workaround for gimbal lock situation
              await engineCommandManager.sendSceneCommand({
                type: 'modeling_cmd_req',
                cmd_id: uuidv4(),
                cmd: {
                  type: 'default_camera_look_at',
                  center: settings.center,
                  vantage: {
                    ...settings.pos,
                    y:
                      settings.pos.y +
                      (settings.center.z - settings.pos.z > 0 ? 2 : -2),
                  },
                  up: { x: 0, y: 0, z: 1 },
                },
              })
            }

            store.videoElement.pause()
            kclManager.executeCode(true).then(() => {
              store.videoElement.play()
            })
          })()
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
              if (!parent || !pathToNode) return segmentHoverMap
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
        'Set selection': assign(({ selectionRanges, sketchDetails }, event) => {
          const setSelections = event.data as SetSelections // this was needed for ts after adding 'Set selection' action to on done modal events
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
        }),
        'Engine export': async (_, event) => {
          if (event.type !== 'Export' || TEST) return
          console.log('exporting', event.data)
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

          toast.promise(
            exportFromEngine({
              format: format as Models['OutputFormat_type'],
            }),
            {
              loading: 'Exporting...',
              success: 'Exported successfully',
              error: 'Error while exporting',
            }
          )
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
          ) {
            // they have no selection, we should enable the button
            // so they can select the face through the cmdbar
            // BUT only if there's extrudable geometry
            if (hasExtrudableGeometry(kclManager.ast)) return true
            return false
          }
          if (!isPipe) return false

          return canExtrudeSelection(selectionRanges)
        },
        'has valid selection for deletion': ({ selectionRanges }) => {
          if (!commandBarState.matches('Closed')) return false
          if (selectionRanges.codeBasedSelections.length <= 0) return false
          return true
        },
        'Sketch is empty': ({ sketchDetails }) => {
          const node = getNodeFromPath<VariableDeclaration>(
            kclManager.ast,
            sketchDetails?.sketchPathToNode || [],
            'VariableDeclaration'
          )
          // This should not be returning false, and it should be caught
          // but we need to simulate old behavior to move on.
          if (err(node)) return false
          return node.node?.declarations?.[0]?.init.type !== 'PipeExpression'
        },
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
          if (kclManager.ast.body.length) {
            // this assumes no changes have been made to the sketch besides what we did when entering the sketch
            // i.e. doesn't account for user's adding code themselves, maybe we need store a flag userEditedSinceSketchMode?
            const newAst: Program = JSON.parse(JSON.stringify(kclManager.ast))
            const varDecIndex = sketchDetails.sketchPathToNode[1][0]
            // remove body item at varDecIndex
            newAst.body = newAst.body.filter((_, i) => i !== varDecIndex)
            await kclManager.executeAstMock(newAst)
          }
          sceneInfra.setCallbacks({
            onClick: () => {},
            onDrag: () => {},
          })
        },
        'animate-to-face': async (_, { data }) => {
          if (data.type === 'extrudeFace') {
            const sketched = sketchOnExtrudedFace(
              kclManager.ast,
              data.sketchPathToNode,
              data.extrudePathToNode,
              kclManager.programMemory,
              data.cap
            )
            if (trap(sketched)) return Promise.reject(sketched)
            const { modifiedAst, pathToNode: pathToNewSketchNode } = sketched

            await kclManager.executeAstMock(modifiedAst)

            await letEngineAnimateAndSyncCamAfter(
              engineCommandManager,
              data.faceId
            )
            sceneInfra.camControls.syncDirection = 'clientToEngine'
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

          await letEngineAnimateAndSyncCamAfter(
            engineCommandManager,
            data.planeId
          )

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
          sketchDetails,
        }): Promise<SetSelections> => {
          const { modifiedAst, pathToNodeMap } =
            await applyConstraintHorzVertDistance({
              constraint: 'setHorzDistance',
              selectionRanges,
            })
          const _modifiedAst = parse(recast(modifiedAst))
          if (!sketchDetails)
            return Promise.reject(new Error('No sketch details'))
          const updatedPathToNode = updatePathToNodeFromMap(
            sketchDetails.sketchPathToNode,
            pathToNodeMap
          )
          const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
            updatedPathToNode,
            _modifiedAst,
            sketchDetails.zAxis,
            sketchDetails.yAxis,
            sketchDetails.origin
          )
          if (err(updatedAst)) return Promise.reject(updatedAst)
          const selection = updateSelections(
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
        },
        'Get vertical info': async ({
          selectionRanges,
          sketchDetails,
        }): Promise<SetSelections> => {
          const { modifiedAst, pathToNodeMap } =
            await applyConstraintHorzVertDistance({
              constraint: 'setVertDistance',
              selectionRanges,
            })
          const _modifiedAst = parse(recast(modifiedAst))
          if (!sketchDetails)
            return Promise.reject(new Error('No sketch details'))
          const updatedPathToNode = updatePathToNodeFromMap(
            sketchDetails.sketchPathToNode,
            pathToNodeMap
          )
          const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
            updatedPathToNode,
            _modifiedAst,
            sketchDetails.zAxis,
            sketchDetails.yAxis,
            sketchDetails.origin
          )
          if (err(updatedAst)) return Promise.reject(updatedAst)
          const selection = updateSelections(
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
        },
        'Get angle info': async ({
          selectionRanges,
          sketchDetails,
        }): Promise<SetSelections> => {
          const info = angleBetweenInfo({
            selectionRanges,
          })
          if (err(info)) return Promise.reject(info)
          const { modifiedAst, pathToNodeMap } = await (info.enabled
            ? applyConstraintAngleBetween({
                selectionRanges,
              })
            : applyConstraintAngleLength({
                selectionRanges,
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
          const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
            updatedPathToNode,
            _modifiedAst,
            sketchDetails.zAxis,
            sketchDetails.yAxis,
            sketchDetails.origin
          )
          if (err(updatedAst)) return Promise.reject(updatedAst)
          const selection = updateSelections(
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
        },
        'Get length info': async ({
          selectionRanges,
          sketchDetails,
        }): Promise<SetSelections> => {
          const { modifiedAst, pathToNodeMap } =
            await applyConstraintAngleLength({ selectionRanges })
          const _modifiedAst = parse(recast(modifiedAst))
          if (!sketchDetails)
            return Promise.reject(new Error('No sketch details'))
          const updatedPathToNode = updatePathToNodeFromMap(
            sketchDetails.sketchPathToNode,
            pathToNodeMap
          )
          const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
            updatedPathToNode,
            _modifiedAst,
            sketchDetails.zAxis,
            sketchDetails.yAxis,
            sketchDetails.origin
          )
          if (err(updatedAst)) return Promise.reject(updatedAst)
          const selection = updateSelections(
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
        },
        'Get perpendicular distance info': async ({
          selectionRanges,
          sketchDetails,
        }): Promise<SetSelections> => {
          const { modifiedAst, pathToNodeMap } = await applyConstraintIntersect(
            {
              selectionRanges,
            }
          )
          const _modifiedAst = parse(recast(modifiedAst))
          if (!sketchDetails)
            return Promise.reject(new Error('No sketch details'))
          const updatedPathToNode = updatePathToNodeFromMap(
            sketchDetails.sketchPathToNode,
            pathToNodeMap
          )
          const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
            updatedPathToNode,
            _modifiedAst,
            sketchDetails.zAxis,
            sketchDetails.yAxis,
            sketchDetails.origin
          )
          if (err(updatedAst)) return Promise.reject(updatedAst)
          const selection = updateSelections(
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
        },
        'Get ABS X info': async ({
          selectionRanges,
          sketchDetails,
        }): Promise<SetSelections> => {
          const { modifiedAst, pathToNodeMap } =
            await applyConstraintAbsDistance({
              constraint: 'xAbs',
              selectionRanges,
            })
          const _modifiedAst = parse(recast(modifiedAst))
          if (!sketchDetails)
            return Promise.reject(new Error('No sketch details'))
          const updatedPathToNode = updatePathToNodeFromMap(
            sketchDetails.sketchPathToNode,
            pathToNodeMap
          )
          const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
            updatedPathToNode,
            _modifiedAst,
            sketchDetails.zAxis,
            sketchDetails.yAxis,
            sketchDetails.origin
          )
          if (err(updatedAst)) return Promise.reject(updatedAst)
          const selection = updateSelections(
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
        },
        'Get ABS Y info': async ({
          selectionRanges,
          sketchDetails,
        }): Promise<SetSelections> => {
          const { modifiedAst, pathToNodeMap } =
            await applyConstraintAbsDistance({
              constraint: 'yAbs',
              selectionRanges,
            })
          const _modifiedAst = parse(recast(modifiedAst))
          if (!sketchDetails)
            return Promise.reject(new Error('No sketch details'))
          const updatedPathToNode = updatePathToNodeFromMap(
            sketchDetails.sketchPathToNode,
            pathToNodeMap
          )
          const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
            updatedPathToNode,
            _modifiedAst,
            sketchDetails.zAxis,
            sketchDetails.yAxis,
            sketchDetails.origin
          )
          if (err(updatedAst)) return Promise.reject(updatedAst)
          const selection = updateSelections(
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
        },
        'Get convert to variable info': async (
          { sketchDetails, selectionRanges },
          { data }
        ): Promise<SetSelections> => {
          if (!sketchDetails)
            return Promise.reject(new Error('No sketch details'))
          const { variableName } = await getVarNameModal({
            valueName: data.variableName || 'var',
          })
          let parsed = parse(recast(kclManager.ast))
          if (trap(parsed)) return Promise.reject(parsed)
          parsed = parsed as Program

          const { modifiedAst: _modifiedAst, pathToReplacedNode } =
            moveValueIntoNewVariablePath(
              parsed,
              kclManager.programMemory,
              data.pathToNode,
              variableName
            )
          parsed = parse(recast(_modifiedAst))
          if (trap(parsed)) return Promise.reject(parsed)
          parsed = parsed as Program
          if (!pathToReplacedNode)
            return Promise.reject(new Error('No path to replaced node'))

          const updatedAst = await sceneEntitiesManager.updateAstAndRejigSketch(
            pathToReplacedNode || [],
            parsed,
            sketchDetails.zAxis,
            sketchDetails.yAxis,
            sketchDetails.origin
          )
          if (err(updatedAst)) return Promise.reject(updatedAst)
          const selection = updateSelections(
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
        },
      },
      devTools: true,
    }
  )

  useSetupEngineManager(streamRef, token, {
    pool: pool,
    theme: theme.current,
    highlightEdges: highlightEdges.current,
    enableSSAO: enableSSAO.current,
    modelingSend,
    modelingContext: modelingState.context,
    showScaleGrid: showScaleGrid.current,
  })

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

  // Allow using the delete key to delete solids
  useHotkeys(['backspace', 'delete', 'del'], () => {
    modelingSend({ type: 'Delete selection' })
  })

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
