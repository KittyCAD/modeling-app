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
import { v4 as uuidv4 } from 'uuid'
import { addStartSketch } from 'lang/modifyAst'
import { roundOff } from 'lib/utils'
import {
  recast,
  parse,
  Program,
  PipeExpression,
  CallExpression,
  SourceRange,
} from 'lang/wasm'
import { getNodeFromPath, getNodePathFromSourceRange } from 'lang/queryAst'
import {
  addCloseToPipe,
  addNewSketchLn,
  compareVec2Epsilon,
} from 'lang/std/sketch'
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
  canExtrudeSelection,
  handleSelectionBatch,
  handleSelectionWithShift,
  isSelectionLastLine,
  isSketchPipe,
} from 'lib/selections'
import { applyConstraintIntersect } from './Toolbar/Intersect'
import { applyConstraintAbsDistance } from './Toolbar/SetAbsDistance'
import { Models } from '@kittycad/lib'
import useStateMachineCommands from 'hooks/useStateMachineCommands'
import { modelingMachineConfig } from 'lib/commandBarConfigs/modelingCommandConfig'

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
  const { auth } = useGlobalStateContext()
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
        'Modify AST': () => {},
        'Update code selection cursors': () => {},
        'AST start new sketch': assign(
          ({ sketchEnginePathId }, { data: { coords, axis, segmentId } }) => {
            if (!axis) {
              // Something really weird must have happened for this to happen.
              console.error('axis is undefined for starting a new sketch')
              return {}
            }
            if (!segmentId) {
              // Something really weird must have happened for this to happen.
              console.error('segmentId is undefined for starting a new sketch')
              return {}
            }

            const _addStartSketch = addStartSketch(
              kclManager.ast,
              axis,
              [roundOff(coords[0].x), roundOff(coords[0].y)],
              [
                roundOff(coords[1].x - coords[0].x),
                roundOff(coords[1].y - coords[0].y),
              ]
            )
            const _modifiedAst = _addStartSketch.modifiedAst
            const _pathToNode = _addStartSketch.pathToNode
            const newCode = recast(_modifiedAst)
            const astWithUpdatedSource = parse(newCode)
            const updatedPipeNode = getNodeFromPath<PipeExpression>(
              astWithUpdatedSource,
              _pathToNode
            ).node
            const startProfileAtCallExp = updatedPipeNode.body.find(
              (exp) =>
                exp.type === 'CallExpression' &&
                exp.callee.name === 'startProfileAt'
            )
            if (startProfileAtCallExp) {
              const range: SourceRange = [
                startProfileAtCallExp.start,
                startProfileAtCallExp.end,
              ]
              const pathToNode = getNodePathFromSourceRange(
                kclManager.ast,
                range
              )
              engineCommandManager.artifactMap[sketchEnginePathId] = {
                type: 'result',
                range,
                pathToNode,
                commandType: 'start_path',
                data: null,
                raw: {} as any,
              }
            }
            const lineCallExp = updatedPipeNode.body.find(
              (exp) =>
                exp.type === 'CallExpression' && exp.callee.name === 'line'
            )
            if (lineCallExp) {
              const range: SourceRange = [lineCallExp.start, lineCallExp.end]
              const pathToNode = getNodePathFromSourceRange(
                kclManager.ast,
                range
              )
              engineCommandManager.artifactMap[segmentId] = {
                type: 'result',
                range,
                pathToNode,
                commandType: 'extend_path',
                parentId: sketchEnginePathId,
                data: null,
                raw: {} as any,
              }
            }

            void kclManager.executeAstMock(astWithUpdatedSource, {
              updates: 'code',
            })

            return {
              sketchPathToNode: _pathToNode,
            }
          }
        ),
        'AST add line segment': async (
          { sketchPathToNode, sketchEnginePathId, tool },
          { data: { coords, segmentId } }
        ) => {
          if (!sketchPathToNode) return
          const lastCoord = coords[coords.length - 1]

          const pathInfo = await engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: {
              type: 'path_get_info',
              path_id: sketchEnginePathId,
            },
          })
          const firstSegment = pathInfo?.data?.data?.segments.find(
            (seg: any) => seg.command === 'line_to'
          )
          const firstSegCoords = await engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: {
              type: 'curve_get_end_points',
              curve_id: firstSegment.command_id,
            },
          })
          const resp: Models['CurveGetEndPoints_type'] =
            firstSegCoords.data.data
          const startPathCoord = resp.start

          const isClose = compareVec2Epsilon(
            [startPathCoord.x, startPathCoord.y],
            [lastCoord.x, lastCoord.y]
          )

          let _modifiedAst: Program
          if (!isClose) {
            const newSketchLn = addNewSketchLn({
              node: kclManager.ast,
              programMemory: kclManager.programMemory,
              to: [lastCoord.x, lastCoord.y],
              from: [coords[0].x, coords[0].y],
              fnName: tool === 'sketch_line' ? 'line' : 'tangentialArcTo',
              pathToNode: sketchPathToNode,
            })
            const _modifiedAst = newSketchLn.modifiedAst
            void kclManager
              .executeAstMock(_modifiedAst, { updates: 'code' })
              .then(() => {
                const lineCallExp = getNodeFromPath<CallExpression>(
                  kclManager.ast,
                  newSketchLn.pathToNode
                ).node
                if (segmentId) {
                  const range: SourceRange = [
                    lineCallExp.start,
                    lineCallExp.end,
                  ]
                  const pathToNode = getNodePathFromSourceRange(
                    kclManager.ast,
                    range
                  )
                  engineCommandManager.artifactMap[segmentId] = {
                    type: 'result',
                    range,
                    pathToNode,
                    commandType: 'extend_path',
                    parentId: sketchEnginePathId,
                    data: null,
                    raw: {} as any,
                  }
                }
              })
          } else {
            if (tool === 'sketch_tangential_arc') {
              const newSketchLn = addNewSketchLn({
                node: kclManager.ast,
                programMemory: kclManager.programMemory,
                to: [lastCoord.x, lastCoord.y],
                from: [coords[0].x, coords[0].y],
                fnName: 'tangentialArcTo',
                pathToNode: sketchPathToNode,
              })
              _modifiedAst = newSketchLn.modifiedAst
              kclManager
                .executeAstMock(_modifiedAst, { updates: 'code' })
                .then(() => {
                  const lineCallExp = getNodeFromPath<CallExpression>(
                    kclManager.ast,
                    newSketchLn.pathToNode
                  ).node
                  if (segmentId) {
                    const range: SourceRange = [
                      lineCallExp.start,
                      lineCallExp.end,
                    ]
                    const pathToNode = getNodePathFromSourceRange(
                      kclManager.ast,
                      range
                    )
                    engineCommandManager.artifactMap[segmentId] = {
                      type: 'result',
                      range,
                      pathToNode,
                      commandType: 'extend_path',
                      parentId: sketchEnginePathId,
                      data: null,
                      raw: {} as any,
                    }
                  }
                })
            } else {
              _modifiedAst = kclManager.ast
            }
            _modifiedAst = addCloseToPipe({
              node: _modifiedAst,
              programMemory: kclManager.programMemory,
              pathToNode: sketchPathToNode,
            })
            void engineCommandManager.sendSceneCommand({
              type: 'modeling_cmd_req',
              cmd_id: uuidv4(),
              cmd: { type: 'edit_mode_exit' },
            })
            void engineCommandManager.sendSceneCommand({
              type: 'modeling_cmd_req',
              cmd_id: uuidv4(),
              cmd: { type: 'default_camera_disable_sketch_mode' },
            })
            void kclManager.executeAstMock(_modifiedAst, { updates: 'code' })
            // updateAst(_modifiedAst, true)
          }
        },
        'sketch exit execute': () => {
          void kclManager.executeAst()
        },
        'Set selection': assign(({ selectionRanges }, event) => {
          if (event.type !== 'Set selection') return {} // this was needed for ts after adding 'Set selection' action to on done modal events
          const setSelections = event.data
          if (!editorView) return {}
          if (setSelections.selectionType === 'mirrorCodeMirrorSelections')
            return { selectionRanges: setSelections.selection }
          else if (setSelections.selectionType === 'otherSelection') {
            // TODO KittyCAD/engine/issues/1620: send axis highlight when it's working (if that's what we settle on)
            // const axisAddCmd: EngineCommand = {
            //   type: 'modeling_cmd_req',
            //   cmd: {
            //     type: 'highlight_set_entities',
            //     entities: [
            //       setSelections.selection === 'x-axis'
            //         ? X_AXIS_UUID
            //         : Y_AXIS_UUID,
            //     ],
            //   },
            //   cmd_id: uuidv4(),
            // }

            // if (!isShiftDown) {
            //   engineCommandManager
            //     .sendSceneCommand({
            //       type: 'modeling_cmd_req',
            //       cmd: {
            //         type: 'select_clear',
            //       },
            //       cmd_id: uuidv4(),
            //     })
            //     .then(() => {
            //       engineCommandManager.sendSceneCommand(axisAddCmd)
            //     })
            // } else {
            //   engineCommandManager.sendSceneCommand(axisAddCmd)
            // }

            const {
              codeMirrorSelection,
              selectionRangeTypeMap,
              otherSelections,
            } = handleSelectionWithShift({
              otherSelection: setSelections.selection,
              currentSelections: selectionRanges,
              isShiftDown,
            })
            setTimeout(() => {
              editorView.dispatch({
                selection: codeMirrorSelection,
              })
            })
            return {
              selectionRangeTypeMap,
              selectionRanges: {
                codeBasedSelections: selectionRanges.codeBasedSelections,
                otherSelections,
              },
            }
          } else if (setSelections.selectionType === 'singleCodeCursor') {
            // This DOES NOT set the `selectionRanges` in xstate context
            // instead it updates/dispatches to the editor, which in turn updates the xstate context
            // I've found this the best way to deal with the editor without causing an infinite loop
            // and really we want the editor to be in charge of cursor positions and for `selectionRanges` mirror it
            // because we want to respect the user manually placing the cursor too.

            // for more details on how selections see `src/lib/selections.ts`.

            const {
              codeMirrorSelection,
              selectionRangeTypeMap,
              otherSelections,
            } = handleSelectionWithShift({
              codeSelection: setSelections.selection,
              currentSelections: selectionRanges,
              isShiftDown,
            })
            if (codeMirrorSelection) {
              setTimeout(() => {
                editorView.dispatch({
                  selection: codeMirrorSelection,
                })
              })
            }
            if (!setSelections.selection) {
              return {
                selectionRangeTypeMap,
                selectionRanges: {
                  codeBasedSelections: selectionRanges.codeBasedSelections,
                  otherSelections,
                },
              }
            }
            return {
              selectionRangeTypeMap,
              selectionRanges: {
                codeBasedSelections: selectionRanges.codeBasedSelections,
                otherSelections,
              },
            }
          }
          // This DOES NOT set the `selectionRanges` in xstate context
          // same as comment above
          const { codeMirrorSelection, selectionRangeTypeMap } =
            handleSelectionBatch({
              selections: setSelections.selection,
            })
          if (codeMirrorSelection) {
            setTimeout(() => {
              editorView.dispatch({
                selection: codeMirrorSelection,
              })
            })
          }
          return { selectionRangeTypeMap }
        }),
      },
      guards: {
        'Selection contains line': () => true,
        'Selection contains point': () => true,
        'has valid extrude selection': ({ selectionRanges }) => {
          // A user can begin extruding if they either have 1+ faces selected or nothing selected
          // TODO: I believe this guard only allows for extruding a single face at a time
          if (selectionRanges.codeBasedSelections.length < 1) return false
          const isPipe = isSketchPipe(selectionRanges)

          if (isSelectionLastLine(selectionRanges, code)) return true
          if (!isPipe) return false

          return canExtrudeSelection(selectionRanges)
        },
        'Selection is one face': ({ selectionRanges }) => {
          return !!isCursorInSketchCommandRange(
            engineCommandManager.artifactMap,
            selectionRanges
          )
        },
      },
      services: {
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
    onCancel: () => {
      console.log('firing onCancel!!')
      modelingSend({ type: 'Cancel' })
    },
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
