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
  HorzVertInfo,
  applyConstraintHorzVert,
} from 'components/Toolbar/HorzVert'

export const MODELING_PERSIST_KEY = 'MODELING_PERSIST_KEY'

const constraintActions: ConstraintType[] = ['vertical', 'horizontal']

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogBMNAHQBWGgEYAbNICc0gCzTJAdkU0xAGhABPRAFpFgueIAca1UoDMY1WMVWAvk51oMOfCOwRMYAgDKYOwABLBYYOSc3LQMSCAsbNE88QIIZtIiknKKZoIaNJr2NKo6+giStiLW9rUSgmKSUi5u6Fh4UN6+-gAicBFRISx47LG8iRxcKaBpBtZmphpW82qKcmqSZYiSlSJmZqo7ZmILgtLC1i0g7u1ePn4EfeF+g5AwY-ETybyz1nLWIgaslUcgagkkxmk2j0hkUikB2Wkqho1nywn2l1c1zank6916-ReoRIfGwsA+zFYk24P0MqhMgLEZ0a80c0nmWwQRnh4IUyNRxhoBzMVxuuK6DyCRKGqBGFISVO+qUMNVE6lB8mOVisSM58wB5xoSMUYlBchOglFOI6Ev8UsioTeYHlXymtK51mkZhEchR1houSaSLEUM5YjEAMEJij0hR5t9citHht+MCA2JpPJ9HGirdyq5skWmih+wcDWyYc9IhRNH+XoaEZMSdueO6aelADMSJQXbmafm5qa9odBCCpCGdnDOfTREaIebw7HcmJm+LUwBRXDsMAAJzCAGtguQABa9pJ5maIWQ+2uqBbWOGqhacgzZVQiRylw4qTRnVcpttN23PdYEPdgTyoSQ4kpc9+0vBBDhEVRUQUDRwTjJkXz+D8H3+fY0J2S0sTFACHnXABHABXbAmBCMA+HYHdKIwM9qWmfghFHQETEaVRkRkOQFDDPIPz4s1FFsX0-n-O5AKomi6IYpiWKgnNYPYtJwUkPZ2XBCw7zkMxa2kTl2VEf4hXsc4lHpRNiOtWSHiedMQi7Hts0+PsNJVf4RFkRRJBDOQ+OMdRShhLk32qIUSgWSxgpk1tJRckhMEwVilXguZr0KJRskEeYjJMTkFnfIFbAhRpjAURLbUeQkHRCVL0o8mC2PdOZgqQhwTWOOF1kcLCJCyX0zFyEcQ3BWqN3k2iO2wNLggyi8OIQAr4WsSQLGyXIAwXcLynWUxDKaOxazOUFprk6i5oWvxRlUzz1PdHadKkKx1jGrb2U5QSDRKGQVC+2NVFqgIwJPYgyEoTBwaPU9WoVZ780qZCfRkLazHmYKzhMiKjAyLIgykwzBJDRQwYh48RDh8DjwASTbe1BmGLdlrg1b42rE1jGOWxrE2uROVECQMhxs59nkWtKfhmmqcZ5LpXCKAAFswDZxHXQ5tIFEyJk7yWC1f05SRwWqX0oVyQTjiFaQZbpuX4YVglnka1nRk1rz3XWTIhUFwpcr+IX8a20wowfJphC9FQkXtk9Hbp536tdwZlbVjXoKR9r819d8AtNw5BMCwSsIKrJ5C9KwJICtZMVaZMvFp+Om4ZttkBIQ8wjAVX1dCAA3XdOHIVL2e8ipWXEZEoT+SFAuhcoakEaspHOfCMgF0H7IbzoW4Tk8k-bzu097kJj1QHdsAAL24dgR895H4IhMuMgjZDfRRcNrE5QRCa2gWTE2soIUcI47UxbknCiN0QjsFQKgFqmctZj0CnxPyJQkQ-yUNGA6hhQ5IU+iCHYm1-Q1S3i2PeYD5bXQUirVAA9oGwPgWpbO8Eo5LzWIZP4Rp-QFXnjgnkEgIQVU+uaO8oDyFJyCKEFOyRR4vThN6UEUYaAFUKrnacPIxrKJjiaIhddsTb3ISIAAMngMAIQAAqDCCCQOobQsxMC4GyPzGcM2oIDbgkwQVF8EJGRSAko0YRdgRSkPFLvExuAzGWLgSIAACrKLcIQACCEAMAQAIMkiAMo5T32YatBoxhxCOH9OyZY6wXzKCXn9T0-x-R-AkJveuZCwmmIsQwmm3d06hAyZAdJKSskZyYZlPJeRvSBR2Og-4awzDlNjD6ZCeQf6R3kOGMR4TIltKCD3BJ3S0lEFQCrJg90zGeGdDkoZaR-SBXLoiA4lQV5YSNICGoqFKgYgtqslpUTMDtK2V0lJPSbG0QiQAd3oY4s5K1NJ5FMH47Ihkxq5G8ciJCKIzibRnJou2ISbTNIia06J9NcAcAIE4lhr0ZAnEaGcfk0yQ5lwFkyfJkypJ6JIo3KmxjPltMJcSyCCCvbOKjKYIyIYbJRyMoobx+wfQnXmA4eFKgKbYvZbLNZ+LvkADlUAhDiSMWAvTMnu1JXk7hH4oRQhnMIKc+MeZ7FsFZdQno-61XXEpZi-gIDcDAN4XAfdUCHhEEQHcYASDbkUoxd1xqLljWrOaHiEZTR8klRFT0AItTBR2PST0JgGn6LIa6iNGBrGzXDcpU5-KH6cwWD6UcDhLJY0IqZRC+TbAlFRGMoijTxQFrLcWqB9FC3Okem1c5V4rB7FHIUTak0gRNu0i2vio58gWFZQ5ToPb3UiAkS5Ny5bBmQsQMcUwyDTR8TueaZN5Q7yZEmYDBoUkQHKvXW6jA7SiRTBCAAJRDRAXQaZQgQDJLfCge6nq5LSKbCSWRlxRhDMo0E05CZaLlZ6YyCUn3kJCLgbVu72yNV3VGxAQSkI1DMgsc1jQXyZDONkU27bawCxyLVAAYndYIBBPURJ9X6gNQaQ1hvmotD2FbwNCEEh+U0uFAqrwcCbW2SFhCgiKiGOwK4MOsaE32hSgn7qEYQMFb0JYgkqAfAIuTIIdJzzhF6QojQWNsfYFp26Qm+X7u1leX+Nc+JjSxusQQ5nhUqHDNZoyAZc1ss6Bp+6W6mYuSdHp0qgJcgZCRPIXGtLyhHHhFIHYRp6THAOPZoTb6HQfu-SQX9-6Qg7gq9gSiWYROjoqKOG9Eg-iVGzdZk2W1ss7CDPlk44W10iCi8EErUQys-r-czR00BQMjoPRUNQpg6nKMg6OLaJseI+nmKiyoChlFqaxNhjA8B4gRbc2PAwfEypMihK8tkHJ8aLo-DU62c8xpDYMfiS7HUGTZH9JoX8WNvPYLWjkQESIdq7UZUqrtOKqa-fzEej8hFC7rETVRmNVTwyi2EFNDDu9wHdCR4-H+8IHDXsO-WQyL5q3CB6yYCwKhAqdrzaEjlaqvmk7yVIUwEg+QhglcoS9hhwyiFrjUOE2ojgfLxV8kQPQvU84uTIDasGxIHGl6LrkGh4SS3NZtYQAZV0GNxes6Jurtn-IgCroQyh3wBkCiiYwgj7AvkneIXb8x5C1IjHLi33zNmdKSTbu3a1DhiGqAFDhppGWeg98iiMRkfcWX5gH9VW6iXsHD1Hd8Avgw2eszrgwEsPznQkuakZX2mmc65dErVOr4nsDOwt9za0Wt+XQihXqUgv74wunscZP99iBQCs4QnHK0B0O52Bpr4Iqzmgwjc0E-fygqD8q7hw7IvQCzh+zm0G6MDh9XhO5EKJpOwbxuUCMmR7DVVRscH+Nfu0vu9c7cPZ7J75IjGaRliGo9K5lgZA4pPQXU39xtkgv0ptw8mhkV1BTZrJcgGUdcxI9hTQjRChkCp1wDB0RBytf1YCY8kIdhE0HAZA34AC-IDhgCvR1gwDJ94YsMcNuwwBc8sZy5kR8ggEcgVATYYUxpRxjBRw-9JAit7oT95hoMIRvNkC-NfoTRqggtkJK8qo1N4cvBRt2AYs-BP95AkscgQcqpllusIc+pTRxoKkVl1MHNIDJsKtyg28kE0Eh8alhA+J2QTRusY1bMkR3p8hbxxCxsCDHCs4mtBEw4-4hC1hzh8hvDstix+J6QNB0MXAgA */
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
        | { type: 'update_code'; data: string },
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
        HorzVertInfo(selectionRanges, 'horizontal').enabled,
      'Can make selection vertical': ({ selectionRanges }) =>
        HorzVertInfo(selectionRanges, 'vertical').enabled,
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
