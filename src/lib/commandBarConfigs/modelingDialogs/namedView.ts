import type { ModelingCommandArgOverrides } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { NamedViewCommandArgs } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import {
  compactSelectionDialog,
  modelingDialogLayout,
} from '@src/lib/commandBarConfigs/modelingDialogShared'

export const namedViewDialogLayout = modelingDialogLayout([
  {
    id: 'view',
    title: 'View',
  },
  {
    id: 'camera',
    title: 'Camera',
    description: 'Choose the direction and projection used to show the model.',
  },
  {
    id: 'visibility',
    title: 'Visibility',
    description:
      'Exceptions invert the baseline: hide them under Show all, or isolate them under Hide all.',
  },
])

export const namedViewDialogOverrides = {
  name: {
    displayName: 'Name',
    dialog: {
      group: 'view',
      order: 0,
    },
  },
  orientation: {
    inputType: 'options',
    required: true,
    defaultValue: 'Isometric',
    options: [
      { name: 'Isometric', value: 'Isometric', isCurrent: true },
      { name: 'Front', value: 'Front' },
      { name: 'Back', value: 'Back' },
      { name: 'Left', value: 'Left' },
      { name: 'Right', value: 'Right' },
      { name: 'Top', value: 'Top' },
      { name: 'Bottom', value: 'Bottom' },
    ],
    dialog: {
      displayName: 'Orientation',
      group: 'camera',
      order: 0,
    },
  },
  projection: {
    inputType: 'options',
    required: true,
    defaultValue: 'Orthographic',
    options: [
      { name: 'Orthographic', value: 'Orthographic', isCurrent: true },
      { name: 'Perspective', value: 'Perspective' },
    ],
    dialog: {
      displayName: 'Projection',
      group: 'camera',
      order: 10,
      controlStyle: 'segmented',
    },
  },
  baseline: {
    inputType: 'options',
    required: true,
    defaultValue: 'Show',
    options: [
      { name: 'Show all', value: 'Show', isCurrent: true },
      { name: 'Hide all', value: 'Hide' },
    ],
    dialog: {
      displayName: 'Baseline',
      group: 'visibility',
      order: 0,
      controlStyle: 'segmented',
    },
  },
  except: {
    inputType: 'selection',
    selectionTypes: [
      'path',
      'sketchBlock',
      'sweep',
      'compositeSolid',
      'gdtAnnotation',
      'helix',
      'plane',
      'importedGeometry',
    ],
    multiple: true,
    required: false,
    dialog: {
      displayName: 'Exceptions',
      ...compactSelectionDialog('visibility', 'Select visibility exceptions', {
        order: 10,
        selectionHint:
          'Selected objects use the opposite visibility from the baseline.',
      }),
    },
  },
  target: {
    inputType: 'vector3d',
    required: false,
    dialog: {
      displayName: 'Look at',
      group: 'advanced',
      order: 0,
    },
  },
  distance: {
    inputType: 'kcl',
    required: false,
    dialog: {
      displayName: 'Camera distance',
      group: 'advanced',
      order: 10,
    },
  },
} satisfies ModelingCommandArgOverrides<NamedViewCommandArgs>
