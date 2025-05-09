import type { EventFrom, StateFrom } from 'xstate'
import { settingsActor } from '@src/lib/singletons'

import type { CustomIconName } from '@src/components/CustomIcon'
import { createLiteral } from '@src/lang/create'
import { isDesktop } from '@src/lib/isDesktop'
import { commandBarActor } from '@src/lib/singletons'
import type { modelingMachine } from '@src/machines/modelingMachine'
import {
  isEditingExistingSketch,
  pipeHasCircle,
} from '@src/machines/modelingMachine'
import { IS_ML_EXPERIMENTAL } from '@src/lib/constants'

export type ToolbarModeName = 'modeling' | 'sketching'

type ToolbarMode = {
  check: (state: StateFrom<typeof modelingMachine>) => boolean
  items: (ToolbarItem | ToolbarDropdown | 'break')[]
}

export type ToolbarDropdown = {
  id: string
  array: ToolbarItem[]
}

export interface ToolbarItemCallbackProps {
  modelingState: StateFrom<typeof modelingMachine>
  modelingSend: (event: EventFrom<typeof modelingMachine>) => void
  sketchPathId: string | false
  editorHasFocus: boolean | undefined
}

export type ToolbarItem = {
  id: string
  onClick: (props: ToolbarItemCallbackProps) => void
  icon?: CustomIconName
  iconColor?: string
  alwaysDark?: true
  status: 'available' | 'unavailable' | 'kcl-only' | 'experimental'
  disabled?: (state: StateFrom<typeof modelingMachine>) => boolean
  disableHotkey?: (state: StateFrom<typeof modelingMachine>) => boolean
  title: string | ((props: ToolbarItemCallbackProps) => string)
  showTitle?: boolean
  hotkey?:
    | string
    | ((state: StateFrom<typeof modelingMachine>) => string | string[])
  description: string
  links: { label: string; url: string }[]
  isActive?: (state: StateFrom<typeof modelingMachine>) => boolean
  disabledReason?:
    | string
    | ((state: StateFrom<typeof modelingMachine>) => string | undefined)
}

export type ToolbarItemResolved = Omit<
  ToolbarItem,
  'disabled' | 'disableHotkey' | 'hotkey' | 'isActive' | 'title'
> & {
  title: string
  disabled?: boolean
  disableHotkey?: boolean
  hotkey?: string | string[]
  isActive?: boolean
}

export type ToolbarItemResolvedDropdown = {
  id: string
  array: ToolbarItemResolved[]
}

export const isToolbarItemResolvedDropdown = (
  item: ToolbarItemResolved | ToolbarItemResolvedDropdown
): item is ToolbarItemResolvedDropdown => {
  return (item as ToolbarItemResolvedDropdown).array !== undefined
}

