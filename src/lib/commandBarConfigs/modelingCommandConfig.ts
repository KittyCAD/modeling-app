import { CommandSetConfig } from 'lib/commandTypes'
import { Selections } from 'lib/selections'
import { modelingMachine } from 'machines/modelingMachine'

export const EXTRUSION_RESULTS = [
  'new',
  'add',
  'subtract',
  'intersect',
] as const

export type ModelingCommandSchema = {
  Extrude: {
    selection: Selections // & { type: 'face' } would be cool to lock that down
    result: (typeof EXTRUSION_RESULTS)[number]
    distance: number
  }
}

export const modelingMachineConfig: CommandSetConfig<
  typeof modelingMachine,
  ModelingCommandSchema
> = {
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
      },
      result: {
        inputType: 'options',
        payload: 'add',
        required: true,
        options: EXTRUSION_RESULTS.map((r) => ({
          name: r,
          isCurrent: r === 'add',
          value: r,
        })),
      },
      distance: {
        inputType: 'number',
        defaultValue: 5,
        required: true,
      },
    },
  },
}
