import { CustomIconName } from 'components/CustomIcon'
import { DEV } from 'env'
import { commandBarMachine } from 'machines/commandBarMachine'
import {
  canRectangleTool,
  isEditingExistingSketch,
  modelingMachine,
} from 'machines/modelingMachine'
import { EventFrom, StateFrom } from 'xstate'

export type ToolbarModeName = 'modeling' | 'sketching'

type ToolbarMode = {
  check: (state: StateFrom<typeof modelingMachine>) => boolean
  items: (ToolbarItem | ToolbarItem[] | 'break')[]
}

export interface ToolbarItemCallbackProps {
  modelingStateMatches: StateFrom<typeof modelingMachine>['matches']
  modelingSend: (event: EventFrom<typeof modelingMachine>) => void
  commandBarSend: (event: EventFrom<typeof commandBarMachine>) => void
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
        disabled: (state) => !state.matches('idle'),
        title: ({ sketchPathId }) =>
          `${sketchPathId ? 'Edit' : 'Start'} Sketch`,
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
        onClick: ({ commandBarSend }) =>
          commandBarSend({
            type: 'Find and select command',
            data: { name: 'Extrude', groupId: 'modeling' },
          }),
        disabled: (state) => !state.can('Extrude'),
        icon: 'extrude',
        status: 'available',
        title: 'Extrude',
        hotkey: 'E',
        description: 'Pull a sketch into 3D along its normal or perpendicular.',
        links: [{ label: 'KCL docs', url: 'https://zoo.dev/docs/kcl/extrude' }],
      },
      {
        id: 'revolve',
        onClick: () => console.error('Revolve not yet implemented'),
        icon: 'revolve',
        status: 'kcl-only',
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
        onClick: () => console.error('Sweep not yet implemented'),
        icon: 'sweep',
        status: 'unavailable',
        title: 'Sweep',
        hotkey: 'W',
        description:
          'Create a 3D body by moving a sketch region along an arbitrary path.',
        links: [
          {
            label: 'GitHub discussion',
            url: 'https://github.com/KittyCAD/modeling-app/discussions/498',
          },
        ],
      },
      {
        id: 'loft',
        onClick: () => console.error('Loft not yet implemented'),
        icon: 'loft',
        status: 'unavailable',
        title: 'Loft',
        hotkey: 'L',
        description:
          'Create a 3D body by blending between two or more sketches.',
        links: [
          {
            label: 'GitHub discussion',
            url: 'https://github.com/KittyCAD/modeling-app/discussions/613',
          },
        ],
      },
      'break',
      {
        id: 'fillet3d',
        onClick: ({ commandBarSend }) =>
          commandBarSend({
            type: 'Find and select command',
            data: { name: 'Fillet', groupId: 'modeling' },
          }),
        icon: 'fillet3d',
        status: DEV ? 'available' : 'kcl-only',
        disabled: (state) => !state.can('Fillet'),
        title: 'Fillet',
        hotkey: 'F',
        description: 'Round the edges of a 3D solid.',
        links: [{ label: 'KCL docs', url: 'https://zoo.dev/docs/kcl/fillet' }],
      },
      {
        id: 'chamfer',
        onClick: () => console.error('Chamfer not yet implemented'),
        icon: 'chamfer3d',
        status: 'kcl-only',
        title: 'Chamfer',
        hotkey: 'C',
        description: 'Bevel the edges of a 3D solid.',
        links: [{ label: 'KCL docs', url: 'https://zoo.dev/docs/kcl/chamfer' }],
      },
      {
        id: 'shell',
        onClick: () => console.error('Shell not yet implemented'),
        icon: 'shell',
        status: 'kcl-only',
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
      [
        {
          id: 'plane-offset',
          onClick: () =>
            console.error('Plane through normal not yet implemented'),
          icon: 'plane',
          status: 'unavailable',
          title: 'Offset plane',
          description: 'Create a plane parallel to an existing plane.',
          links: [],
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
            state.matches('Sketch.SketchIdle') ||
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
        onClick: ({ modelingStateMatches: matches, modelingSend }) =>
          modelingSend({
            type: 'change tool',
            data: {
              tool: !matches('Sketch.Line tool') ? 'line' : 'none',
            },
          }),
        icon: 'line',
        status: 'available',
        disabled: (state) =>
          state.matches('Sketch no face') ||
          state.matches('Sketch.Rectangle tool.Awaiting second corner'),
        title: 'Line',
        hotkey: (state) =>
          state.matches('Sketch.Line tool') ? ['Esc', 'L'] : 'L',
        description: 'Start drawing straight lines',
        links: [],
        isActive: (state) => state.matches('Sketch.Line tool'),
      },
      [
        {
          id: 'tangential-arc',
          onClick: ({ modelingStateMatches, modelingSend }) =>
            modelingSend({
              type: 'change tool',
              data: {
                tool: !modelingStateMatches('Sketch.Tangential arc to')
                  ? 'tangentialArc'
                  : 'none',
              },
            }),
          icon: 'arc',
          status: 'available',
          disabled: (state) =>
            !isEditingExistingSketch(state.context) &&
            !state.matches('Sketch.Tangential arc to'),
          title: 'Tangential Arc',
          hotkey: (state) =>
            state.matches('Sketch.Tangential arc to') ? ['Esc', 'A'] : 'A',
          description: 'Start drawing an arc tangent to the current segment',
          links: [],
          isActive: (state) => state.matches('Sketch.Tangential arc to'),
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
          onClick: () => console.error('Center circle not yet implemented'),
          icon: 'circle',
          status: 'unavailable',
          title: 'Center circle',
          showTitle: false,
          description: 'Start drawing a circle from its center',
          links: [
            {
              label: 'GitHub issue',
              url: 'https://github.com/KittyCAD/modeling-app/issues/1501',
            },
          ],
        },
        {
          id: 'circle-three-points',
          onClick: () =>
            console.error('Three-point circle not yet implemented'),
          icon: 'circle',
          status: 'unavailable',
          disabled: () => true,
          title: 'Three-point circle',
          showTitle: false,
          description: 'Draw a circle defined by three points',
          links: [],
        },
      ],
      [
        {
          id: 'corner-rectangle',
          onClick: ({ modelingStateMatches, modelingSend }) =>
            modelingSend({
              type: 'change tool',
              data: {
                tool: !modelingStateMatches('Sketch.Rectangle tool')
                  ? 'rectangle'
                  : 'none',
              },
            }),
          icon: 'rectangle',
          status: 'available',
          disabled: (state) =>
            !canRectangleTool(state.context) &&
            !state.matches('Sketch.Rectangle tool'),
          title: 'Corner rectangle',
          hotkey: (state) =>
            state.matches('Sketch.Rectangle tool') ? ['Esc', 'R'] : 'R',
          description: 'Start drawing a rectangle',
          links: [],
          isActive: (state) => state.matches('Sketch.Rectangle tool'),
        },
        {
          id: 'center-rectangle',
          onClick: () => console.error('Center rectangle not yet implemented'),
          icon: 'rectangle',
          status: 'unavailable',
          title: 'Center rectangle',
          showTitle: false,
          description: 'Start drawing a rectangle from its center',
          links: [],
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
          disabled: (state) =>
            !(
              state.matches('Sketch.SketchIdle') &&
              state.nextEvents.includes('Constrain length') &&
              state.can('Constrain length')
            ),
          onClick: ({ modelingSend }) =>
            modelingSend({ type: 'Constrain length' }),
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
              state.matches('Sketch.SketchIdle') &&
              state.nextEvents.includes('Constrain angle') &&
              state.can('Constrain angle')
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
              state.matches('Sketch.SketchIdle') &&
              state.nextEvents.includes('Make segment vertical') &&
              state.can('Make segment vertical')
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
              state.matches('Sketch.SketchIdle') &&
              state.nextEvents.includes('Make segment horizontal') &&
              state.can('Make segment horizontal')
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
              state.matches('Sketch.SketchIdle') &&
              state.nextEvents.includes('Constrain parallel') &&
              state.can('Constrain parallel')
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
              state.matches('Sketch.SketchIdle') &&
              state.nextEvents.includes('Constrain equal length') &&
              state.can('Constrain equal length')
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
              state.matches('Sketch.SketchIdle') &&
              state.nextEvents.includes('Constrain horizontal distance') &&
              state.can('Constrain horizontal distance')
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
              state.matches('Sketch.SketchIdle') &&
              state.nextEvents.includes('Constrain vertical distance') &&
              state.can('Constrain vertical distance')
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
              state.matches('Sketch.SketchIdle') &&
              state.nextEvents.includes('Constrain ABS X') &&
              state.can('Constrain ABS X')
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
              state.matches('Sketch.SketchIdle') &&
              state.nextEvents.includes('Constrain ABS Y') &&
              state.can('Constrain ABS Y')
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
              state.matches('Sketch.SketchIdle') &&
              state.nextEvents.includes('Constrain perpendicular distance') &&
              state.can('Constrain perpendicular distance')
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
              state.matches('Sketch.SketchIdle') &&
              state.nextEvents.includes('Constrain horizontally align') &&
              state.can('Constrain horizontally align')
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
              state.matches('Sketch.SketchIdle') &&
              state.nextEvents.includes('Constrain vertically align') &&
              state.can('Constrain vertically align')
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
              state.matches('Sketch.SketchIdle') &&
              state.nextEvents.includes('Constrain snap to X') &&
              state.can('Constrain snap to X')
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
              state.matches('Sketch.SketchIdle') &&
              state.nextEvents.includes('Constrain snap to Y') &&
              state.can('Constrain snap to Y')
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
              state.matches('Sketch.SketchIdle') &&
              state.nextEvents.includes('Constrain remove constraints') &&
              state.can('Constrain remove constraints')
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
