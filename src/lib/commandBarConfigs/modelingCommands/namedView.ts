import type { CommandDialogLayout } from '@src/lib/commandTypes'
import type { ModelingCommandArgOverrides } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { NamedViewCommandArgs } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'

export const namedViewLayout = [
  { title: 'View', args: ['name'] },
  {
    title: 'Camera',
    args: ['orientation', 'projection'],
    description: 'Choose the direction and projection used to show the model.',
  },
  {
    title: 'Visibility',
    args: ['baseline', 'except'],
    description:
      'Exceptions invert the baseline: hide them under Show all, or isolate them under Hide all.',
  },
  { title: 'More options', args: ['target', 'distance'], collapsible: true },
] satisfies CommandDialogLayout<keyof NamedViewCommandArgs>

export const namedViewArgs = {
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
  },
  projection: {
    inputType: 'options',
    required: true,
    defaultValue: 'Orthographic',
    options: [
      { name: 'Orthographic', value: 'Orthographic', isCurrent: true },
      { name: 'Perspective', value: 'Perspective' },
    ],
    dialog: { controlStyle: 'segmented' },
  },
  baseline: {
    inputType: 'options',
    required: true,
    defaultValue: 'Show',
    options: [
      { name: 'Show all', value: 'Show', isCurrent: true },
      { name: 'Hide all', value: 'Hide' },
    ],
    dialog: { controlStyle: 'segmented' },
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
      selectionEmptyLabel: 'Select visibility exceptions',
    },
  },
  target: {
    inputType: 'vector3d',
    required: false,
    dialog: { displayName: 'Look at' },
  },
  distance: {
    inputType: 'kcl',
    required: false,
    dialog: { displayName: 'Camera distance' },
  },
} satisfies ModelingCommandArgOverrides<NamedViewCommandArgs>
