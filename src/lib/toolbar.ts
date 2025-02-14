import { CustomIconName } from 'components/CustomIcon'
import { DEV } from 'env'
import { commandBarActor } from 'machines/commandBarMachine'
import {
  isEditingExistingSketch,
  modelingMachine,
  pipeHasCircle,
} from 'machines/modelingMachine'
import { IS_NIGHTLY_OR_DEBUG } from 'routes/Settings'
import { EventFrom, StateFrom } from 'xstate'

export type ToolbarModeName = 'modeling' | 'sketching'

type ToolbarMode = {
  check: (state: StateFrom<typeof modelingMachine>) => boolean
  items: (ToolbarItem | ToolbarItem[] | 'break')[]
}

export interface ToolbarItemCallbackProps {
  modelingState: StateFrom<typeof modelingMachine>
  modelingSend: (event: EventFrom<typeof modelingMachine>) => void
  sketchPathId: string | false
}

export type ToolbarItem = {
  id: string
  onClick: (props: ToolbarItemCallbackProps) => void
  icon?: CustomIconName
  status: 'available' | 'unavailable' | 'kcl-only'
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

export const toolbarConfig: Record<ToolbarModeName, ToolbarMode> = {
  modeling: {
    check: (state) =>
      !(state.matches('Sketch') || state.matches('Sketch no face')),
    items: [
      {
        id: 'sketch',
        onClick: ({ modelingSend, sketchPathId }) =>
          !sketchPathId
            ? modelingSend({
                type: 'Enter sketch',
                data: { forceNewSketch: true },
              })
            : modelingSend({ type: 'Enter sketch' }),
        icon: 'sketch',
        status: 'available',
        title: ({ sketchPathId }) =>
          sketchPathId ? 'Edit Sketch' : 'Start Sketch',
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
      'break',
      {
        id: 'fillet3d',
        onClick: () =>
          commandBarActor.send({
            type: 'Find and select command',
            data: { name: 'Fillet', groupId: 'modeling' },
          }),
        icon: 'fillet3d',
        status: DEV || IS_NIGHTLY_OR_DEBUG ? 'available' : 'kcl-only',
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
        status: DEV || IS_NIGHTLY_OR_DEBUG ? 'available' : 'kcl-only',
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
      {
        id: 'hole',
        onClick: () => console.error('Hole not yet implemented'),
        icon: 'hole',
        status: 'unavailable',
        title: 'Hole',
        description: 'Create a hole in a 3D solid.',
        links: [],
      },
      'break',
      [
        {
          id: 'boolean-union',
          onClick: () => console.error('Boolean union not yet implemented'),
          icon: 'booleanUnion',
          status: 'unavailable',
          title: 'Union',
          hotkey: 'Shift + B U',
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
          onClick: () => console.error('Boolean subtract not yet implemented'),
          icon: 'booleanSubtract',
          status: 'unavailable',
          title: 'Subtract',
          hotkey: 'Shift + B S',
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
          onClick: () => console.error('Boolean intersect not yet implemented'),
          icon: 'booleanIntersect',
          status: 'unavailable',
          title: 'Intersect',
          hotkey: 'Shift + B I',
          description: 'Create a solid from the intersection of two solids.',
          links: [
            {
              label: 'GitHub discussion',
              url: 'https://github.com/KittyCAD/modeling-app/discussions/511',
            },
          ],
        },
      ],
      'break',
      [
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
        status: DEV || IS_NIGHTLY_OR_DEBUG ? 'available' : 'kcl-only',
        title: 'Helix',
        description: 'Create a helix or spiral in 3D about an axis.',
        links: [{ label: 'KCL docs', url: 'https://zoo.dev/docs/kcl/helix' }],
      },
      'break',
      [
        {
          id: 'text-to-cad',
          onClick: () =>
            commandBarActor.send({
              type: 'Find and select command',
              data: { name: 'Text-to-CAD', groupId: 'modeling' },
            }),
          icon: 'sparkles',
          status: 'available',
          title: 'Text-to-CAD',
          description: 'Generate geometry from a text prompt.',
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
          status: 'available',
          title: 'Prompt-to-Edit',
          description: 'Edit geometry based on a text prompt.',
          links: [],
        },
      ],
    ],
  },
  sketching: {
    check: (state) =>
      state.matches('Sketch') || state.matches('Sketch no face'),
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
        disabled: (state) =>
          state.matches('Sketch no face') ||
          state.matches({
            Sketch: { 'Rectangle tool': 'Awaiting second corner' },
          }) ||
          state.matches({
            Sketch: { 'Circle tool': 'Awaiting Radius' },
          }),
        title: 'Line',
        hotkey: (state) =>
          state.matches({ Sketch: 'Line tool' }) ? ['Esc', 'L'] : 'L',
        description: 'Start drawing straight lines',
        links: [],
        isActive: (state) => state.matches({ Sketch: 'Line tool' }),
      },
      [
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
            state.matches({ Sketch: 'Tangential arc to' }) ? ['Esc', 'A'] : 'A',
          description: 'Start drawing an arc tangent to the current segment',
          links: [],
          isActive: (state) => state.matches({ Sketch: 'Tangential arc to' }),
        },
        {
          id: 'three-point-arc',
          onClick: () => console.error('Three-point arc not yet implemented'),
          icon: 'arc',
          status: 'unavailable',
          title: 'Three-point Arc',
          showTitle: false,
          description: 'Draw a circular arc defined by three points',
          links: [
            {
              label: 'GitHub issue',
              url: 'https://github.com/KittyCAD/modeling-app/issues/1659',
            },
          ],
        },
      ],
      {
        id: 'spline',
        onClick: () => console.error('Spline not yet implemented'),
        icon: 'spline',
        status: 'unavailable',
        title: 'Spline',
        showTitle: false,
        description: 'Draw a spline curve through a series of points',
        links: [],
      },
      'break',
      [
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
          isActive: (state) =>
            state.matches({ Sketch: 'Circle tool' }) ||
            state.matches({ Sketch: 'Circle three point tool' }),
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
                  ? 'circleThreePointNeo'
                  : 'none',
              },
            }),
          icon: 'circle',
          status: 'available',
          title: '3-point circle',
          showTitle: false,
          description: 'Draw a circle defined by three points',
          links: [],
        },
      ],
      [
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
          icon: 'arc',
          status: 'available',
          disabled: (state) => state.matches('Sketch no face'),
          title: 'Center rectangle',
          hotkey: (state) =>
            state.matches({ Sketch: 'Center Rectangle tool' })
              ? ['Esc', 'C']
              : 'C',
          description: 'Start drawing a rectangle from its center',
          links: [],
          isActive: (state) => {
            return state.matches({ Sketch: 'Center Rectangle tool' })
          },
        },
      ],
      {
        id: 'polygon',
        onClick: () => console.error('Polygon not yet implemented'),
        icon: 'polygon',
        status: 'unavailable',
        title: 'Polygon',
        showTitle: false,
        description: 'Draw a polygon with a specified number of sides',
        links: [],
      },
      {
        id: 'text',
        onClick: () => console.error('Text not yet implemented'),
        icon: 'text',
        status: 'unavailable',
        title: 'Text',
        showTitle: false,
        description: 'Add text to your sketch as geometry.',
        links: [],
      },
      'break',
      {
        id: 'mirror',
        onClick: () => console.error('Mirror not yet implemented'),
        icon: 'mirror',
        status: 'unavailable',
        title: 'Mirror',
        showTitle: false,
        description: 'Mirror sketch entities about a line or axis',
        links: [],
      },
      [
        {
          id: 'constraint-length',
          disabled: (state) => !state.matches({ Sketch: 'SketchIdle' }),
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
    ],
  },
}
