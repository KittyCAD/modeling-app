import { Models } from '@kittycad/lib'
import { CommandSetConfig, KclCommandValue } from 'lib/commandTypes'
import { Selections } from 'lib/selections'
import { modelingMachine } from 'machines/modelingMachine'

type OutputFormat = Models['OutputFormat_type']
type OutputTypeKey = OutputFormat['type']
type ExtractStorageTypes<T> = T extends { storage: infer U } ? U : never
type StorageUnion = ExtractStorageTypes<OutputFormat>

export const EXTRUSION_RESULTS = [
  'new',
  'add',
  'subtract',
  'intersect',
] as const

export type ModelingCommandSchema = {
  'Enter sketch': {}
  Export: {
    type: OutputTypeKey
    storage?: StorageUnion
  }
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
  Export: {
    description: 'Export the current model.',
    icon: 'exportFile',
    needsReview: true,
    args: {
      type: {
        inputType: 'options',
        defaultValue: 'gltf',
        required: true,
        options: [
          { name: 'gLTF', isCurrent: true, value: 'gltf' },
          { name: 'OBJ', isCurrent: false, value: 'obj' },
          { name: 'STL', isCurrent: false, value: 'stl' },
          { name: 'STEP', isCurrent: false, value: 'step' },
          { name: 'PLY', isCurrent: false, value: 'ply' },
        ],
      },
      storage: {
        inputType: 'options',
        defaultValue: (c) => {
          switch (c.argumentsToSubmit.type) {
            case 'gltf':
              return 'embedded'
            case 'stl':
              return 'ascii'
            case 'ply':
              return 'ascii'
            default:
              return undefined
          }
        },
        skip: true,
        required: (commandContext) =>
          ['gltf', 'stl', 'ply'].includes(
            commandContext.argumentsToSubmit.type as string
          ),
        options: (commandContext) => {
          const type = commandContext.argumentsToSubmit.type as
            | OutputTypeKey
            | undefined

          switch (type) {
            case 'gltf':
              return [
                { name: 'embedded', isCurrent: true, value: 'embedded' },
                { name: 'binary', isCurrent: false, value: 'binary' },
                { name: 'standard', isCurrent: false, value: 'standard' },
              ]
            case 'stl':
              return [
                { name: 'binary', isCurrent: false, value: 'binary' },
                { name: 'ascii', isCurrent: true, value: 'ascii' },
              ]
            case 'ply':
              return [
                { name: 'ascii', isCurrent: true, value: 'ascii' },
                {
                  name: 'binary_big_endian',
                  isCurrent: false,
                  value: 'binary_big_endian',
                },
                {
                  name: 'binary_little_endian',
                  isCurrent: false,
                  value: 'binary_little_endian',
                },
              ]
            default:
              return []
          }
        },
      },
    },
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
