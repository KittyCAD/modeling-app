import { CommandSetConfig, KclCommandValue } from 'lib/commandTypes'
import { Selections } from 'lib/selections'
import { modelingMachine } from 'machines/modelingMachine'

export const EXTRUSION_RESULTS = [
  'new',
  'add',
  'subtract',
  'intersect',
] as const

export type ModelingCommandSchema = {
  'Enter sketch': {}
  Extrude: {
    selection: Selections // & { type: 'face' } would be cool to lock that down
    // result: (typeof EXTRUSION_RESULTS)[number]
    distance: KclCommandValue
  }
}

export const modelingMachineConfig: CommandSetConfig<
  typeof modelingMachine,
  ModelingCommandSchema
> = {
  'Enter sketch': {
    description: 'Enter sketch mode.',
    icon: 'sketch',
  },
  Extrude: {
    description: 'Pull a sketch into 3D along its normal or perpendicular.',
    icon: 'extrude',
    needsReview: true,
    args: {
      selection: {
        inputType: 'selection',
        selectionTypes: ['face'],
        multiple: false, // TODO: multiple selection
        required: true,
        skip: true,
      },
      // result: {
      //   inputType: 'options',
      //   defaultValue: 'add',
      //   skip: true,
      //   required: true,
      //   options: EXTRUSION_RESULTS.map((r) => ({
      //     name: r,
      //     isCurrent: r === 'add',
      //     value: r,
      //   })),
      // },
      distance: {
        inputType: 'kcl',
        defaultValue: '5 + 7',
        required: true,
      },
    },
  },
}
