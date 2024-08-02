import { Models } from '@kittycad/lib'
import { StateMachineCommandSetConfig, KclCommandValue } from 'lib/commandTypes'
import { KCL_DEFAULT_LENGTH } from 'lib/constants'
import { Selections } from 'lib/selections'
import { modelingMachine, SketchTool } from 'machines/modelingMachine'

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
  Fillet: {
    // todo
    selection: Selections
    radius: KclCommandValue
  }
  'change tool': {
    tool: SketchTool
  }
}

export const modelingMachineCommandConfig: StateMachineCommandSetConfig<
  typeof modelingMachine,
  ModelingCommandSchema
> = {
  'Enter sketch': {
    description: 'Enter sketch mode.',
    icon: 'sketch',
  },
  'change tool': [
    {
      description: 'Start drawing straight lines.',
      icon: 'line',
      displayName: 'Line',
      args: {
        tool: {
          defaultValue: 'line',
          required: true,
          skip: true,
          inputType: 'string',
        },
      },
    },
    {
      description: 'Start drawing an arc tangent to the current segment.',
      icon: 'arc',
      displayName: 'Tangential Arc',
      args: {
        tool: {
          defaultValue: 'tangentialArc',
          required: true,
          skip: true,
          inputType: 'string',
        },
      },
    },
    {
      description: 'Start drawing a rectangle.',
      icon: 'rectangle',
      displayName: 'Rectangle',
      args: {
        tool: {
          defaultValue: 'rectangle',
          required: true,
          skip: true,
          inputType: 'string',
        },
      },
    },
  ],
  Export: {
    description: 'Export the current model.',
    icon: 'floppyDiskArrow',
    needsReview: true,
    args: {
      type: {
        inputType: 'options',
        defaultValue: 'gltf',
        required: true,
        options: [
          { name: 'glTF', isCurrent: true, value: 'gltf' },
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
        selectionTypes: ['extrude-wall', 'start-cap', 'end-cap'],
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
        defaultValue: KCL_DEFAULT_LENGTH,
        required: true,
      },
    },
  },
  Fillet: {
    // todo
    description: 'Fillet edge',
    icon: 'fillet',
    needsReview: true,
    args: {
      selection: {
        inputType: 'selection',
        selectionTypes: [
          'default',
          'line-end',
          'line-mid',
          'extrude-wall', // to fix: accespts only this selection type
          'start-cap',
          'end-cap',
          'point',
          'edge',
          'line',
          'arc',
          'all',
        ],
        multiple: true, // TODO: multiple selection like in extrude command
        required: true,
        skip: true,
      },
      radius: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LENGTH,
        required: true,
      },
    },
  },
}