export const toolbarConfig: Record<ToolbarModeName, ToolbarMode> = {
  modeling: {
    check: (state) =>
      !(
        state.matches('Sketch') ||
        state.matches('Sketch no face') ||
        state.matches('animating to existing sketch') ||
        state.matches('animating to plane')
      ),
    items: [
      {
        id: 'sketch',
        onClick: ({ modelingSend, sketchPathId, editorHasFocus }) =>
          !(editorHasFocus && sketchPathId)
            ? modelingSend({
                type: 'Enter sketch',
                data: { forceNewSketch: true },
              })
            : modelingSend({ type: 'Enter sketch' }),
        icon: 'sketch',
        status: 'available',
        title: ({ editorHasFocus, sketchPathId }) =>
          editorHasFocus && sketchPathId ? 'Edit Sketch' : 'Start Sketch',
        showTitle: true,
        hotkey: 'S',
        description: 'Start drawing a 2D sketch',
        links: [
          { label: 'KCL docs', url: 'https://zoo.dev/docs/kcl/startSketchOn' },
        ],
      },
      'break',
      {
        id: 'extrude',
        onClick: () =>
          commandBarActor.send({
            type: 'Find and select command',
            data: { name: 'Extrude', groupId: 'modeling' },
          }),
        icon: 'extrude',
        status: 'available',
        title: 'Extrude',
        hotkey: 'E',
        description: 'Pull a sketch into 3D along its normal or perpendicular.',
        links: [{ label: 'KCL docs', url: 'https://zoo.dev/docs/kcl/extrude' }],
      },
      {
        id: 'sweep',
        onClick: () =>
          commandBarActor.send({
            type: 'Find and select command',
            data: { name: 'Sweep', groupId: 'modeling' },
          }),
        icon: 'sweep',
        status: 'available',
        title: 'Sweep',
        hotkey: 'W',
        description:
          'Create a 3D body by moving a sketch region along an arbitrary path.',
        links: [
          {
            label: 'KCL docs',
            url: 'https://zoo.dev/docs/kcl/sweep',
          },
        ],
      },
      {
        id: 'loft',
        onClick: () =>
          commandBarActor.send({
            type: 'Find and select command',
            data: { name: 'Loft', groupId: 'modeling' },
          }),
        icon: 'loft',
        status: 'available',
        title: 'Loft',
        hotkey: 'L',
        description:
          'Create a 3D body by blending between two or more sketches.',
        links: [
          {
            label: 'KCL docs',
            url: 'https://zoo.dev/docs/kcl/loft',
          },
        ],
      },
      {
        id: 'revolve',
        onClick: () =>
          commandBarActor.send({
            type: 'Find and select command',
            data: { name: 'Revolve', groupId: 'modeling' },
          }),
        icon: 'revolve',
        status: 'available',
        title: 'Revolve',
        hotkey: 'R',
        description:
          'Create a 3D body by rotating a sketch region about an axis.',
        links: [
          { label: 'KCL docs', url: 'https://zoo.dev/docs/kcl/revolve' },
          {
            label: 'KCL example',
            url: 'https://zoo.dev/docs/kcl-samples/ball-bearing',
          },
        ],
      },
      'break',
      {
        id: 'fillet3d',
        onClick: () =>
          commandBarActor.send({
            type: 'Find and select command',
            data: { name: 'Fillet', groupId: 'modeling' },
          }),
        icon: 'fillet3d',
        status: 'available',
        title: 'Fillet',
        hotkey: 'F',
        description: 'Round the edges of a 3D solid.',
        links: [{ label: 'KCL docs', url: 'https://zoo.dev/docs/kcl/fillet' }],
      },
      {
        id: 'chamfer3d',
        onClick: () =>
          commandBarActor.send({
            type: 'Find and select command',
            data: { name: 'Chamfer', groupId: 'modeling' },
          }),
        icon: 'chamfer3d',
        status: 'available',
        title: 'Chamfer',
        hotkey: 'C',
        description: 'Bevel the edges of a 3D solid.',
        links: [{ label: 'KCL docs', url: 'https://zoo.dev/docs/kcl/chamfer' }],
      },
      {
        id: 'shell',
        onClick: () => {
          commandBarActor.send({
            type: 'Find and select command',
            data: { name: 'Shell', groupId: 'modeling' },
          })
        },
        icon: 'shell',
        status: 'available',
        title: 'Shell',
        description: 'Hollow out a 3D solid.',
        links: [{ label: 'KCL docs', url: 'https://zoo.dev/docs/kcl/shell' }],
      },
      'break',
      {
        id: 'booleans',
        array: [
          {
            id: 'boolean-union',
            onClick: () =>
              commandBarActor.send({
                type: 'Find and select command',
                data: { name: 'Boolean Union', groupId: 'modeling' },
              }),
            icon: 'booleanUnion',
            status: 'available',
            title: 'Union',
            description: 'Combine two or more solids into a single solid.',
            links: [
              {
                label: 'GitHub discussion',
                url: 'https://github.com/KittyCAD/modeling-app/discussions/509',
              },
            ],
          },
          {
            id: 'boolean-subtract',
            onClick: () =>
              commandBarActor.send({
                type: 'Find and select command',
                data: { name: 'Boolean Subtract', groupId: 'modeling' },
              }),
            icon: 'booleanSubtract',
            status: 'available',
            title: 'Subtract',
            description: 'Subtract one solid from another.',
            links: [
              {
                label: 'GitHub discussion',
                url: 'https://github.com/KittyCAD/modeling-app/discussions/510',
              },
            ],
          },
          {
            id: 'boolean-intersect',
            onClick: () =>
              commandBarActor.send({
                type: 'Find and select command',
                data: { name: 'Boolean Intersect', groupId: 'modeling' },
              }),
            icon: 'booleanIntersect',
            status: 'available',
            title: 'Intersect',
            description: 'Create a solid from the intersection of two solids.',
            links: [
              {
                label: 'GitHub discussion',
                url: 'https://github.com/KittyCAD/modeling-app/discussions/511',
              },
            ],
          },
        ],
      },
      'break',
      {
        id: 'planes',
        array: [
          {
            id: 'plane-offset',
            onClick: () => {
              commandBarActor.send({
                type: 'Find and select command',
                data: { name: 'Offset plane', groupId: 'modeling' },
              })
            },
            hotkey: 'O',
            icon: 'plane',
            status: 'available',
            title: 'Offset plane',
            description: 'Create a plane parallel to an existing plane.',
            links: [
              {
                label: 'KCL docs',
                url: 'https://zoo.dev/docs/kcl/offsetPlane',
              },
            ],
          },
          {
            id: 'plane-points',
            onClick: () =>
              console.error('Plane through points not yet implemented'),
            status: 'unavailable',
            title: '3-point plane',
            description: 'Create a plane from three points.',
            links: [],
          },
        ],
      },
      {
        id: 'helix',
        onClick: () => {
          commandBarActor.send({
            type: 'Find and select command',
            data: { name: 'Helix', groupId: 'modeling' },
          })
        },
        hotkey: 'H',
        icon: 'helix',
        status: 'available',
        title: 'Helix',
        description: 'Create a helix or spiral in 3D about an axis.',
        links: [{ label: 'KCL docs', url: 'https://zoo.dev/docs/kcl/helix' }],
      },
      'break',
      {
        id: 'insert',
        onClick: () =>
          commandBarActor.send({
            type: 'Find and select command',
            data: { name: 'Insert', groupId: 'code' },
          }),
        hotkey: 'I',
        icon: 'import',
        status: 'available',
        disabled: () => !isDesktop(),
        title: 'Insert',
        description: 'Insert from a file in the current project directory',
        links: [
          {
            label: 'API docs',
            url: 'https://zoo.dev/docs/kcl/import',
          },
        ],
      },
      {
        id: 'transform',
        array: [
          {
            id: 'translate',
            onClick: () =>
              commandBarActor.send({
                type: 'Find and select command',
                data: { name: 'Translate', groupId: 'modeling' },
              }),
            icon: 'move',
            status: 'available',
            title: 'Translate',
            description: 'Apply a translation to a solid or sketch.',
            links: [
              {
                label: 'API docs',
                url: 'https://zoo.dev/docs/kcl/translate',
              },
            ],
          },
          {
            id: 'rotate',
            onClick: () =>
              commandBarActor.send({
                type: 'Find and select command',
                data: { name: 'Rotate', groupId: 'modeling' },
              }),
            icon: 'rotate',
            status: 'available',
            title: 'Rotate',
            description: 'Apply a rotation to a solid or sketch.',
            links: [
              {
                label: 'API docs',
                url: 'https://zoo.dev/docs/kcl/rotate',
              },
            ],
          },
          {
            id: 'clone',
            onClick: () =>
              commandBarActor.send({
                type: 'Find and select command',
                data: { name: 'Clone', groupId: 'modeling' },
              }),
            status: 'available',
            title: 'Clone',
            icon: 'clone',
            description: 'Clone a solid or sketch.',
            links: [
              {
                label: 'API docs',
                url: 'https://zoo.dev/docs/kcl/clone',
              },
            ],
          },
        ],
      },
      'break',
      {
        id: 'ai',
        array: [
          {
            id: 'text-to-cad',
            onClick: () => {
              const currentProject =
                settingsActor.getSnapshot().context.currentProject
              commandBarActor.send({
                type: 'Find and select command',
                data: {
                  name: 'Text-to-CAD',
                  groupId: 'application',
                  argDefaultValues: {
                    method: 'existingProject',
                    projectName: currentProject?.name,
                  },
                },
              })
            },
            icon: 'sparkles',
            iconColor: '#29FFA4',
            alwaysDark: true,
            status: IS_ML_EXPERIMENTAL ? 'experimental' : 'available',
            title: 'Create with Zoo Text-to-CAD',
            description: 'Create geometry with AI / ML.',
            links: [
              {
                label: 'API docs',
                url: 'https://zoo.dev/docs/api/ml/generate-a-cad-model-from-text',
              },
            ],
          },
          {
            id: 'prompt-to-edit',
            onClick: () =>
              commandBarActor.send({
                type: 'Find and select command',
                data: { name: 'Prompt-to-edit', groupId: 'modeling' },
              }),
            icon: 'sparkles',
            iconColor: '#29FFA4',
            alwaysDark: true,
            status: IS_ML_EXPERIMENTAL ? 'experimental' : 'available',
            title: 'Modify with Zoo Text-to-CAD',
            description: 'Edit geometry with AI / ML.',
            links: [],
          },
        ],
      },
    ],
  },
  sketching: {
    check: (state) =>
      state.matches('Sketch') ||
      state.matches('Sketch no face') ||
      state.matches('animating to existing sketch') ||
      state.matches('animating to plane'),
    items: [
      {
        id: 'sketch-exit',
        onClick: ({ modelingSend }) =>
          modelingSend({
            type: 'Cancel',
          }),
        disableHotkey: (state) =>
          !(
            state.matches({ Sketch: 'SketchIdle' }) ||
            state.matches('Sketch no face')
          ),
        icon: 'arrowLeft',
        status: 'available',
        title: 'Exit sketch',
        showTitle: true,
        hotkey: 'Esc',
        description: 'Exit the current sketch',
        links: [],
      },
      'break',
      {
        id: 'line',
        onClick: ({ modelingState, modelingSend }) => {
          modelingSend({
            type: 'change tool',
            data: {
              tool: !modelingState.matches({ Sketch: 'Line tool' })
                ? 'line'
                : 'none',
            },
          })
        },
        icon: 'line',
        status: 'available',
        disabled: (state) => state.matches('Sketch no face'),
        title: 'Line',
        hotkey: (state) =>
          state.matches({ Sketch: 'Line tool' }) ? ['Esc', 'L'] : 'L',
        description: 'Start drawing straight lines',
        links: [],
        isActive: (state) => state.matches({ Sketch: 'Line tool' }),
      },
      {
        id: 'arcs',
        array: [
          {
            id: 'three-point-arc',
            onClick: ({ modelingState, modelingSend }) =>
              modelingSend({
                type: 'change tool',
                data: {
                  tool: !modelingState.matches({
                    Sketch: 'Arc three point tool',
                  })
                    ? 'arcThreePoint'
                    : 'none',
                },
              }),
            icon: 'arc',
            status: 'available',
            title: 'Three-point Arc',
            hotkey: (state) =>
              state.matches({ Sketch: 'Arc three point tool' })
                ? ['Esc', 'T']
                : 'T',
            showTitle: false,
            description: 'Draw a circular arc defined by three points',
            links: [
              {
                label: 'GitHub issue',
                url: 'https://github.com/KittyCAD/modeling-app/issues/1659',
              },
            ],
            isActive: (state) =>
              state.matches({ Sketch: 'Arc three point tool' }),
          },
          {
            id: 'tangential-arc',
            onClick: ({ modelingState, modelingSend }) =>
              modelingSend({
                type: 'change tool',
                data: {
                  tool: !modelingState.matches({ Sketch: 'Tangential arc to' })
                    ? 'tangentialArc'
                    : 'none',
                },
              }),
            icon: 'arc',
            status: 'available',
            disabled: (state) =>
              (!isEditingExistingSketch(state.context) &&
                !state.matches({ Sketch: 'Tangential arc to' })) ||
              pipeHasCircle(state.context),
            disabledReason: (state) =>
              !isEditingExistingSketch(state.context) &&
              !state.matches({ Sketch: 'Tangential arc to' })
                ? "Cannot start a tangential arc because there's no previous line to be tangential to.  Try drawing a line first or selecting an existing sketch to edit."
                : undefined,
            title: 'Tangential Arc',
            hotkey: (state) =>
              state.matches({ Sketch: 'Tangential arc to' })
                ? ['Esc', 'A']
                : 'A',
            description: 'Start drawing an arc tangent to the current segment',
            links: [],
            isActive: (state) => state.matches({ Sketch: 'Tangential arc to' }),
          },
        ],
      },
      'break',
      {
        id: 'circles',
        array: [
          {
            id: 'circle-center',
            onClick: ({ modelingState, modelingSend }) =>
              modelingSend({
                type: 'change tool',
                data: {
                  tool: !modelingState.matches({ Sketch: 'Circle tool' })
                    ? 'circle'
                    : 'none',
                },
              }),
            icon: 'circle',
            status: 'available',
            title: 'Center circle',
            disabled: (state) => state.matches('Sketch no face'),
            isActive: (state) => state.matches({ Sketch: 'Circle tool' }),
            hotkey: (state) =>
              state.matches({ Sketch: 'Circle tool' }) ? ['Esc', 'C'] : 'C',
            showTitle: false,
            description: 'Start drawing a circle from its center',
            links: [],
          },
          {
            id: 'circle-three-points',
            onClick: ({ modelingState, modelingSend }) =>
              modelingSend({
                type: 'change tool',
                data: {
                  tool: !modelingState.matches({
                    Sketch: 'Circle three point tool',
                  })
                    ? 'circleThreePoint'
                    : 'none',
                },
              }),
            icon: 'circle',
            status: 'available',
            title: '3-point circle',
            isActive: (state) =>
              state.matches({ Sketch: 'Circle three point tool' }),
            hotkey: (state) =>
              state.matches({ Sketch: 'Circle three point tool' })
                ? ['Alt+C', 'Esc']
                : 'Alt+C',
            showTitle: false,
            description: 'Draw a circle defined by three points',
            links: [],
          },
        ],
      },
      {
        id: 'rectangles',
        array: [
          {
            id: 'corner-rectangle',
            onClick: ({ modelingState, modelingSend }) =>
              modelingSend({
                type: 'change tool',
                data: {
                  tool: !modelingState.matches({ Sketch: 'Rectangle tool' })
                    ? 'rectangle'
                    : 'none',
                },
              }),
            icon: 'rectangle',
            status: 'available',
            disabled: (state) => state.matches('Sketch no face'),
            title: 'Corner rectangle',
            hotkey: (state) =>
              state.matches({ Sketch: 'Rectangle tool' }) ? ['Esc', 'R'] : 'R',
            description: 'Start drawing a rectangle',
            links: [],
            isActive: (state) => state.matches({ Sketch: 'Rectangle tool' }),
          },
          {
            id: 'center-rectangle',
            onClick: ({ modelingState, modelingSend }) =>
              modelingSend({
                type: 'change tool',
                data: {
                  tool: !modelingState.matches({
                    Sketch: 'Center Rectangle tool',
                  })
                    ? 'center rectangle'
                    : 'none',
                },
              }),
            icon: 'rectangle',
            status: 'available',
            disabled: (state) => state.matches('Sketch no face'),
            title: 'Center rectangle',
            description: 'Start drawing a rectangle from its center',
            links: [],
            hotkey: (state) =>
              state.matches({ Sketch: 'Center Rectangle tool' })
                ? ['Alt+R', 'Esc']
                : 'Alt+R',
            isActive: (state) => {
              return state.matches({ Sketch: 'Center Rectangle tool' })
            },
          },
        ],
      },
      {
        id: 'polygon',
        onClick: () => console.error('Polygon not yet implemented'),
        icon: 'polygon',
        status: 'kcl-only',
        title: 'Polygon',
        showTitle: false,
        description: 'Draw a polygon with a specified number of sides',
        links: [
          {
            label: 'KCL docs',
            url: 'https://zoo.dev/docs/kcl/polygon',
          },
        ],
      },
      'break',
      {
        id: 'mirror',
        onClick: () => console.error('Mirror not yet implemented'),
        icon: 'mirror',
        status: 'kcl-only',
        title: 'Mirror',
        showTitle: false,
        description: 'Mirror sketch entities about a line or axis',
        links: [
          {
            label: 'KCL docs',
            url: 'https://zoo.dev/docs/kcl/std-sketch-mirror2d',
          },
        ],
      },
      {
        id: 'constraints',
        array: [
          {
            id: 'constraint-length',
            disabled: (state) =>
              !(
                state.matches({ Sketch: 'SketchIdle' }) &&
                state.can({
                  type: 'Constrain length',
                  data: {
                    selection: state.context.selectionRanges,
                    // dummy data is okay for checking if the constrain is possible
                    length: {
                      valueAst: createLiteral(1),
                      valueText: '1',
                      valueCalculated: '1',
                    },
                  },
                })
              ),
            onClick: () =>
              commandBarActor.send({
                type: 'Find and select command',
                data: {
                  name: 'Constrain length',
                  groupId: 'modeling',
                },
              }),
            icon: 'dimension',
            status: 'available',
            title: 'Length',
            showTitle: false,
            description: 'Constrain the length of a straight segment',
            links: [],
          },
          {
            id: 'constraint-angle',
            disabled: (state) =>
              !(
                state.matches({ Sketch: 'SketchIdle' }) &&
                state.can({ type: 'Constrain angle' })
              ),
            onClick: ({ modelingSend }) =>
              modelingSend({ type: 'Constrain angle' }),
            status: 'available',
            title: 'Angle',
            showTitle: false,
            description: 'Constrain the angle between two segments',
            links: [],
          },
          {
            id: 'constraint-vertical',
            disabled: (state) =>
              !(
                state.matches({ Sketch: 'SketchIdle' }) &&
                state.can({ type: 'Make segment vertical' })
              ),
            onClick: ({ modelingSend }) =>
              modelingSend({ type: 'Make segment vertical' }),
            status: 'available',
            title: 'Vertical',
            showTitle: false,
            description:
              'Constrain a straight segment to be vertical relative to the sketch',
            links: [],
          },
          {
            id: 'constraint-horizontal',
            disabled: (state) =>
              !(
                state.matches({ Sketch: 'SketchIdle' }) &&
                state.can({ type: 'Make segment horizontal' })
              ),
            onClick: ({ modelingSend }) =>
              modelingSend({ type: 'Make segment horizontal' }),
            status: 'available',
            title: 'Horizontal',
            showTitle: false,
            description:
              'Constrain a straight segment to be horizontal relative to the sketch',
            links: [],
          },
          {
            id: 'constraint-parallel',
            disabled: (state) =>
              !(
                state.matches({ Sketch: 'SketchIdle' }) &&
                state.can({ type: 'Constrain parallel' })
              ),
            onClick: ({ modelingSend }) =>
              modelingSend({ type: 'Constrain parallel' }),
            status: 'available',
            title: 'Parallel',
            showTitle: false,
            description: 'Constrain two segments to be parallel',
            links: [],
          },
          {
            id: 'constraint-equal-length',
            disabled: (state) =>
              !(
                state.matches({ Sketch: 'SketchIdle' }) &&
                state.can({ type: 'Constrain equal length' })
              ),
            onClick: ({ modelingSend }) =>
              modelingSend({ type: 'Constrain equal length' }),
            status: 'available',
            title: 'Equal length',
            showTitle: false,
            description: 'Constrain two segments to be equal length',
            links: [],
          },
          {
            id: 'constraint-horizontal-distance',
            disabled: (state) =>
              !(
                state.matches({ Sketch: 'SketchIdle' }) &&
                state.can({ type: 'Constrain horizontal distance' })
              ),
            onClick: ({ modelingSend }) =>
              modelingSend({ type: 'Constrain horizontal distance' }),
            status: 'available',
            title: 'Horizontal distance',
            showTitle: false,
            description: 'Constrain the horizontal distance between two points',
            links: [],
          },
          {
            id: 'constraint-vertical-distance',
            disabled: (state) =>
              !(
                state.matches({ Sketch: 'SketchIdle' }) &&
                state.can({ type: 'Constrain vertical distance' })
              ),
            onClick: ({ modelingSend }) =>
              modelingSend({ type: 'Constrain vertical distance' }),
            status: 'available',
            title: 'Vertical distance',
            showTitle: false,
            description: 'Constrain the vertical distance between two points',
            links: [],
          },
          {
            id: 'constraint-absolute-x',
            disabled: (state) =>
              !(
                state.matches({ Sketch: 'SketchIdle' }) &&
                state.can({ type: 'Constrain ABS X' })
              ),
            onClick: ({ modelingSend }) =>
              modelingSend({ type: 'Constrain ABS X' }),
            status: 'available',
            title: 'Absolute X',
            showTitle: false,
            description: 'Constrain the x-coordinate of a point',
            links: [],
          },
          {
            id: 'constraint-absolute-y',
            disabled: (state) =>
              !(
                state.matches({ Sketch: 'SketchIdle' }) &&
                state.can({ type: 'Constrain ABS Y' })
              ),
            onClick: ({ modelingSend }) =>
              modelingSend({ type: 'Constrain ABS Y' }),
            status: 'available',
            title: 'Absolute Y',
            showTitle: false,
            description: 'Constrain the y-coordinate of a point',
            links: [],
          },
          {
            id: 'constraint-perpendicular-distance',
            disabled: (state) =>
              !(
                state.matches({ Sketch: 'SketchIdle' }) &&
                state.can({ type: 'Constrain perpendicular distance' })
              ),
            onClick: ({ modelingSend }) =>
              modelingSend({ type: 'Constrain perpendicular distance' }),
            status: 'available',
            title: 'Perpendicular distance',
            showTitle: false,
            description:
              'Constrain the perpendicular distance between two segments',
            links: [],
          },
          {
            id: 'constraint-align-horizontal',
            disabled: (state) =>
              !(
                state.matches({ Sketch: 'SketchIdle' }) &&
                state.can({ type: 'Constrain horizontally align' })
              ),
            onClick: ({ modelingSend }) =>
              modelingSend({ type: 'Constrain horizontally align' }),
            status: 'available',
            title: 'Horizontally align',
            showTitle: false,
            description: 'Align the ends of two or more segments horizontally',
            links: [],
          },
          {
            id: 'constraint-align-vertical',
            disabled: (state) =>
              !(
                state.matches({ Sketch: 'SketchIdle' }) &&
                state.can({ type: 'Constrain vertically align' })
              ),
            onClick: ({ modelingSend }) =>
              modelingSend({ type: 'Constrain vertically align' }),
            status: 'available',
            title: 'Vertically align',
            showTitle: false,
            description: 'Align the ends of two or more segments vertically',
            links: [],
          },
          {
            id: 'snap-to-x',
            disabled: (state) =>
              !(
                state.matches({ Sketch: 'SketchIdle' }) &&
                state.can({ type: 'Constrain snap to X' })
              ),
            onClick: ({ modelingSend }) =>
              modelingSend({ type: 'Constrain snap to X' }),
            status: 'available',
            title: 'Snap to X',
            showTitle: false,
            description: 'Snap a point to an x-coordinate',
            links: [],
          },
          {
            id: 'snap-to-y',
            disabled: (state) =>
              !(
                state.matches({ Sketch: 'SketchIdle' }) &&
                state.can({ type: 'Constrain snap to Y' })
              ),
            onClick: ({ modelingSend }) =>
              modelingSend({ type: 'Constrain snap to Y' }),
            status: 'available',
            title: 'Snap to Y',
            showTitle: false,
            description: 'Snap a point to a y-coordinate',
            links: [],
          },
          {
            id: 'constraint-remove',
            disabled: (state) =>
              !(
                state.matches({ Sketch: 'SketchIdle' }) &&
                state.can({ type: 'Constrain remove constraints' })
              ),
            onClick: ({ modelingSend }) =>
              modelingSend({ type: 'Constrain remove constraints' }),
            status: 'available',
            title: 'Remove constraints',
            showTitle: false,
            description: 'Remove all constraints from the segment',
            links: [],
          },
        ],
      },
    ],
  },
}
