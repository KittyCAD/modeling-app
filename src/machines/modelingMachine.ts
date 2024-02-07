import { PathToNode, VariableDeclarator } from 'lang/wasm'
import { engineCommandManager } from 'lang/std/engineConnection'
import { isReducedMotion } from 'lib/utils'
import {
  Axis,
  Selection,
  SelectionRangeTypeMap,
  Selections,
} from 'lib/selections'
import { assign, createMachine } from 'xstate'
import { v4 as uuidv4 } from 'uuid'
import { isCursorInSketchCommandRange } from 'lang/util'
import { getNodePathFromSourceRange } from 'lang/queryAst'
import { kclManager } from 'lang/KclSingleton'
import {
  horzVertInfo,
  applyConstraintHorzVert,
} from 'components/Toolbar/HorzVert'
import {
  applyConstraintHorzVertAlign,
  horzVertDistanceInfo,
} from 'components/Toolbar/SetHorzVertDistance'
import { angleBetweenInfo } from 'components/Toolbar/SetAngleBetween'
import { angleLengthInfo } from 'components/Toolbar/setAngleLength'
import {
  applyConstraintEqualLength,
  setEqualLengthInfo,
} from 'components/Toolbar/EqualLength'
import {
  addStartProfileAt,
  extrudeSketch,
  startSketchOnDefault,
} from 'lang/modifyAst'
import { getNodeFromPath } from '../lang/queryAst'
import { CallExpression, PipeExpression } from '../lang/wasm'
import {
  applyConstraintEqualAngle,
  equalAngleInfo,
} from 'components/Toolbar/EqualAngle'
import {
  applyRemoveConstrainingValues,
  removeConstrainingValuesInfo,
} from 'components/Toolbar/RemoveConstrainingValues'
import { intersectInfo } from 'components/Toolbar/Intersect'
import {
  absDistanceInfo,
  applyConstraintAxisAlign,
} from 'components/Toolbar/SetAbsDistance'
import { Models } from '@kittycad/lib/dist/types/src'
import { ModelingCommandSchema } from 'lib/commandBarConfigs/modelingCommandConfig'
import {
  DefaultPlaneStr,
  clientSideScene,
  quaternionFromSketchGroup,
  sketchGroupFromPathToNode,
} from 'clientSideScene/clientSideScene'
import { setupSingleton } from 'clientSideScene/setup'

export const MODELING_PERSIST_KEY = 'MODELING_PERSIST_KEY'

export type SetSelections =
  | {
      selectionType: 'singleCodeCursor'
      selection?: Selection
    }
  | {
      selectionType: 'otherSelection'
      selection: Axis
    }
  | {
      selectionType: 'completeSelection'
      selection: Selections
    }
  | {
      selectionType: 'mirrorCodeMirrorSelections'
      selection: Selections
    }

export type ModelingMachineEvent =
  | { type: 'Enter sketch' }
  | {
      type: 'Select default plane'
      data: { plane: DefaultPlaneStr; normal: [number, number, number] }
    }
  | { type: 'Set selection'; data: SetSelections }
  | { type: 'Sketch no face' }
  | { type: 'Toggle gui mode' }
  | { type: 'Cancel' }
  | { type: 'CancelSketch' }
  | { type: 'Add start point' }
  | { type: 'Make segment horizontal' }
  | { type: 'Make segment vertical' }
  | { type: 'Constrain horizontal distance' }
  | { type: 'Constrain ABS X' }
  | { type: 'Constrain ABS Y' }
  | { type: 'Constrain vertical distance' }
  | { type: 'Constrain angle' }
  | { type: 'Constrain perpendicular distance' }
  | { type: 'Constrain horizontally align' }
  | { type: 'Constrain vertically align' }
  | { type: 'Constrain snap to X' }
  | { type: 'Constrain snap to Y' }
  | { type: 'Constrain length' }
  | { type: 'Constrain equal length' }
  | { type: 'Constrain parallel' }
  | { type: 'Constrain remove constraints' }
  | { type: 'Re-execute' }
  | { type: 'Extrude'; data?: ModelingCommandSchema['Extrude'] }
  | { type: 'Equip Line tool 3' }
  | { type: 'Equip tangential arc to 3' }

