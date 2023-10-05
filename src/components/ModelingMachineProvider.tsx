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
import { recast, parse, Program, VariableDeclarator } from 'lang/wasm'
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
        // TODO: need kurts help here, this was old code.
        // We need the normal for the plane we are on.
        const plane = await engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'get_sketch_mode_plane',
          },
        })
        const z_axis = plane.data.data.z_axis

        // Get the current axis.
        let currentAxis: 'xy' | 'xz' | 'yz' | '-xy' | '-xz' | '-yz' | null =
          null
        if (currentPlane === defaultPlanes?.xy) {
          if (z_axis.z === -1) {
            currentAxis = '-xy'
          } else {
            currentAxis = 'xy'
          }
        } else if (currentPlane === defaultPlanes?.yz) {
          if (z_axis.x === -1) {
            currentAxis = '-yz'
          } else {
            currentAxis = 'yz'
          }
        } else if (currentPlane === defaultPlanes?.xz) {
          if (z_axis.y === -1) {
            currentAxis = '-xz'
          } else {
            currentAxis = 'xz'
          }
        }

        // Do not support starting a new sketch on a non-default plane.
        if (!currentAxis) return

        const _addStartSketch = addStartSketch(
          kclManager.ast,
          currentAxis, // the axis.
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
      'toast extrude failed': () => {
        toast.error(
          'Extrude failed, sketches need to be closed, or not already extruded'
        )
      },
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
      'Get horizontal info': async ({ selectionRanges }) => {
        const { modifiedAst, pathToNodeMap } =
          await applyConstraintHorzVertDistance({
            constraint: 'setHorzDistance',
            selectionRanges,
          })
        kclManager.updateAst(modifiedAst, true, {
          // todo handle cursor
          // callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
        })
      },
      'Get vertical info': async ({ selectionRanges }) => {
        const { modifiedAst, pathToNodeMap } =
          await applyConstraintHorzVertDistance({
            constraint: 'setVertDistance',
            selectionRanges,
          })
        kclManager.updateAst(modifiedAst, true, {
          // todo handle cursor
          // callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
        })
      },
      'Get angle info': async ({ selectionRanges }) => {
        const { modifiedAst, pathToNodeMap } =
          await applyConstraintAngleBetween({
            selectionRanges,
          })
        kclManager.updateAst(modifiedAst, true, {
          // todo handle cursor
          // callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
        })
      },
      'Get length info': async ({ selectionRanges }) => {
        const { modifiedAst, pathToNodeMap } = await applyConstraintAngleLength(
          { selectionRanges }
        )
        kclManager.updateAst(modifiedAst, true, {
          // todo handle cursor
          // callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
        })
      },
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
