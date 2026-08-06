import {
  getHoleBottom,
  getHoleType,
  normalizeHoleDialogArguments,
} from '@src/lib/commandBarConfigs/holeDialog'
import type { ModelingCommandArgOverrides } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { HoleCommandArgs } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import {
  compactSelectionDialog,
  isEditingNodeSelection,
  isUsingModelingDialog,
  modelingDialogLayout,
} from '@src/lib/commandBarConfigs/modelingDialogShared'
import { KCL_DEFAULT_ORIGIN_2D } from '@src/lib/constants'

export const holeDialogLayout = modelingDialogLayout(
  [
    {
      id: 'placement',
      title: 'Placement',
    },
    {
      id: 'hole',
      title: 'Hole',
    },
    {
      id: 'bottom',
      title: 'Bottom',
    },
  ],
  normalizeHoleDialogArguments
)

export const holeDialogOverrides = {
  face: {
    inputType: 'selection',
    displayName: 'Face',
    selectionTypes: ['cap', 'wall', 'edgeCut'],
    multiple: false,
    hidden: isEditingNodeSelection,
    dialog: compactSelectionDialog('placement', 'Select a face', {
      order: 0,
    }),
  },
  cutAt: {
    inputType: 'vector2d', // TODO: see if we can make the KCL arg Point2d
    displayName: 'Center',
    defaultValue: KCL_DEFAULT_ORIGIN_2D,
    dialog: {
      group: 'placement',
      order: 10,
    },
  },
  holeBody: {
    inputType: 'options',
    required: true,
    defaultValue: 'blind',
    hidden: (context) => isUsingModelingDialog(context),
    options: [{ name: 'Blind', value: 'blind' }],
  },
  blindDepth: {
    inputType: 'kcl',
    displayName: 'Depth',
    required: (context) =>
      ['blind'].includes(context.argumentsToSubmit.holeBody as string),
    hidden: (context) =>
      !['blind'].includes(context.argumentsToSubmit.holeBody as string),
    defaultValue: '2',
    dialog: {
      group: 'hole',
      order: 20,
    },
  },
  blindDiameter: {
    inputType: 'kcl',
    displayName: 'Diameter',
    required: (context) =>
      ['blind'].includes(context.argumentsToSubmit.holeBody as string),
    hidden: (context) =>
      !['blind'].includes(context.argumentsToSubmit.holeBody as string),
    defaultValue: '1',
    dialog: {
      group: 'hole',
      order: 10,
    },
  },
  holeType: {
    inputType: 'options',
    displayName: 'Type',
    required: true,
    defaultValue: 'simple',
    options: [
      { name: 'Simple', value: 'simple' },
      { name: 'Counterbore', value: 'counterbore' },
      { name: 'Countersink', value: 'countersink' },
    ],
    dialog: {
      group: 'hole',
      order: 0,
      controlStyle: 'segmented',
    },
  },
  counterboreDepth: {
    inputType: 'kcl',
    displayName: 'Head depth',
    required: (context) =>
      getHoleType(context.argumentsToSubmit) === 'counterbore',
    hidden: (context) =>
      getHoleType(context.argumentsToSubmit) !== 'counterbore',
    defaultValue: '1',
    prepopulate: true,
    dialog: {
      group: 'hole',
      order: 40,
    },
  },
  counterboreDiameter: {
    inputType: 'kcl',
    displayName: 'Head diameter',
    required: (context) =>
      getHoleType(context.argumentsToSubmit) === 'counterbore',
    hidden: (context) =>
      getHoleType(context.argumentsToSubmit) !== 'counterbore',
    defaultValue: '2',
    prepopulate: true,
    dialog: {
      group: 'hole',
      order: 30,
    },
  },
  countersinkAngle: {
    inputType: 'kcl',
    displayName: 'Head angle',
    required: (context) =>
      getHoleType(context.argumentsToSubmit) === 'countersink',
    hidden: (context) =>
      getHoleType(context.argumentsToSubmit) !== 'countersink',
    defaultValue: '90deg',
    prepopulate: true,
    dialog: {
      group: 'hole',
      order: 40,
    },
  },
  countersinkDiameter: {
    inputType: 'kcl',
    displayName: 'Head diameter',
    required: (context) =>
      getHoleType(context.argumentsToSubmit) === 'countersink',
    hidden: (context) =>
      getHoleType(context.argumentsToSubmit) !== 'countersink',
    defaultValue: '2',
    prepopulate: true,
    dialog: {
      group: 'hole',
      order: 30,
    },
  },
  countersinkHeadClearance: {
    inputType: 'kcl',
    displayName: 'Head clearance',
    required: false,
    hidden: (context) =>
      getHoleType(context.argumentsToSubmit) !== 'countersink',
    defaultValue: '0',
    dialog: {
      group: 'advanced',
      order: 0,
    },
  },
  holeBottom: {
    inputType: 'options',
    displayName: 'Type',
    required: true,
    defaultValue: 'flat',
    options: [
      { name: 'Flat', value: 'flat' },
      { name: 'Drill point', value: 'drill' },
    ],
    dialog: {
      group: 'bottom',
      order: 0,
      controlStyle: 'segmented',
    },
  },
  drillPointAngle: {
    inputType: 'kcl',
    displayName: 'Point angle',
    required: (context) => getHoleBottom(context.argumentsToSubmit) === 'drill',
    hidden: (context) => getHoleBottom(context.argumentsToSubmit) !== 'drill',
    defaultValue: '110deg',
    prepopulate: true,
    dialog: {
      group: 'bottom',
      order: 10,
    },
  },
} satisfies ModelingCommandArgOverrides<HoleCommandArgs>
