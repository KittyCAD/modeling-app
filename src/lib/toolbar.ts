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

interface ToolbarItemClickProps {
  modelingState: StateFrom<typeof modelingMachine>
  modelingSend: (event: EventFrom<typeof modelingMachine>) => void
  commandBarSend: (event: EventFrom<typeof commandBarMachine>) => void
}

export type ToolbarItem = {
  id: string
  onClick: (props: ToolbarItemClickProps) => void
  icon?: CustomIconName
  status: 'available' | 'unavailable' | 'kcl-only'
  disabled?: (state: StateFrom<typeof modelingMachine>) => boolean
  title: string
  showTitle?: boolean
  shortcut?: string
  description: string
  links: { label: string; url: string }[]
  isActive?: (state: StateFrom<typeof modelingMachine>) => boolean
}

export const toolbarConfig: Record<ToolbarModeName, ToolbarMode> = {
  modeling: {
    check: (state) => !state.matches('Sketch'),
    items: [
      {
        id: 'sketch',
        onClick: ({ modelingSend }) => modelingSend({ type: 'Enter sketch' }),
        icon: 'sketch',
        status: 'available',
        title: 'Sketch',
        showTitle: true,
        shortcut: 'Shift + S',
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
        icon: 'extrude',
        status: 'available',
        title: 'Extrude',
        shortcut: 'Shift + E',
        description: 'Pull a sketch into 3D along its normal or perpendicular.',
        links: [{ label: 'KCL docs', url: 'https://zoo.dev/docs/kcl/extrude' }],
      },
      {
        id: 'revolve',
        onClick: () => console.error('Revolve not yet implemented'),
        icon: 'revolve',
        status: 'kcl-only',
        title: 'Revolve',
        shortcut: 'Shift + R',
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
        shortcut: 'Shift + W',
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
        shortcut: 'Shift + L',
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
        title: 'Fillet',
        shortcut: 'Shift + F',
        description: 'Round the edges of a 3D solid.',
        links: [{ label: 'KCL docs', url: 'https://zoo.dev/docs/kcl/fillet' }],
      },
      {
        id: 'chamfer',
        onClick: () => console.error('Chamfer not yet implemented'),
        icon: 'chamfer3d',
        status: 'kcl-only',
        title: 'Chamfer',
        shortcut: 'Shift + C',
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
          shortcut: 'Shift + B U',
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
          shortcut: 'Shift + B S',
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
          shortcut: 'Shift + B I',
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
    check: (state) => state.matches('Sketch'),
    items: [
      {
        id: 'exit',
        onClick: ({ modelingSend }) => modelingSend({ type: 'Cancel' }),
        icon: 'arrowLeft',
        status: 'available',
        title: 'Exit sketch',
        showTitle: true,
        shortcut: 'Esc',
        description: 'Exit the current sketch',
        links: [],
      },
      {
        id: 'line',
        onClick: ({ modelingState, modelingSend }) =>
          modelingSend({
            type: 'change tool',
            data: {
              tool: !modelingState.matches('Sketch.Line tool')
                ? 'line'
                : 'none',
            },
          }),
        icon: 'line',
        status: 'available',
        disabled: (state) =>
          state.matches('Sketch.Rectangle tool.Awaiting second corner'),
        title: 'Line',
        shortcut: 'L',
        description: 'Start drawing straight lines',
        links: [],
        isActive: (state) => state.matches('Sketch.Line tool'),
      },
      {
        id: 'tangential-arc',
        onClick: ({ modelingState, modelingSend }) =>
          modelingSend({
            type: 'change tool',
            data: {
              tool: !modelingState.matches('Sketch.Tangential arc to')
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
        shortcut: 'A',
        description: 'Start drawing an arc tangent to the current segment',
        links: [],
        isActive: (state) => state.matches('Sketch.Tangential arc to'),
      },
      {
        id: 'rectangle',
        onClick: ({ modelingState, modelingSend }) =>
          modelingSend({
            type: 'change tool',
            data: {
              tool: !modelingState.matches('Sketch.Rectangle tool')
                ? 'rectangle'
                : 'none',
            },
          }),
        icon: 'rectangle',
        status: 'available',
        disabled: (state) =>
          !canRectangleTool(state.context) &&
          !state.matches('Sketch.Rectangle tool'),
        title: 'Rectangle',
        shortcut: 'R',
        description: 'Start drawing a rectangle',
        links: [],
        isActive: (state) => state.matches('Sketch.Rectangle tool'),
      },
    ],
  },
}
