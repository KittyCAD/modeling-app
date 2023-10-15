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
  VariableDeclarator,
  PipeExpression,
  CallExpression,
} from 'lang/wasm'
import { getNodeFromPath } from 'lang/queryAst'
import {
  addCloseToPipe,
  addNewSketchLn,
  compareVec2Epsilon,
} from 'lang/std/sketch'
import { kclManager } from 'lang/KclSinglton'
import { applyConstraintHorzVertDistance } from './Toolbar/SetHorzVertDistance'
import { applyConstraintAngleBetween } from './Toolbar/SetAngleBetween'
import { applyConstraintAngleLength } from './Toolbar/setAngleLength'
import { toast } from 'react-hot-toast'
import { pathMapToSelections } from 'lang/util'
import {
  dispatchCodeMirrorCursor,
  setCodeMirrorCursor,
  useStore,
} from 'useStore'
import { applyConstraintIntersect } from './Toolbar/Intersect'

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
  const token = auth?.context?.token
  const streamRef = useRef<HTMLDivElement>(null)
  useSetupEngineManager(streamRef, token)

  const { isShiftDown, editorView } = useStore((s) => ({
    isShiftDown: s.isShiftDown,
    editorView: s.editorView,
  }))

  // const { commands } = useCommandsContext()

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

  const [modelingState, modelingSend] = useMachine(modelingMachine, {
    // context: persistedSettings,
    actions: {
      'Modify AST': () => {},
      'Update code selection cursors': () => {},
      'show default planes': () => {
        kclManager.showPlanes()
      },
      'create path': assign({
        sketchEnginePathId: () => {
          const sketchUuid = uuidv4()
          engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: sketchUuid,
            cmd: {
              type: 'start_path',
            },
          })
          engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: {
              type: 'edit_mode_enter',
              target: sketchUuid,
            },
          })
          return sketchUuid
        },
      }),
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
          if (startProfileAtCallExp)
            engineCommandManager.artifactMap[sketchEnginePathId] = {
              type: 'result',
              range: [startProfileAtCallExp.start, startProfileAtCallExp.end],
              commandType: 'extend_path',
              data: null,
              raw: {} as any,
            }
          const lineCallExp = updatedPipeNode.body.find(
            (exp) => exp.type === 'CallExpression' && exp.callee.name === 'line'
          )
          if (lineCallExp)
            engineCommandManager.artifactMap[segmentId] = {
              type: 'result',
              range: [lineCallExp.start, lineCallExp.end],
              commandType: 'extend_path',
              parentId: sketchEnginePathId,
              data: null,
              raw: {} as any,
            }

          kclManager.executeAstMock(astWithUpdatedSource, true)

          return {
            sketchPathToNode: _pathToNode,
          }
        }
      ),
      'AST add line segment': (
        { sketchPathToNode, sketchEnginePathId },
        { data: { coords, segmentId } }
      ) => {
        if (!sketchPathToNode) return
        const lastCoord = coords[coords.length - 1]

        const { node: varDec } = getNodeFromPath<VariableDeclarator>(
          kclManager.ast,
          sketchPathToNode,
          'VariableDeclarator'
        )
        const variableName = varDec.id.name
        const sketchGroup = kclManager.programMemory.root[variableName]
        if (!sketchGroup || sketchGroup.type !== 'SketchGroup') return
        const initialCoords = sketchGroup.value[0].from

        const isClose = compareVec2Epsilon(initialCoords, [
          lastCoord.x,
          lastCoord.y,
        ])

        let _modifiedAst: Program
        if (!isClose) {
          const newSketchLn = addNewSketchLn({
            node: kclManager.ast,
            programMemory: kclManager.programMemory,
            to: [lastCoord.x, lastCoord.y],
            fnName: 'line',
            pathToNode: sketchPathToNode,
          })
          const _modifiedAst = newSketchLn.modifiedAst
          kclManager.executeAstMock(_modifiedAst, true).then(() => {
            const lineCallExp = getNodeFromPath<CallExpression>(
              kclManager.ast,
              newSketchLn.pathToNode
            ).node
            if (segmentId)
              engineCommandManager.artifactMap[segmentId] = {
                type: 'result',
                range: [lineCallExp.start, lineCallExp.end],
                commandType: 'extend_path',
                parentId: sketchEnginePathId,
                data: null,
                raw: {} as any,
              }
          })
        } else {
          _modifiedAst = addCloseToPipe({
            node: kclManager.ast,
            programMemory: kclManager.programMemory,
            pathToNode: sketchPathToNode,
          })
          engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: { type: 'edit_mode_exit' },
          })
          engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: { type: 'default_camera_disable_sketch_mode' },
          })
          kclManager.executeAstMock(_modifiedAst, true)
          // updateAst(_modifiedAst, true)
        }
      },
      'sketch exit execute': () => {
        kclManager.executeAst()
      },
      'set tool': () => {}, // TODO
      'toast extrude failed': () => {
        toast.error(
          'Extrude failed, sketches need to be closed, or not already extruded'
        )
      },
      'Set selection': assign(({ selectionRanges }, event) => {
        if (event.type !== 'Set selection') return {} // this was needed for ts after adding 'Set selection' action to on done modal events
        const setSelections = event.data
        if (setSelections.selectionType === 'mirrorCodeMirrorSelections')
          return { selectionRanges: setSelections.selection }
        else if (setSelections.selectionType === 'otherSelection')
          return {
            selectionRanges: {
              ...selectionRanges,
              otherSelections: [setSelections.selection],
            },
          }
        else if (!editorView) return {}
        else if (setSelections.selectionType === 'singleCodeCursor') {
          // This DOES NOT set the `selectionRanges` in xstate context
          // instead it updates/dispatches to the editor, which in turn updates the xstate context
          // I've found this the best way to deal with the editor without causing an infinite loop
          // and really we want the editor to be in charge of cursor positions and for `selectionRanges` mirror it
          // because we want to respect the user manually placing the cursor too.
          const selectionRangeTypeMap = setCodeMirrorCursor({
            codeSelection: setSelections.selection,
            currestSelections: selectionRanges,
            editorView,
            isShiftDown,
          })
          return {
            selectionRangeTypeMap,
          }
        }
        // This DOES NOT set the `selectionRanges` in xstate context
        // same as comment above
        const selectionRangeTypeMap = dispatchCodeMirrorCursor({
          selections: setSelections.selection,
          editorView,
        })
        return {
          selectionRangeTypeMap,
        }
      }),
    },
    guards: {
      'Selection contains axis': () => true,
      'Selection contains edge': () => true,
      'Selection contains face': () => true,
      'Selection contains line': () => true,
      'Selection contains point': () => true,
      'Selection is not empty': () => true,
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
      'Get angle info': async ({ selectionRanges }): Promise<SetSelections> => {
        const { modifiedAst, pathToNodeMap } =
          await applyConstraintAngleBetween({
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
      'Get length info': async ({
        selectionRanges,
      }): Promise<SetSelections> => {
        const { modifiedAst, pathToNodeMap } = await applyConstraintAngleLength(
          { selectionRanges }
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
      'Get perpendicular distance info': async ({
        selectionRanges,
      }): Promise<SetSelections> => {
        const { modifiedAst, pathToNodeMap } = await applyConstraintIntersect({
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
  })

  useEffect(() => {
    engineCommandManager.onPlaneSelected((plane_id: string) => {
      if (modelingState.nextEvents.includes('Select default plane')) {
        modelingSend({
          type: 'Select default plane',
          data: { planeId: plane_id },
        })
      }
    })
  }, [modelingSend, modelingState.nextEvents])

  // useStateMachineCommands({
  //   state: settingsState,
  //   send: settingsSend,
  //   commands,
  //   owner: 'settings',
  //   commandBarMeta: settingsCommandBarMeta,
  // })

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
