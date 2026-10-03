import type { CommandDialogLayout } from '@src/lib/commandTypes'
import {
  getHoleBottom,
  getHoleType,
} from '@src/lib/commandBarConfigs/holeArguments'
import {
  type ModelingCommandArgOverrides,
  stdLibCommandArgDefaultSource,
} from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { HoleCommandArgs } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import {
  isEditingNodeSelection,
  isUsingModelingDialog,
} from '@src/lib/commandBarConfigs/modelingCommandUtils'
import { KCL_DEFAULT_ORIGIN_2D } from '@src/lib/constants'

export const holeLayout = [
  { title: 'Placement', args: ['face', 'cutAt'] },
  {
    title: 'Hole',
    args: [
      'holeType',
      'blindDiameter',
      'blindDepth',
      'counterboreDiameter',
      'countersinkDiameter',
      'counterboreDepth',
      'countersinkAngle',
    ],
  },
  { title: 'Bottom', args: ['holeBottom', 'drillPointAngle'] },
  {
    title: 'More options',
    args: ['countersinkHeadClearance'],
    collapsible: true,
  },
] satisfies CommandDialogLayout<keyof HoleCommandArgs>

export const holeArgs = {
  face: {
    inputType: 'selection',
    selectionTypes: ['cap', 'wall', 'edgeCut'],
    multiple: false,
    hidden: isEditingNodeSelection,
    dialog: { selectionEmptyLabel: 'Select a face' },
  },
  cutAt: {
    defaultValue: KCL_DEFAULT_ORIGIN_2D,
    dialog: { displayName: 'Center' },
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
    dialog: { displayName: 'Depth' },
  },
  blindDiameter: {
    inputType: 'kcl',
    required: (context) =>
      ['blind'].includes(context.argumentsToSubmit.holeBody as string),
    hidden: (context) =>
      !['blind'].includes(context.argumentsToSubmit.holeBody as string),
    defaultValue: '1',
    dialog: { displayName: 'Diameter' },
  },
  holeType: {
    inputType: 'options',
    defaultValue: 'simple',
    options: [
      { name: 'Simple', value: 'simple' },
      { name: 'Counterbore', value: 'counterbore' },
      { name: 'Countersink', value: 'countersink' },
    ],
    dialog: { displayName: 'Type', controlStyle: 'segmented' },
  },
  counterboreDepth: {
    inputType: 'kcl',
    required: (context) =>
      getHoleType(context.argumentsToSubmit) === 'counterbore',
    hidden: (context) =>
      getHoleType(context.argumentsToSubmit) !== 'counterbore',
    defaultValue: '1',
    dialog: { displayName: 'Head depth' },
    prepopulate: isUsingModelingDialog,
  },
  counterboreDiameter: {
    inputType: 'kcl',
    required: (context) =>
      getHoleType(context.argumentsToSubmit) === 'counterbore',
    hidden: (context) =>
      getHoleType(context.argumentsToSubmit) !== 'counterbore',
    defaultValue: '2',
    dialog: { displayName: 'Head diameter' },
    prepopulate: isUsingModelingDialog,
  },
  countersinkAngle: {
    inputType: 'kcl',
    required: (context) =>
      getHoleType(context.argumentsToSubmit) === 'countersink',
    hidden: (context) =>
      getHoleType(context.argumentsToSubmit) !== 'countersink',
    defaultValue: '90deg',
    dialog: { displayName: 'Head angle' },
    prepopulate: isUsingModelingDialog,
  },
  countersinkDiameter: {
    inputType: 'kcl',
    required: (context) =>
      getHoleType(context.argumentsToSubmit) === 'countersink',
    hidden: (context) =>
      getHoleType(context.argumentsToSubmit) !== 'countersink',
    defaultValue: '2',
    dialog: { displayName: 'Head diameter' },
    prepopulate: isUsingModelingDialog,
  },
  countersinkHeadClearance: {
    inputType: 'kcl',
    required: false,
    hidden: (context) =>
      getHoleType(context.argumentsToSubmit) !== 'countersink',
    defaultValue: stdLibCommandArgDefaultSource(
      'hole::countersink',
      'headClearance'
    ),
    dialog: { displayName: 'Head clearance' },
  },
  holeBottom: {
    inputType: 'options',
    defaultValue: 'flat',
    options: [
      { name: 'Flat', value: 'flat' },
      { name: 'Drill point', value: 'drill' },
    ],
    dialog: { displayName: 'Type', controlStyle: 'segmented' },
  },
  drillPointAngle: {
    inputType: 'kcl',
    required: (context) => getHoleBottom(context.argumentsToSubmit) === 'drill',
    hidden: (context) => getHoleBottom(context.argumentsToSubmit) !== 'drill',
    defaultValue: '110deg',
    dialog: { displayName: 'Point angle' },
    prepopulate: isUsingModelingDialog,
  },
} satisfies ModelingCommandArgOverrides<HoleCommandArgs>
