import { PathToNode } from 'lang/wasm'
import { engineCommandManager } from 'lang/std/engineConnection'
import { DefaultPlanes } from 'lang/std/engineConnectionManagerUtils'
import { isReducedMotion, updateCursors } from 'lang/util'
import { Axis, Selection, Selections } from 'useStore'
import { assign, createMachine } from 'xstate'
import { v4 as uuidv4 } from 'uuid'
import { isCursorInSketchCommandRange } from 'hooks/useAppMode'
import { getNodePathFromSourceRange } from 'lang/queryAst'
import { kclManager } from 'lang/KclSinglton'
import { ConstraintType } from 'lang/std/sketchcombos'
import {
  horzVertInfo,
  applyConstraintHorzVert,
} from 'components/Toolbar/HorzVert'
import { horzVertDistanceInfo } from 'components/Toolbar/SetHorzVertDistance'

export const MODELING_PERSIST_KEY = 'MODELING_PERSIST_KEY'

const constraintActions: ConstraintType[] = ['vertical', 'horizontal']

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogAsAJgA0IAJ6IAjAGYaAVgB0gwQE5Zm2dOkAOYQtkBfI+LQYc+JdgiYwBAMph2AAlhYw5Tt1oMkIFjZvHn8BBEEFXSUabQMANlk1AHZBRKTxKQRpYTjpJTikyI043TVpAsETM3QsPChrW3sAETgPLxcWPHZfXkCOLhDQMNk45QUaJN0J1QUFQSmFDJk5KJy1OLjUueFhNWEqkHNaqxs7Ahb3O3bIGB7-PuDeYY3oybkkmkFRwSTkpayaNJBEpdAktoC9mV9qZDjVLPVTs1WldXCQ+NhYHdmKx+twnohZElhEpCjQyXthElRiM4v9SnkIkTFCUtsYYUd4Q0zk4UR1UF0sQEcY9QkIaFF5qlSqC5skaLTJIgqVFFDRkmC1IIgboDhy6lz7DzPK4bmBBQ8BvjwuKVLopWoZep0oqEJtgW7dNIJnI5lrdXD9YjHG1UejMfResLLaLwrJiXE1YkDBD5Wp-nMotIynE1AphECFCU2dULIHGsHeQAzEiUc1RvExwQ2yWySKAhTrOPOzIiYGTWYaSlJKl5-2lk7lgCiuHYYAATm4ANbOcgACzrQWjQ0QBVkrxird0k0pukWLuEcfySU04tmOhSlLHxwRU5n86XK-X0j82M3De3rrXvumiRMe-b-NkEQkh2wgRJ6F7jHET6ckGk4AI4AK7YEwLhgHw7BzhhGAbrigz8DuQETAeoH6OBLpfEkShers8r6JqKQ6uyAYTmc6FYTheEEURZrfpGf5kWEu7AYeYGnum0iMQm8iKKkNAXhoyFlmcFwhi41a1hG9z1hJBIfPkca0YkoFfP88h5ISxSJCI+g5ppPGGrpJCYJgJEigBWp7jsoyTCIZKzGemTCJ8Sh7HEsF2lKCjMW5L7acixouF5PmGb+pFWrInoqJsugOWpOgKpkhV5mSMR6FqXwxClBoEHx2F6dg3nOL5W7kYBe5USBR60XJLoLExMQ1U2nxqU1qGYW1lYdXY3SiUZ4lWlJA0ycNEWIKeygJrsSTlBN2iVFx471A4y7sGuxBkJQmDXZ+3X-r1BjaDFuilK24pqMkhgQRMxLlJEozCFM9JJE1z23auSiw2uACS5ZGu0nQzq9JkILsmwkrsBUOjV0gKN2SovHaebXiksgiLMMM3WuCOM6uKPcrp7hQAAtmAmM5UK60xrjfYE9KxMVTul6FFsR5yHsPwM5+zOfmzSKXBlGPdPzFpvWEuz5tBENJrjgLptFCzaAmJSTMWsKXcrcMO8j5Y6bynM83zP4C3lQtlP1dqgtkWa47ZRJKIkJOQ+o+ifEhF3Pk78OI6z5bICQy5uGA3O864ABu86cOQXlY1aENTDFap6DS+h2hLWRHSohigokMT6OoiuO8nqsEGnGfuznLirqgc7YAAXtw7DF9rxml6CwKaOoWpqh8BiCBBWYHf9cw1VF6zQ-HnLJ4n3etTh7CoKg2Vezr2NagYIJgjmcVUiT-yqCqGgpJsOhfAYHdM13Kc80cJc1QPnFw59L4l0bECRiExjrS2HLKdeXoVA21yKedQewFD-yTizbuThXDqy8AMaBAE7J7hGDsU8CYyT6H+NmJiCZjo-CSuKHQuDj7liINwWABESB4EHsPMeE8vIuAgBiSeFAzTT0FgBI2UQHRElpqedYhY14uiBOsaI8gmxxiirMHYnDAFnB4bgPhc4BG4BcPnOchcxESL4Q9GR18Z5C32koQsJMtTZH+rRCCiRMxsSUheAq0ISwJyPgAGTwGAFwAAVC+mAWrAJcKA8BkCr5iR9v5CI88LIxDinsL0u0EAaDUExQklJl7v0KJwmJuA4mJMvkoAACvyGcLgACCEAMAQAID0iAfIBSyJyb1cYDoSSghjnaHQYgXQfD3OUZIqgqRKUUPU2JCSkkIyzh7VwgzIADN6cMz22S-LjIbpMEo8p4Gk1KXFZQWY4yJmHLkIEmzGnbJaU4bOnTDn9J4VzJgy04mWBcecnqYRZQVMSN-H42Qwr-BKBUnM2ghrzE+HsT5TSdm-P2d03pRzT4uEaQAdwgUksh4zLZKByCorB2D5mZDzFEFI5ICrXNbDgg++polbOaZgJQSNcAcAINSsIMwGSlEMJqOKrZ0x2nyDmamz8nT7wiYfFmSgGm4paSKsVVBVq5QuZKiI0rcxOXlaUokUQ4XaDkICQof9eVWH5V8wVSgAByqAXDtK6LAY5QzNYSqEPoYk2gyQkzJMOb6-wiRxCYl8S2ZRQojE4QACWEePGcDjJHOLSegLyBAIDcDANYXAudUDLiUDAdgABaIeI8c2T0wPWvAlZUChoQAVeY+RSYUhSIYTYEFDDEimETNiIg6muqutqrNzbRGYHEfm6RhaIDFvnHOYeSgQUkHYJ2ucXNa3OEbdmpd7bcCdu7b22FBhZblGvNoCC8xlBqVGGqXMsERg8s1Xy7VAA1Au2Ai7LscVIyg67i2lsaRWqtNa631tsfYttHau2jNNQSDxCZ5j0p0BoWQL6FIkh-fmblLdbZ6jdYB4DoGV1OLXaAjdySt07r3Qe4ex7EPIZA15S916MNQqw7MfInwXIOoIwEsyF5wZAhGArWdShJz4UIhgEtZa4PVvLUQOcYB91xMEqpiFa0xmSUoos7aJ5SlyC1HSmCUrcx7E4n+qwymhJqZJYZ4S3avRAXGGSSk2YIY2RdB+kEhgVLXnlPmX9dsE5uaMyk-iuEVPeeNd7TDAI-M71+OUYLdcIvjWUnMeQ6lKPcXqAl4SwrUa6X0sZk1QmsjqGUBDbIoIDAKViOmeQ41dhamvPePQTUqsYF2SiAYLgABKemIASGDK4cDzifOehoHS0o4ofggWvBollhJw55mKBoco0hcGkt9fVisGV6vdpi2y9Yag1LrCmDG9euYQS7AHDXGLTUABiS1nDqdg3geD2ndP6fap1LWri5G9U2hZmiVmga-AO7sYptzUh-YB+wJLC1sc+d854ya+YCOlIdFEU8pW1QxACnHFz9R-tQ9xzhRaUOjUw9M8sCYROyQiGeQq0aJQisxAi7vUoWOoc1fZryU0PnCyBXgklL0BRNS6DpELr08hWxU4dGoCXy1xvGkmzNkgc2FsuEsRIjC4YOeZb0CVA7ClYITA2BZBh31ws65p3IOncXOSM4N2jYI03ZvzaD7haADWMtNad8oT0owsyqEgsOBhmhPdYo+BMWZJgYS4BqPAfwVGoCQt1ogetdd63KGSH434PjPiwVO4pxEJfb5xU8S3AoKryi00I5okYSyWKV2+nJ8r9tk4t9LvMPc5ONDjFKADXvkV9v0gHDsH4w5PjGPwY0CfvsPf-R-uqFXlJkeJohtLRFakF44u+ZgXf-ltAVN1x2PMj+9Bv1s87xQmpppJXCX7-9JWXVW-JQJoMte-cZQoRNMKFhBMUmY6eNe+e1PQHINrVsG-T1f1f5IlCACAyVXMZQWvOKXYRFXIRAxNTYBIeKEcWWDAvFPZAeAFPAxAQwOQJiY7efCIMKG1HIfIZNag0YWgxTd1PVIVA1dgZg2MAoL6RzV-LMd-BZKKOlXGJSWYVsVQOglpH1P1DpdgAvRrUvcIHMCnBeIcMoSIZlJUXgyglNIEKKdNYQ7VNAcBQVSQ1QVIfIKYDeR7CYUmIGUEGKG2SIX0MwzNc9XNMDVdSDJjLySQ2mQwcOVRGIamcYMmZrPYcOKKew1SY6RqRwpWIDOxXjSIhjaIotO-EzTLWmIXZURZNSJKUoOud4d0NiUmQEHICoEbVLDASQ5iMYHLILWuWyd7Q6OVF+ckf-IvJTbo8tVWXonxKZbIG2HYC8coHrNbdZFSUrJyLo9zctIPY3UPXohIWFJKDsIpAmHrRiSnGqBIeUJBXYozJQE3ObXozsGKBMOVdFSIXbFg5fCLMkO4goKkM7PPPSGsMASQzUPIIEeUadKKL4EdTRXeaCbBdsIkIkfXZwXo7-HnevfnG1NPdZPRR-KhLE9gKXSEyomPH4CpN4b9BSIkL9dXKIdZbXNSNUcXRTAPZwQ3EhbgEPU3TIAw7GBSbIFQIEL0fQQkTBX4spUoA7L3WmH3ck54o46kwwqKLMTxL4B0XeLeP4F0XXRUjkx7ZUhwkwIAA */
    id: 'Modeling',

    tsTypes: {} as import('./modelingMachine.typegen').Typegen0,
    predictableActionArguments: true,
    preserveActionOrder: true,

    context: {
      guiMode: 'default',
      selection: [] as string[],
      defaultPlanes: new DefaultPlanes(engineCommandManager) as DefaultPlanes,
      selectionRanges: {
        otherSelections: [],
        codeBasedSelections: [],
      } as Selections,
      sketchPathToNode: null as PathToNode | null, // maybe too specific, and we should have a generic pathToNode, but being specific seems less risky when I'm not sure
      sketchEnginePathId: '' as string,
    },

    schema: {
      events: {} as
        | { type: 'Deselect all' }
        | { type: 'Deselect edge'; data: Selection & { type: 'edge' } }
        | { type: 'Deselect axis'; data: Axis }
        | {
            type: 'Deselect segment'
            data: Selection & { type: 'line' | 'arc' }
          }
        | { type: 'Deselect face'; data: Selection & { type: 'face' } }
        | {
            type: 'Deselect point'
            data: Selection & { type: 'point' | 'line-end' | 'line-mid' }
          }
        | { type: 'Equip extrude' }
        | { type: 'Equip fillet' }
        | { type: 'Enter sketch' }
        | { type: 'Select all'; data: Selection & { type: 'all ' } }
        | { type: 'Select edge'; data: Selection & { type: 'edge' } }
        | { type: 'Select axis'; data: Axis }
        | { type: 'Select segment'; data: Selection & { type: 'line' | 'arc' } }
        | { type: 'Select face'; data: Selection & { type: 'face' } }
        | { type: 'Set selection'; data: Selections }
        | {
            type: 'Select point'
            data: Selection & { type: 'point' | 'line-end' | 'line-mid' }
          }
        | { type: 'Sketch no face' }
        | { type: 'Toggle gui mode' }
        | { type: 'Cancel' }
        | { type: 'CancelSketch' }
        | { type: 'Add point'; data: { x: number; y: number }[] }
        | { type: 'Equip tool' }
        | { type: 'Equip move tool' }
        | { type: 'Set radius' }
        | { type: 'Make segment horizontal' }
        | { type: 'Make segment vertical' }
        | { type: 'Complete line' }
        | { type: 'Set distance' }
        | { type: 'Equip new tool' }
        | { type: 'Set Default Planes'; data: DefaultPlanes }
        | { type: 'update_code'; data: string }
        | { type: 'Constrain horizontal distance' }
        | { type: 'Constrain vertical distance' },
    },

    states: {
      idle: {
        on: {
          'Set selection': {
            target: 'idle',
            internal: true,
            actions: 'Set selection',
          },
          'Deselect point': {
            target: 'idle',
            internal: true,
            actions: [
              'Remove from code-based selection',
              'Update code selection cursors',
              // 'Engine: remove highlight',
            ],
            cond: 'Selection contains point',
          },

          'Deselect edge': {
            target: 'idle',
            internal: true,
            actions: [
              'Remove from code-based selection',
              'Update code selection cursors',
              // 'Engine: remove highlight',
            ],
            cond: 'Selection contains edge',
          },

          'Deselect axis': {
            target: 'idle',
            internal: true,
            actions: [
              'Remove from other selection',
              'Update code selection cursors',
              // 'Engine: remove highlight',
            ],
            cond: 'Selection contains axis',
          },

          'Select point': {
            target: 'idle',
            internal: true,
            actions: [
              'Add to code-based selection',
              'Update code selection cursors',
              // 'Engine: add highlight',
            ],
          },

          'Select edge': {
            target: 'idle',
            internal: true,
            actions: [
              'Add to code-based selection',
              'Update code selection cursors',
              // 'Engine: add highlight',
            ],
          },

          'Select axis': {
            target: 'idle',
            internal: true,
            actions: [
              'Add to other selection',
              // 'Engine: add highlight',
            ],
          },

          'Select face': {
            target: 'idle',
            internal: true,
            actions: [
              'Add to code-based selection',
              'Update code selection cursors',
              // 'Engine: add highlight',
            ],
          },

          'Enter sketch': [
            {
              target: 'Sketch',
              cond: 'Selection is one face',
              actions: [
                'sketch mode enabled',
                'edit mode enter',
                'set sketchPathToNode',
              ],
            },
            'Sketch no face',
          ],

          'Equip extrude': [
            {
              target: 'Extrude',
              cond: 'Selection is empty',
            },
            {
              target: 'Extrude',
              cond: 'Selection is one face',
            },
          ],

          'Deselect face': {
            target: 'idle',
            internal: true,
            actions: [
              'Remove from code-based selection',
              'Update code selection cursors',
              // 'Engine: remove highlight',
            ],
            cond: 'Selection contains face',
          },

          'Select all': {
            target: 'idle',
            internal: true,
            actions: 'Add to code-based selection',
          },

          'Deselect all': {
            target: 'idle',
            internal: true,
            actions: [
              'Clear selection',
              'Update code selection cursors',
              // 'Engine: remove highlight',
            ],
            cond: 'Selection is not empty',
          },

          'Equip fillet': [
            {
              target: 'Fillet',
              cond: 'Selection is empty',
            },
            {
              target: 'Fillet',
              cond: 'Selection is one or more edges',
            },
          ],
        },
      },

      Sketch: {
        states: {
          SketchIdle: {
            on: {
              'Select point': {
                target: 'SketchIdle',
                internal: true,
                actions: [
                  'Update code selection cursors',
                  'Add to code-based selection',
                ],
              },

              'Select segment': {
                target: 'SketchIdle',
                internal: true,
                actions: [
                  'Update code selection cursors',
                  'Add to code-based selection',
                ],
              },

              'Deselect point': {
                target: 'SketchIdle',
                internal: true,
                cond: 'Selection contains point',
                actions: [
                  'Update code selection cursors',
                  'Add to code-based selection',
                ],
              },

              'Deselect segment': {
                target: 'SketchIdle',
                internal: true,
                cond: 'Selection contains line',
                actions: [
                  'Update code selection cursors',
                  'Add to code-based selection',
                ],
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

              'Equip tool': {
                target: 'Line Tool',
                actions: 'set tool line',
              },

              'Equip move tool': 'Move Tool',

              'Set selection': {
                target: 'SketchIdle',
                internal: true,
                actions: 'Set selection',
              },

              'Constrain horizontal distance': {
                target: 'Horizontal distance modal',
                cond: 'Can constrain horizontal distance',
              },
              'Constrain vertical distance': {
                target: 'Vertical distance modal',
                cond: 'Can constrain vertical distance',
              },
            },

            entry: 'equip select',
          },

          'Line Tool': {
            states: {
              Done: {
                type: 'final',
              },

              'Point Added': {
                on: {
                  'Add point': {
                    target: 'Segment Added',
                    actions: ['AST start new sketch'],
                  },
                },
              },

              'Segment Added': {
                on: {
                  'Add point': {
                    target: 'Segment Added',
                    internal: true,
                    actions: ['AST add line segment'],
                  },

                  'Complete line': {
                    target: 'Done',
                    actions: ['Modify AST', 'Update code selection cursors'],
                  },

                  'Equip new tool': {
                    target: 'Segment Added',
                    internal: true,
                    actions: 'set tool',
                  },
                },
              },

              Init: {
                always: [
                  {
                    target: 'Segment Added',
                    cond: 'is editing existing sketch',
                  },
                  'No Points',
                ],
              },

              'No Points': {
                on: {
                  'Add point': 'Point Added',
                },
              },
            },

            // invoke: [
            //   {
            //     src: 'createLine',
            //     id: 'Create line',
            //     onDone: 'SketchIdle',
            //   },
            // ],
            initial: 'Init',

            on: {
              'Equip move tool': 'Move Tool',
            },
          },

          'Move Tool': {
            entry: 'set tool move',
          },

          'Horizontal distance modal': {
            invoke: {
              src: 'Get horizontal info',
              id: 'get-horizontal-info',
              onDone: 'SketchIdle',
              onError: 'SketchIdle',
            },
          },
          'Vertical distance modal': {
            invoke: {
              src: 'Get vertical info',
              id: 'get-vertical-info',
              onDone: 'SketchIdle',
              onError: 'SketchIdle',
            },
          },
        },

        initial: 'SketchIdle',

        on: {
          CancelSketch: '.SketchIdle',
        },

        exit: 'sketch exit execute',
      },

      Extrude: {
        states: {
          Idle: {
            on: {
              'Select face': 'Selection Ready',
            },
          },
          'Selection Ready': {
            on: {
              'Set distance': 'Ready',
            },
          },
          Ready: {},
        },

        initial: 'Idle',

        on: {
          'Equip extrude': [
            {
              target: '.Selection Ready',
              cond: 'Selection is one face',
            },
            '.Idle',
          ],
        },

        invoke: {
          src: 'createExtrude',
          id: 'Create extrude',
          onDone: {
            target: 'idle',
            actions: ['Modify AST', 'Clear selection'],
          },
        },
      },

      'Sketch no face': {
        on: {
          'Select face': {
            target: 'Sketch',
            actions: [
              'sketch mode enabled',
              'reset sketchPathToNode',
              'create path',
            ],
          },
        },

        entry: 'show default planes',
        exit: 'hide default planes',
      },

      Fillet: {
        states: {
          Idle: {
            on: {
              'Select edge': 'Selection Ready',
            },
          },
          'Selection Ready': {
            on: {
              'Set radius': 'Ready',

              'Select edge': {
                target: 'Selection Ready',
                internal: true,
              },
            },
          },
          Ready: {},
        },

        initial: 'Ready',

        on: {
          'Equip fillet': [
            {
              target: '.Selection Ready',
              cond: 'Selection is one or more edges',
            },
            '.Idle',
          ],
        },

        invoke: {
          src: 'createFillet',
          id: 'Create fillet',
          onDone: {
            target: 'idle',
            actions: ['Modify AST', 'Clear selection'],
          },
        },
      },
    },

    initial: 'idle',

    on: {
      Cancel: {
        target: 'idle',
        // TODO what if we're existing extrude equiped, should these actions still be fired?
        // mabye cancel needs to have a guard for if else logic?
        actions: [
          'edit_mode_exit',
          'default_camera_disable_sketch_mode',
          'reset sketchPathToNode',
        ],
      },
    },
  },
  {
    guards: {
      'is editing existing sketch': ({ sketchPathToNode }) =>
        !!sketchPathToNode,
      'Can make selection horizontal': ({ selectionRanges }) =>
        horzVertInfo(selectionRanges, 'horizontal').enabled,
      'Can make selection vertical': ({ selectionRanges }) =>
        horzVertInfo(selectionRanges, 'vertical').enabled,
      'Can constrain horizontal distance': ({ selectionRanges }) =>
        horzVertDistanceInfo({ selectionRanges, constraint: 'setHorzDistance' })
          .enabled,
      'Can constrain vertical distance': ({ selectionRanges }) =>
        horzVertDistanceInfo({ selectionRanges, constraint: 'setHorzDistance' })
          .enabled,
    },
    actions: {
      'Set selection': assign({
        selectionRanges: (_, event) => event.data,
      }),
      'Add to code-based selection': assign({
        selectionRanges: ({ selectionRanges }, event) => ({
          ...selectionRanges,
          codeBasedSelections: [
            ...selectionRanges.codeBasedSelections,
            event.data,
          ],
        }),
      }),
      'Add to other selection': assign({
        selectionRanges: ({ selectionRanges }, event) => ({
          ...selectionRanges,
          otherSelections: [...selectionRanges.otherSelections, event.data],
        }),
      }),
      'Remove from code-based selection': assign({
        selectionRanges: ({ selectionRanges }, event) => ({
          ...selectionRanges,
          codeBasedSelections: [
            ...selectionRanges.codeBasedSelections,
            event.data,
          ],
        }),
      }),
      'Remove from other selection': assign({
        selectionRanges: ({ selectionRanges }, event) => ({
          ...selectionRanges,
          otherSelections: [...selectionRanges.otherSelections, event.data],
        }),
      }),
      'Clear selection': assign({
        selectionRanges: () => ({
          otherSelections: [],
          codeBasedSelections: [],
        }),
      }),
      'sketch mode enabled': ({ defaultPlanes }) => {
        // TODO we're always assuming that they want to sketch on the xy plane!
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'sketch_mode_enable',
            plane_id: defaultPlanes.xy,
            ortho: true,
            animated: !isReducedMotion(),
          },
        })
      },
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
      'hide default planes': ({ defaultPlanes }) => {
        defaultPlanes.hidePlanes()
      },
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
      'reset sketchPathToNode': assign({
        sketchPathToNode: null,
        sketchEnginePathId: '',
      }),
      'set sketchPathToNode': assign(({ selectionRanges }) => {
        const sourceRange = selectionRanges.codeBasedSelections[0].range
        const sketchPathToNode = getNodePathFromSourceRange(
          kclManager.ast,
          sourceRange
        )
        const sketchEnginePathId =
          isCursorInSketchCommandRange(
            engineCommandManager.artifactMap,
            selectionRanges
          ) || ''
        return {
          sketchPathToNode,
          sketchEnginePathId,
        }
      }),
      'set tool line': () =>
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'set_tool',
            tool: 'sketch_line',
          },
        }),
      'equip select': () =>
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'set_tool',
            tool: 'select',
          },
        }),
      'set tool move': () =>
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'set_tool',
            tool: 'move',
          },
        }),
      'Make selection horizontal': ({ selectionRanges }) => {
        const { modifiedAst, pathToNodeMap } = applyConstraintHorzVert(
          selectionRanges,
          'horizontal',
          kclManager.ast,
          kclManager.programMemory
        )
        kclManager.updateAst(modifiedAst, true, {
          // TODO re implement cursor shit
          // callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
        })
      },
      'Make selection vertical': ({ selectionRanges }) => {
        const { modifiedAst, pathToNodeMap } = applyConstraintHorzVert(
          selectionRanges,
          'vertical',
          kclManager.ast,
          kclManager.programMemory
        )
        kclManager.updateAst(modifiedAst, true, {
          // TODO re implement cursor shit
          // callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
        })
      },
    },
  }
)
