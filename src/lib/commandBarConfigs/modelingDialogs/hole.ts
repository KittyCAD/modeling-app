import {
  getHoleBottom,
  getHoleType,
  normalizeHoleDialogArguments,
} from '@src/lib/commandBarConfigs/holeDialog'
import {
  type ModelingCommandArgOverrides,
  stdLibCommandArgMetadata,
} from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { HoleCommandArgs } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import {
  compactSelectionDialog,
  isEditingNodeSelection,
  isUsingModelingDialog,
  modelingDialogLayout,
} from '@src/lib/commandBarConfigs/modelingDialogShared'
import { KCL_DEFAULT_ORIGIN_2D } from '@src/lib/constants'

const countersinkHeadClearanceDefault = stdLibCommandArgMetadata(
  'hole::countersink',
  'headClearance'
)?.defaultValue

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
    selectionTypes: ['cap', 'wall', 'edgeCut'],
    multiple: false,
    hidden: isEditingNodeSelection,
    dialog: {
      displayName: 'Face',
      ...compactSelectionDialog('placement', 'Select a face', {
        order: 0,
      }),
    },
  },
  cutAt: {
    defaultValue: KCL_DEFAULT_ORIGIN_2D,
    dialog: {
      displayName: 'Center',
      group: 'placement',
      order: 10,
    },
  },
  holeBody: {
    inputType: 'options',
    defaultValue: 'blind',
    hidden: (context) => isUsingModelingDialog(context),
    options: [{ name: 'Blind', value: 'blind' }],
  },
  blindDepth: {
    inputType: 'kcl',
    required: (context) =>
      ['blind'].includes(context.argumentsToSubmit.holeBody as string),
    hidden: (context) =>
      !['blind'].includes(context.argumentsToSubmit.holeBody as string),
    defaultValue: '2',
    dialog: {
      displayName: 'Depth',
      group: 'hole',
      order: 20,
    },
  },
  blindDiameter: {
    inputType: 'kcl',
    required: (context) =>
      ['blind'].includes(context.argumentsToSubmit.holeBody as string),
    hidden: (context) =>
      !['blind'].includes(context.argumentsToSubmit.holeBody as string),
    defaultValue: '1',
    dialog: {
      displayName: 'Diameter',
      group: 'hole',
      order: 10,
    },
  },
  holeType: {
    inputType: 'options',
    defaultValue: 'simple',
    options: [
      { name: 'Simple', value: 'simple' },
      { name: 'Counterbore', value: 'counterbore' },
      { name: 'Countersink', value: 'countersink' },
    ],
    dialog: {
      displayName: 'Type',
      group: 'hole',
      order: 0,
      controlStyle: 'segmented',
    },
  },
  counterboreDepth: {
    inputType: 'kcl',
    required: (context) =>
      getHoleType(context.argumentsToSubmit) === 'counterbore',
    hidden: (context) =>
      getHoleType(context.argumentsToSubmit) !== 'counterbore',
    defaultValue: '1',
    dialog: {
      displayName: 'Head depth',
      group: 'hole',
      order: 40,
      prepopulate: true,
    },
  },
  counterboreDiameter: {
    inputType: 'kcl',
    required: (context) =>
      getHoleType(context.argumentsToSubmit) === 'counterbore',
    hidden: (context) =>
      getHoleType(context.argumentsToSubmit) !== 'counterbore',
    defaultValue: '2',
    dialog: {
      displayName: 'Head diameter',
      group: 'hole',
      order: 30,
      prepopulate: true,
    },
  },
  countersinkAngle: {
    inputType: 'kcl',
    required: (context) =>
      getHoleType(context.argumentsToSubmit) === 'countersink',
    hidden: (context) =>
      getHoleType(context.argumentsToSubmit) !== 'countersink',
    defaultValue: '90deg',
    dialog: {
      displayName: 'Head angle',
      group: 'hole',
      order: 40,
      prepopulate: true,
    },
  },
  countersinkDiameter: {
    inputType: 'kcl',
    required: (context) =>
      getHoleType(context.argumentsToSubmit) === 'countersink',
    hidden: (context) =>
      getHoleType(context.argumentsToSubmit) !== 'countersink',
    defaultValue: '2',
    dialog: {
      displayName: 'Head diameter',
      group: 'hole',
      order: 30,
      prepopulate: true,
    },
  },
  countersinkHeadClearance: {
    inputType: 'kcl',
    required: false,
    hidden: (context) =>
      getHoleType(context.argumentsToSubmit) !== 'countersink',
    defaultValue:
      typeof countersinkHeadClearanceDefault === 'string'
        ? countersinkHeadClearanceDefault
        : undefined,
    dialog: {
      displayName: 'Head clearance',
      group: 'advanced',
      order: 0,
    },
  },
  holeBottom: {
    inputType: 'options',
    defaultValue: 'flat',
    options: [
      { name: 'Flat', value: 'flat' },
      { name: 'Drill point', value: 'drill' },
    ],
    dialog: {
      displayName: 'Type',
      group: 'bottom',
      order: 0,
      controlStyle: 'segmented',
    },
  },
  drillPointAngle: {
    inputType: 'kcl',
    required: (context) => getHoleBottom(context.argumentsToSubmit) === 'drill',
    hidden: (context) => getHoleBottom(context.argumentsToSubmit) !== 'drill',
    defaultValue: '110deg',
    dialog: {
      displayName: 'Point angle',
      group: 'bottom',
      order: 10,
      prepopulate: true,
    },
  },
} satisfies ModelingCommandArgOverrides<HoleCommandArgs>
