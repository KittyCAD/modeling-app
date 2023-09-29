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
import { modelingMachine } from 'machines/modelingMachine'
import { useSetupEngineManager } from 'hooks/useSetupEngineManager'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'
import { isCursorInSketchCommandRange } from 'hooks/useAppMode'
import { engineCommandManager } from 'lang/std/engineConnection'
import { v4 as uuidv4 } from 'uuid'
import { addStartSketch } from 'lang/modifyAst'
import { roundOff } from 'lib/utils'
import { useStore } from 'useStore'
import { recast } from 'lang/recast'
import { parser_wasm } from 'lang/abstractSyntaxTree'
import { getNodeFromPath } from 'lang/queryAst'
import { Program, VariableDeclarator } from 'lang/abstractSyntaxTreeTypes'
import {
  addCloseToPipe,
  addNewSketchLn,
  compareVec2Epsilon,
} from 'lang/std/sketch'
import { kclManager } from 'lang/KclSinglton'

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
    auth: {
      context: { token },
    },
  } = useGlobalStateContext()
  const streamRef = useRef<HTMLDivElement>(null)
  useSetupEngineManager(streamRef, token)

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
      'Make selection horizontal': () => {},
      'Make selection vertical': () => {},
      'Update code selection cursors': () => {},
      'show default planes': () => {
        modelingState.context.defaultPlanes?.showPlanes()
      },
      'create path': async () => {
        const sketchUuid = uuidv4()
        const proms = [
          engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: sketchUuid,
            cmd: {
              type: 'start_path',
            },
          }),
          engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: {
              type: 'edit_mode_enter',
              target: sketchUuid,
            },
          }),
        ]
        await Promise.all(proms)
      },
      'AST start new sketch': assign((_, { data: coords }) => {
        const _addStartSketch = addStartSketch(
          kclManager.ast,
          [roundOff(coords[0].x), roundOff(coords[0].y)],
          [
            roundOff(coords[1].x - coords[0].x),
            roundOff(coords[1].y - coords[0].y),
          ]
        )
        const _modifiedAst = _addStartSketch.modifiedAst
        const _pathToNode = _addStartSketch.pathToNode
        const newCode = recast(_modifiedAst)
        const astWithUpdatedSource = parser_wasm(newCode)

        kclManager.executeAstMock(astWithUpdatedSource, true)

        return {
          sketchPathToNode: _pathToNode,
        }
      }),
      'AST add line segment': ({ sketchPathToNode }, { data: coords }) => {
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
          _modifiedAst = addNewSketchLn({
            node: kclManager.ast,
            programMemory: kclManager.programMemory,
            to: [lastCoord.x, lastCoord.y],
            fnName: 'line',
            pathToNode: sketchPathToNode,
          }).modifiedAst
          kclManager.executeAstMock(_modifiedAst, true)
          // kclManager.updateAst(_modifiedAst, false)
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
    },
    guards: {
      'Can make selection horizontal': () => true,
      'Can make selection vertical': () => true,
      'Selection contains axis': () => true,
      'Selection contains edge': () => true,
      'Selection contains face': () => true,
      'Selection contains line': () => true,
      'Selection contains point': () => true,
      'Selection is empty': () => true,
      'Selection is not empty': () => true,
      'Selection is one face': ({ selectionRanges }) => {
        return !!isCursorInSketchCommandRange(
          engineCommandManager.artifactMap,
          selectionRanges
        )
      },
      'Selection is one or more edges': () => true,
    },
    services: {
      // createSketch: async () => {},
      createExtrude: async () => {},
      createFillet: async () => {},
    },
    devTools: true,
  })

  useEffect(() => {
    modelingState.context.defaultPlanes?.onPlaneSelected((plane_id: string) => {
      if (modelingState.nextEvents.includes('Select face')) {
        modelingSend('Select face')
      }
    })
  }, [modelingState.context.defaultPlanes, modelingSend])

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
      {/* TODO maybe pass reff down to children/app.ts or render app.tsx directly?
      since realistically it won't ever have generic children that isn't app.tsx */}
      <div className="h-screen overflow-hidden select-none" ref={streamRef}>
        {children}
      </div>
    </ModelingMachineContext.Provider>
  )
}

export default ModelingMachineProvider
