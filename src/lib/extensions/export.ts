import { Extension } from '@src/lib/extension'

const exportExtension = new Extension('export', {
  commands: [
    {
      groupId: 'export',
      name: 'export',
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
          hidden: (commandContext) =>
            !['gltf', 'stl', 'ply'].includes(
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
      onSubmit(data, wasmInstance) {},
    },
  ],
})