export type MoveDesc = { line: number; snippet: string }

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogDMAJhoA6YQHYaMgKwA2AIwAWAJzCRAGhABPRIpHiAHItU1FR2cMWyr8gL73taDDnwEAymHYACWFjByTm5aBiQQFjZgnnCBBBVZRTEjM0NBVSNpWVVtPQRBFVUxNWUaVVTrI2VJR2d0LDwoMWwITDBPbz8AoK5cUN5Ijl7eOPlbMTH5dXkjc2FS5Vz9C3kxGxp5JRphBVV5QVqQFwb8Ztb2gFFcdjAAJz8Aa29yAAt+8MHokcRJRUkJ8q-apGUTKHZLBDSZTJaSqCySdQqEGHY5uJotNoEK43e6wJ7sV5URRhZisIbcb75EFiWTpRTySSSMHKQRKCF7aGKGjKUo2TYpDQo+pos6Yi58di3ACuGHepKiw1iiCMgiMEj+ylkmVkNBMwghihWax1khMOtsNC1QtcjTEHnxr2IZEomHtzze9AGZK+SoQohma0kWpBRhVupZBq5ghp-qM8ktG0kwiM1pOTTdBJedodLwAkucOr5-G0eiFPR9vYrQHENJaxFDVTyLIlZOzZNDStrDcnLDzUyKM69s+785jkCQnl0oABbMDXHwANzunHIJEwcoilYpvuskmjO0Uyfmcd+RgNgkEsnr5jM2zNGWE-dtg6zL9H7XHk-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-xrC+SaiISbDlBcbJH-bxCWDiAJ6NjJ7cgQjtjiDzDWA0Y7DB7abmxlG9ouLnZ5zSSjpAxyEUKGjQi0i2CHSFyJjlYrIdJ3IhYwp6K9KdGdTWLZQ0bYSmhVAZByonQyoSGT5g6Dp4RTHMo2x2xzFbILGYpLE7h4Rs70gPjSCVFMwnT+jqgJJ7D-KQzHErqJShqLGpaF4BGBEMx2S0hhw2B5qZATA6g7BgjhxjDfHVqtRhrXHbT6xrC9gG4JIALXrbB870I7CzC6iXjpKYZLIVa4b-HmT+F+iHQSCZBzC4QzSa6nTSZ-AiCqhlCQ4vrL6aoVYiYokAk0lSDSDZRzqkrBy4RJgQzqCsy9i2Aw6SKIkdY1bBZJYNaVKolux7iOpgnjG-BMiTZBz8RSCoazBSAi5m5alhLSTRhah16qgSlFEQi9QDrVBmDh6jS0iWmH7RjR7sDWlCC0gez2QqgqiWKsiRjZC5xY5jBggPg8mv6LZiAH5i406S4XJriBmpEjo0jHYilDrYSRhuTGjcgwHdgqiqA+lpnI6W4+A2527eHUkpEFzuQ6gg5zB7Chi5HpASDzKiLbClDzroFv604cDZkKSNG-AP4IiL6DH6BlB35hiWBXTWGJkjnJmr6+KcAb4-bZnpCEL2bqBZql64TxI7DnRgwNGhhxiES8mZg+Af5UFJFCkpHh5rA0YawSI8imhtgSrQGOTFFuRlBqFYF8FQACFkAvnNnlGHg6jXiaybFZbFx7BXgAXvLQJxgYbzwmGaHpzaFUS6E5gTk7DY4G4ApwhMjFxQirHoaEqq77COCOBAA */
    id: 'Modeling',

    tsTypes: {} as import('./modelingMachine.typegen').Typegen0,
    predictableActionArguments: true,
    preserveActionOrder: true,

    context: {
      guiMode: 'default',
      tool: null as Models['SceneToolType_type'] | null,
      selection: [] as string[],
      selectionRanges: {
        otherSelections: [],
        codeBasedSelections: [],
      } as Selections,
      selectionRangeTypeMap: {} as SelectionRangeTypeMap,
      sketchPathToNode: null as PathToNode | null, // maybe too specific, and we should have a generic pathToNode, but being specific seems less risky when I'm not sure
      sketchEnginePathId: '' as string,
      sketchPlaneId: '' as string,
      sketchNormalBackUp: null as null | [number, number, number],
      moveDescs: [] as MoveDesc[],
    },

    schema: {
      events: {} as ModelingMachineEvent,
    },

    states: {
      idle: {
        on: {
          'Set selection': {
            target: 'idle',
            internal: true,
            actions: 'Set selection',
          },

          'Enter sketch': [
            {
              target: 'animating to existing sketch',
              cond: 'Selection is one face',
              actions: ['set sketch metadata'],
            },
            'Sketch no face',
          ],

          Extrude: {
            target: 'idle',
            cond: 'has valid extrude selection',
            actions: ['AST extrude'],
            internal: true,
          },
        },
      },

      Sketch: {
        states: {
          SketchIdle: {
            on: {
              'Set selection': {
                target: 'SketchIdle',
                internal: true,
                actions: 'Set selection',
              },

              'Make segment vertical': {
                cond: 'Can make selection vertical',
                target: 'SketchIdle',
                internal: true,
                actions: ['Make selection vertical'],
              },

              'Make segment horizontal': {
                target: 'SketchIdle',
                internal: true,
                cond: 'Can make selection horizontal',
                actions: ['Make selection horizontal'],
              },

              'Constrain horizontal distance': {
                target: 'Await horizontal distance info',
                cond: 'Can constrain horizontal distance',
              },

              'Constrain vertical distance': {
                target: 'Await vertical distance info',
                cond: 'Can constrain vertical distance',
              },

              'Constrain ABS X': {
                target: 'Await ABS X info',
                cond: 'Can constrain ABS X',
              },

              'Constrain ABS Y': {
                target: 'Await ABS Y info',
                cond: 'Can constrain ABS Y',
              },

              'Constrain angle': {
                target: 'Await angle info',
                cond: 'Can constrain angle',
              },

              'Constrain length': {
                target: 'Await length info',
                cond: 'Can constrain length',
              },

              'Constrain perpendicular distance': {
                target: 'Await perpendicular distance info',
                cond: 'Can constrain perpendicular distance',
              },

              'Constrain horizontally align': {
                cond: 'Can constrain horizontally align',
                target: 'SketchIdle',
                internal: true,
                actions: ['Constrain horizontally align'],
              },

              'Constrain vertically align': {
                cond: 'Can constrain vertically align',
                target: 'SketchIdle',
                internal: true,
                actions: ['Constrain vertically align'],
              },

              'Constrain snap to X': {
                cond: 'Can constrain snap to X',
                target: 'SketchIdle',
                internal: true,
                actions: ['Constrain snap to X'],
              },

              'Constrain snap to Y': {
                cond: 'Can constrain snap to Y',
                target: 'SketchIdle',
                internal: true,
                actions: ['Constrain snap to Y'],
              },

              'Constrain equal length': {
                cond: 'Can constrain equal length',
                target: 'SketchIdle',
                internal: true,
                actions: ['Constrain equal length'],
              },

              'Constrain parallel': {
                target: 'SketchIdle',
                internal: true,
                cond: 'Can canstrain parallel',
                actions: ['Constrain parallel'],
              },

              'Constrain remove constraints': {
                target: 'SketchIdle',
                internal: true,
                cond: 'Can constrain remove constraints',
                actions: ['Constrain remove constraints'],
              },

              'Re-execute': {
                target: 'SketchIdle',
                internal: true,
                actions: [
                  'set sketchMetadata from pathToNode',
                  'sketch mode enabled',
                  'edit mode enter',
                ],
              },

              'Equip Line tool 3': 'Line tool 3',

              'Equip tangential arc to 3': {
                target: 'Tangential arc to 3',
                cond: 'is editing existing sketch',
              },
            },

            entry: ['equip select'],
          },

          'Await horizontal distance info': {
            invoke: {
              src: 'Get horizontal info',
              id: 'get-horizontal-info',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
              onError: 'SketchIdle',
            },
          },

          'Await vertical distance info': {
            invoke: {
              src: 'Get vertical info',
              id: 'get-vertical-info',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
              onError: 'SketchIdle',
            },
          },

          'Await ABS X info': {
            invoke: {
              src: 'Get ABS X info',
              id: 'get-abs-x-info',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
              onError: 'SketchIdle',
            },
          },

          'Await ABS Y info': {
            invoke: {
              src: 'Get ABS Y info',
              id: 'get-abs-y-info',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
              onError: 'SketchIdle',
            },
          },

          'Await angle info': {
            invoke: {
              src: 'Get angle info',
              id: 'get-angle-info',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
              onError: 'SketchIdle',
            },
          },

          'Await length info': {
            invoke: {
              src: 'Get length info',
              id: 'get-length-info',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
              onError: 'SketchIdle',
            },
          },

          'Await perpendicular distance info': {
            invoke: {
              src: 'Get perpendicular distance info',
              id: 'get-perpendicular-distance-info',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
              onError: 'SketchIdle',
            },
          },

          'Line tool 3': {
            exit: [
              'tear down client sketch',
              'setup client side sketch segments',
            ],

            on: {
              'Set selection': {
                target: 'Line tool 3',
                description: `This is just here to stop one of the higher level "Set selections" firing when we are just trying to set the IDE code without triggering a full engine-execute`,
                internal: true,
              },

              'Equip tangential arc to 3': {
                target: 'Tangential arc to 3',
                cond: 'is editing existing sketch',
              },
            },

            states: {
              Init: {
                always: [
                  {
                    target: 'normal',
                    cond: 'is editing existing sketch',
                    actions: 'set up draft line 2',
                  },
                  'No Points',
                ],
              },

              normal: {
                on: {
                  'Set selection': {
                    target: 'normal',
                    internal: true,
                  },
                },
              },

              'No Points': {
                entry: 'setup noPoints onClick listener',

                on: {
                  'Add start point': {
                    target: 'normal',
                    actions: 'set up draft line without teardown',
                  },
                },
              },
            },

            initial: 'Init',
          },

          Init: {
            always: [
              {
                target: 'SketchIdle',
                cond: 'is editing existing sketch',
              },
              'Line tool 3',
            ],
          },

          'Tangential arc to 3': {
            exit: [
              'tear down client sketch',
              'setup client side sketch segments',
            ],

            entry: 'set up draft arc 2',

            on: {
              'Set selection': {
                target: 'Tangential arc to 3',
                internal: true,
              },

              'Equip Line tool 3': 'Line tool 3',
            },
          },
        },

        initial: 'Init',

        on: {
          CancelSketch: '.SketchIdle',
        },

        exit: [
          'sketch exit execute',
          'animate after sketch',
          'tear down client sketch',
          'remove sketch grid',
        ],

        entry: ['add axis n grid', 'setup client side sketch segments'],
      },

      'Sketch no face': {
        entry: 'show default planes',

        exit: 'hide default planes',
        on: {
          'Select default plane': {
            target: 'animating to plane',
            actions: ['reset sketch metadata'],
          },
        },
      },

      'animating to plane': {
        invoke: {
          src: 'animate-to-face',
          id: 'animate-to-face',
          onDone: {
            target: 'Sketch',
            actions: 'set new sketch metadata',
          },
        },

        on: {
          'Set selection': {
            target: 'animating to plane',
            internal: true,
          },
        },
      },

      'animating to existing sketch': {
        invoke: [
          {
            src: 'animate-to-sketch',
            id: 'animate-to-sketch',
            onDone: 'Sketch',
          },
        ],
      },
    },

    initial: 'idle',

    on: {
      Cancel: {
        target: 'idle',
        // TODO what if we're existing extrude equipped, should these actions still be fired?
        // maybe cancel needs to have a guard for if else logic?
        actions: [
          'edit_mode_exit',
          'default_camera_disable_sketch_mode',
          'reset sketch metadata',
        ],
      },

      'Set selection': {
        target: '#Modeling',
        internal: true,
        actions: 'Set selection',
      },
    },
  },
  {
    guards: {
      'is editing existing sketch': ({ sketchPathToNode }) => {
        // should check that the variable declaration is a pipeExpression
        // and that the pipeExpression contains a "startProfileAt" callExpression
        if (!sketchPathToNode) return false
        const variableDeclaration = getNodeFromPath<VariableDeclarator>(
          kclManager.ast,
          sketchPathToNode,
          'VariableDeclarator'
        ).node
        if (variableDeclaration.type !== 'VariableDeclarator') return false
        const pipeExpression = variableDeclaration.init
        if (pipeExpression.type !== 'PipeExpression') return false
        const hasStartProfileAt = pipeExpression.body.some(
          (item) =>
            item.type === 'CallExpression' &&
            item.callee.name === 'startProfileAt'
        )
        return hasStartProfileAt && pipeExpression.body.length > 2
      },
      'Can make selection horizontal': ({ selectionRanges }) =>
        horzVertInfo(selectionRanges, 'horizontal').enabled,
      'Can make selection vertical': ({ selectionRanges }) =>
        horzVertInfo(selectionRanges, 'vertical').enabled,
      'Can constrain horizontal distance': ({ selectionRanges }) =>
        horzVertDistanceInfo({ selectionRanges, constraint: 'setHorzDistance' })
          .enabled,
      'Can constrain vertical distance': ({ selectionRanges }) =>
        horzVertDistanceInfo({ selectionRanges, constraint: 'setVertDistance' })
          .enabled,
      'Can constrain ABS X': ({ selectionRanges }) =>
        absDistanceInfo({ selectionRanges, constraint: 'xAbs' }).enabled,
      'Can constrain ABS Y': ({ selectionRanges }) =>
        absDistanceInfo({ selectionRanges, constraint: 'yAbs' }).enabled,
      'Can constrain angle': ({ selectionRanges }) =>
        angleBetweenInfo({ selectionRanges }).enabled ||
        angleLengthInfo({ selectionRanges, angleOrLength: 'setAngle' }).enabled,
      'Can constrain length': ({ selectionRanges }) =>
        angleLengthInfo({ selectionRanges }).enabled,
      'Can constrain perpendicular distance': ({ selectionRanges }) =>
        intersectInfo({ selectionRanges }).enabled,
      'Can constrain horizontally align': ({ selectionRanges }) =>
        horzVertDistanceInfo({ selectionRanges, constraint: 'setHorzDistance' })
          .enabled,
      'Can constrain vertically align': ({ selectionRanges }) =>
        horzVertDistanceInfo({ selectionRanges, constraint: 'setHorzDistance' })
          .enabled,
      'Can constrain snap to X': ({ selectionRanges }) =>
        absDistanceInfo({ selectionRanges, constraint: 'snapToXAxis' }).enabled,
      'Can constrain snap to Y': ({ selectionRanges }) =>
        absDistanceInfo({ selectionRanges, constraint: 'snapToYAxis' }).enabled,
      'Can constrain equal length': ({ selectionRanges }) =>
        setEqualLengthInfo({ selectionRanges }).enabled,
      'Can canstrain parallel': ({ selectionRanges }) =>
        equalAngleInfo({ selectionRanges }).enabled,
      'Can constrain remove constraints': ({ selectionRanges }) =>
        removeConstrainingValuesInfo({ selectionRanges }).enabled,
    },
    // end guards
    actions: {
      'sketch mode enabled': ({ sketchPlaneId }) => {
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'sketch_mode_enable',
            plane_id: sketchPlaneId,
            ortho: true,
            animated: !isReducedMotion(),
          },
        })
      },
      'set sketchMetadata from pathToNode': assign(({ sketchPathToNode }) => {
        if (!sketchPathToNode) return {}
        return getSketchMetadataFromPathToNode(sketchPathToNode)
      }),
      'edit mode enter': ({ selectionRanges }) => {
        const pathId = isCursorInSketchCommandRange(
          engineCommandManager.artifactMap,
          selectionRanges
        )
        pathId &&
          engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: {
              type: 'edit_mode_enter',
              target: pathId,
            },
          })
      },
      'hide default planes': () => setupSingleton.removeDefaultPlanes(),
      edit_mode_exit: () =>
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: { type: 'edit_mode_exit' },
        }),
      default_camera_disable_sketch_mode: () =>
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: { type: 'default_camera_disable_sketch_mode' },
        }),
      'reset sketch metadata': assign({
        sketchPathToNode: null,
        sketchEnginePathId: '',
        sketchPlaneId: '',
      }),
      'set sketch metadata': assign(({ selectionRanges }) => {
        const sourceRange = selectionRanges.codeBasedSelections[0].range
        const sketchPathToNode = getNodePathFromSourceRange(
          kclManager.ast,
          sourceRange
        )
        return getSketchMetadataFromPathToNode(
          sketchPathToNode,
          selectionRanges
        )
      }),
      // TODO figure out why data isn't typed with sketchPathToNode and sketchNormalBackUp
      'set new sketch metadata': assign((_, { data }) => data as any),
      'equip select': () =>
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'set_tool',
            tool: 'select',
          },
        }),
      // TODO implement source ranges for all of these constraints
      // need to make the async like the modal constraints
      'Make selection horizontal': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintHorzVert(
          selectionRanges,
          'horizontal',
          kclManager.ast,
          kclManager.programMemory
        )
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Make selection vertical': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintHorzVert(
          selectionRanges,
          'vertical',
          kclManager.ast,
          kclManager.programMemory
        )
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain horizontally align': ({
        selectionRanges,
        sketchPathToNode,
      }) => {
        const { modifiedAst } = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setVertDistance',
        })
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain vertically align': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setHorzDistance',
        })
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain snap to X': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToXAxis',
        })
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain snap to Y': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToYAxis',
        })
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain equal length': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintEqualLength({
          selectionRanges,
        })
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain parallel': ({ selectionRanges, sketchPathToNode }) => {
        const { modifiedAst } = applyConstraintEqualAngle({
          selectionRanges,
        })
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'Constrain remove constraints': ({
        selectionRanges,
        sketchPathToNode,
      }) => {
        const { modifiedAst } = applyRemoveConstrainingValues({
          selectionRanges,
        })
        clientSideScene.updateAstAndRejigSketch(
          sketchPathToNode || [],
          modifiedAst
        )
      },
      'AST extrude': (_, event) => {
        if (!event.data) return
        const { selection, distance } = event.data
        const pathToNode = getNodePathFromSourceRange(
          kclManager.ast,
          selection.codeBasedSelections[0].range
        )
        const { modifiedAst, pathToExtrudeArg } = extrudeSketch(
          kclManager.ast,
          pathToNode,
          true,
          distance
        )
        // TODO not handling focusPath correctly I think
        kclManager.updateAst(modifiedAst, true, {
          focusPath: pathToExtrudeArg,
        })
      },
      'setup client side sketch segments': ({ sketchPathToNode }, { type }) => {
        if (type !== 'done.invoke.animate-to-face') {
          clientSideScene.setupSketch({
            sketchPathToNode: sketchPathToNode || [],
          })
        } else {
          setupSingleton.modelingSend('Equip Line tool 3')
        }
      },
      'animate after sketch': () => {
        clientSideScene.animateAfterSketch()
      },
      'tear down client sketch': () =>
        clientSideScene.tearDownSketch({ removeAxis: false }),
      'remove sketch grid': () => clientSideScene.removeSketchGrid(),
      'set up draft line 2': ({ sketchPathToNode }) => {
        clientSideScene.setUpDraftLine(sketchPathToNode || [])
      },
      'set up draft arc 2': ({ sketchPathToNode }) => {
        clientSideScene.setUpDraftArc(sketchPathToNode || [])
      },
      'set up draft line without teardown': ({ sketchPathToNode }) =>
        clientSideScene.setupSketch({
          sketchPathToNode: sketchPathToNode || [],
          draftSegment: 'line',
        }),
      'show default planes': () => {
        setupSingleton.showDefaultPlanes()
        clientSideScene.setupDefaultPlaneHover()
      },
      'setup noPoints onClick listener': ({ sketchPathToNode }) => {
        clientSideScene.createIntersectionPlane()
        const sketchGroup = sketchGroupFromPathToNode({
          pathToNode: sketchPathToNode || [],
          ast: kclManager.ast,
          programMemory: kclManager.programMemory,
        })
        const quaternion = quaternionFromSketchGroup(sketchGroup)
        clientSideScene.intersectionPlane &&
          clientSideScene.intersectionPlane.setRotationFromQuaternion(
            quaternion
          )
        setupSingleton.setCallbacks({
          onClick: async (args) => {
            if (!args) return
            const { intersection2d } = args
            if (!intersection2d || !sketchPathToNode) return
            const { modifiedAst } = addStartProfileAt(
              kclManager.ast,
              sketchPathToNode,
              [intersection2d.x, intersection2d.y]
            )
            await kclManager.updateAst(modifiedAst, false)
            clientSideScene.removeIntersectionPlane()
            setupSingleton.modelingSend('Add start point')
          },
        })
      },
      'add axis n grid': ({ sketchPathToNode }) =>
        clientSideScene.createSketchAxis(sketchPathToNode || []),
    },
    // end actions
  }
)

function getSketchMetadataFromPathToNode(
  pathToNode: PathToNode,
  selectionRanges?: Selections
) {
  const pipeExpression = getNodeFromPath<PipeExpression>(
    kclManager.ast,
    pathToNode,
    'PipeExpression'
  ).node
  if (pipeExpression.type !== 'PipeExpression') return {}
  const sketchCallExpression = pipeExpression.body.find(
    (e) => e.type === 'CallExpression' && e.callee.name === 'startSketchOn'
  ) as CallExpression
  if (!sketchCallExpression) return {}

  let sketchEnginePathId: string
  if (selectionRanges) {
    sketchEnginePathId =
      isCursorInSketchCommandRange(
        engineCommandManager.artifactMap,
        selectionRanges
      ) || ''
  } else {
    const _selectionRanges: Selections = {
      otherSelections: [],
      codeBasedSelections: [
        { range: [pipeExpression.start, pipeExpression.end], type: 'default' },
      ],
    }
    sketchEnginePathId =
      isCursorInSketchCommandRange(
        engineCommandManager.artifactMap,
        _selectionRanges
      ) || ''
  }
  return {
    sketchPathToNode: pathToNode,
    sketchEnginePathId,
  }
}
