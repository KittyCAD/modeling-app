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
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'
import { isCursorInSketchCommandRange } from 'lang/util'
import { engineCommandManager } from 'lang/std/engineConnection'
import { kclManager, useKclContext } from 'lang/KclSingleton'
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
  codeToIdSelections,
  handleSelectionBatch,
  isSelectionLastLine,
  isSketchPipe,
} from 'lib/selections'
import { applyConstraintIntersect } from './Toolbar/Intersect'
import { applyConstraintAbsDistance } from './Toolbar/SetAbsDistance'
import useStateMachineCommands from 'hooks/useStateMachineCommands'
import { modelingMachineConfig } from 'lib/commandBarConfigs/modelingCommandConfig'
import { sceneInfra } from 'clientSideScene/sceneInfra'
import {
  getQuaternionFromZAxis,
  getSketchQuaternion,
} from 'clientSideScene/sceneEntities'
import { startSketchOnDefault } from 'lang/modifyAst'
import { Program } from 'lang/wasm'
import { isSingleCursorInPipe } from 'lang/queryAst'
import { TEST } from 'env'
import { exportFromEngine } from 'lib/exportFromEngine'
import { Models } from '@kittycad/lib/dist/types/src'
import toast from 'react-hot-toast'
import { EditorSelection } from '@uiw/react-codemirror'
import { v4 as uuidv4 } from 'uuid'
import { Vector3 } from 'three'

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
      context: { baseUnit },
    },
  } = useGlobalStateContext()
  const { code } = useKclContext()
  const token = auth?.context?.token
  const streamRef = useRef<HTMLDivElement>(null)
  useSetupEngineManager(streamRef, token)

  const { isShiftDown, editorView } = useStore((s) => ({
    isShiftDown: s.isShiftDown,
    editorView: s.editorView,
  }))

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
          kclManager.executeAst()
        },
        'Set selection': assign(({ selectionRanges }, event) => {
          if (event.type !== 'Set selection') return {} // this was needed for ts after adding 'Set selection' action to on done modal events
          const setSelections = event.data
          if (!editorView) return {}
          const dispatchSelection = (selection?: EditorSelection) => {
            if (!selection) return // TODO less of hack for the below please
            ;(window as any).lastCodeMirrorSelectionUpdatedFromScene =
              Date.now()
            setTimeout(() => editorView.dispatch({ selection }))
          }
          let selections: Selections = {
            codeBasedSelections: [],
            otherSelections: [],
          }
          if (setSelections.selectionType === 'singleCodeCursor') {
            if (!setSelections.selection && isShiftDown) {
            } else if (!setSelections.selection && !isShiftDown) {
              selections = {
                codeBasedSelections: [],
                otherSelections: [],
              }
            } else if (setSelections.selection && !isShiftDown) {
              selections = {
                codeBasedSelections: [setSelections.selection],
                otherSelections: [],
              }
            } else if (setSelections.selection && isShiftDown) {
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
            if (isShiftDown) {
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
            format.units = baseUnit
          }

          if (format.type === 'ply' || format.type === 'stl') {
            format.selection = { type: 'default_scene' }
          }

          exportFromEngine({
            source_unit: baseUnit,
            format: format as Models['OutputFormat_type'],
          }).catch((e) => toast.error('Error while exporting', e)) // TODO I think we need to throw the error from engineCommandManager
        },
      },
      guards: {
        'has valid extrude selection': ({ selectionRanges }) => {
          // A user can begin extruding if they either have 1+ faces selected or nothing selected
          // TODO: I believe this guard only allows for extruding a single face at a time
          if (selectionRanges.codeBasedSelections.length < 1) return false
          const isPipe = isSketchPipe(selectionRanges)

          if (isSelectionLastLine(selectionRanges, code)) return true
          if (!isPipe) return false

          return canExtrudeSelection(selectionRanges)
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
        'Has exportable geometry': () =>
          kclManager.kclErrors.length === 0 && kclManager.ast.body.length > 0,
      },
      services: {
        'AST-undo-startSketchOn': async ({ sketchPathToNode }) => {
          if (!sketchPathToNode) return
          const newAst: Program = JSON.parse(JSON.stringify(kclManager.ast))
          const varDecIndex = sketchPathToNode[1][0]
          // remove body item at varDecIndex
          newAst.body = newAst.body.filter((_, i) => i !== varDecIndex)
          await kclManager.executeAstMock(newAst, { updates: 'code' })
          sceneInfra.setCallbacks({
            onClick: () => {},
            onDrag: () => {},
          })
        },

        'animate-to-face2': async ({ selectionRanges }) => {
          const selectionToEngine = codeToIdSelections(
            selectionRanges.codeBasedSelections
          )
          const faceId = selectionToEngine?.[0].id
          if (!faceId) return

          const faceInfo: Models['FaceIsPlanar_type'] = (
            await engineCommandManager.sendSceneCommand({
              type: 'modeling_cmd_req',
              cmd_id: uuidv4(),
              cmd: {
                type: 'face_is_planar',
                object_id: faceId,
              },
            })
          )?.data?.data
          if (!faceInfo?.origin || !faceInfo?.z_axis) return
          const { z_axis, origin } = faceInfo
          const quaternion = getQuaternionFromZAxis(
            new Vector3(z_axis.x, z_axis.y, z_axis.z)
          )
          const target = new Vector3(origin.x, origin.y, origin.z)
          await sceneInfra.camControls.tweenCameraToQuaternion(
            quaternion,
            target
          )
        },
        'animate-to-face': async (_, { data: { plane, normal } }) => {
          const { modifiedAst, pathToNode } = startSketchOnDefault(
            kclManager.ast,
            plane
          )
          await kclManager.updateAst(modifiedAst, false)
          const quaternion = getSketchQuaternion(pathToNode, normal)
          await sceneInfra.camControls.tweenCameraToQuaternion(quaternion)
          return {
            sketchPathToNode: pathToNode,
            sketchNormalBackUp: normal,
          }
        },
        'animate-to-sketch': async ({
          sketchPathToNode,
          sketchNormalBackUp,
        }) => {
          const quaternion = getSketchQuaternion(
            sketchPathToNode || [],
            sketchNormalBackUp
          )
          await sceneInfra.camControls.tweenCameraToQuaternion(quaternion)
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
      },
      devTools: true,
    }
  )

  useEffect(() => {
    kclManager.registerExecuteCallback(() => {
      modelingSend({ type: 'Re-execute' })
    })
  }, [modelingSend])

  useStateMachineCommands({
    machineId: 'modeling',
    state: modelingState,
    send: modelingSend,
    actor: modelingActor,
    commandBarConfig: modelingMachineConfig,
    allCommandsRequireNetwork: true,
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
