import { assign, createMachine } from 'xstate'
import { type ProjectWithEntryPointMetadata } from 'lib/types'
import { FileEntry } from '@tauri-apps/api/fs'

export const FILE_PERSIST_KEY = 'Last opened KCL files'
export const DEFAULT_FILE_NAME = 'Untitled'

export const fileMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QAkD2BbMACdBDAxgBYCWAdmAHTK6xampYAOATqgFZj4AusAxAMLMwuLthbtOXANoAGALqJQjVLGJdiqUopAAPRAHYAbPooAWABwBGUwE5zAJgeGArM-MAaEAE9EN0wGYKGX97GX1nGVNDS0MbfwBfeM80TBwCEnIqGiZWDm4+ACUwUlxU8TzpeW1lVXVNbT0EcJNg02d-fzt7fU77Tx8EQ0iKCPtnfUsjGRtLGXtE5IxsPCIySmpacsk+QWFRHIluWQUkEBq1DS1TxqN7ChjzOxtXf0t7a37EcwsRibH-ZzRezA8wLEApZbpNZZTa5ba8AAiYAANmB9lsjlVTuc6ldQDdDOYKP5bm0os5TDJDJ8mlEzPpzIZHA4bO9umCIWlVpkNgcKnwAPKMYp8yTHaoqC71a6IEmBUz6BkWZzWDq2Uw0qzOIJAwz+PXWfSmeZJcFLLkZSi7ERkKCi7i8CCaShkABuqAA1pR8EIRGAALQYyonJSS3ENRDA2wUeyvd6dPVhGw0-RhGOp8IA8xGFkc80rS0Ua3qUh2oO8MDMVjMCiMZEiABmqGY6AoPr2AaD4uxYcuEYQoQpQWNNjsMnMgLGKbT3TC7TcOfsNjzqQL0KKJXQtvtXEdzoobs9lCEm87cMxIbOvel+MQqtMQRmS5ks31sZpAUsZkcIX+cQZJIrpC3KUBupTbuWlbVrW9ZcE2LYUCepRnocwYSrUfYyggbzvBQ+jMq49imLYwTUt4iCft+5i-u0-7UfoQEWtCSKoiWZbnruTqZIeXoUBAKJoihFTdqGGE3rod7UdqsQTI8hiGAqrIauRA7RvYeoqhO1jtAqjFrpkLFohBHEVlWzYwY2zatvxrFCWKWKiVKeISdh4yBJE-jGs4fhhA4zg0kRNgxhplhaW0nn4XpUKZEUuAQMZqF8FxLqkO6vG+hAgYcbAIlXmJzmNERdy0RYNiKgpthxDSEU6q8MSTJYjWGFFIEULF8WljuSX7jxx7CJlQY5ZYl44pht4IP61gyPc8njt0lIuH51UKrVVITEyMy2C1hbtQl-KmdBdaWQhGVZYluWjeJjSTf402shMEyuEyljPAFL0UNmMiuN86lWHMiSmvQ-HwKcnL6WA6FOf2k3mESMRDA4RpUm4U4qf6gSEt0QIvvqfjOCaiyrtF6zZPQXWQ+GWFlUEsbmNMf1TV9NLeXDcqRIySnNaaYPEzC5M9vl-b+IyFCjupryPF9jKWP5Kks-cbMWLERHRNt0LFntkgU2NLk4dqsz43YsTK++Kk2C+MbTOOcxzOMrhqzFxTgZ1Qba1dd6BUE1jGsLMxxK9KlDNqm3tMLUQvqYlgO5QhlsTubsFXesTTUuPTfHExshDS0RftRftGgEnTZtHbX9Zr+QJ-2S4Y3qnmTC+4tMyp1EfeOnmeQqdOhyXQrFOXXCV1hCkmLDOnBJYvRRDSsyRzGjiKj0lKdAkANAA */
    id: 'File machine',

    initial: 'Reading files',

    context: {
      project: {} as ProjectWithEntryPointMetadata,
      selectedDirectory: {} as FileEntry,
    },

    on: {
      assign: {
        actions: assign((_, event) => ({
          ...event.data,
        })),
        target: '.Reading files',
      },
    },
    states: {
      'Has no files': {
        on: {
          'Create file': {
            target: 'Creating file',
          },
        },
      },

      'Has files': {
        on: {
          'Rename file': {
            target: 'Renaming file',
          },

          'Create file': {
            target: 'Creating file',
          },

          'Delete file': {
            target: 'Deleting file',
          },

          'Open file': {
            target: 'Opening file',
          },

          'Set selected directory': {
            target: 'Has files',
            actions: ['setSelectedDirectory'],
          },
        },
      },

      'Creating file': {
        invoke: {
          id: 'create-file',
          src: 'createFile',
          onDone: [
            {
              target: 'Reading files',
              actions: ['toastSuccess'],
            },
          ],
          onError: [
            {
              target: 'Reading files',
              actions: ['toastError'],
            },
          ],
        },
      },

      'Renaming file': {
        invoke: {
          id: 'rename-file',
          src: 'renameFile',
          onDone: [
            {
              target: '#File machine.Reading files',
              actions: ['toastSuccess'],
            },
          ],
          onError: [
            {
              target: '#File machine.Reading files',
              actions: ['toastError'],
            },
          ],
        },
      },

      'Deleting file': {
        invoke: {
          id: 'delete-file',
          src: 'deleteFile',
          onDone: [
            {
              actions: ['toastSuccess'],
              target: '#File machine.Reading files',
            },
          ],
          onError: {
            actions: ['toastError'],
            target: '#File machine.Has files',
          },
        },
      },

      'Reading files': {
        invoke: {
          id: 'read-files',
          src: 'readFiles',
          onDone: [
            {
              cond: 'Has at least 1 file',
              target: 'Has files',
              actions: ['setFiles'],
            },
            {
              target: 'Has no files',
              actions: ['setFiles'],
            },
          ],
          onError: [
            {
              target: 'Has no files',
              actions: ['toastError'],
            },
          ],
        },
      },

      'Opening file': {
        entry: ['navigateToFile'],
      },
    },

    types: {
      events: {} as
        | { type: 'Open file'; data: { name: string } }
        | {
            type: 'Rename file'
            data: { oldName: string; newName: string; isDir: boolean }
          }
        | { type: 'Create file'; data: { name: string; makeDir: boolean } }
        | { type: 'Delete file'; data: FileEntry }
        | { type: 'Set selected directory'; data: FileEntry }
        | { type: 'navigate'; data: { name: string } }
        | {
            type: 'done.invoke.read-files'
            data: ProjectWithEntryPointMetadata
          }
        | { type: 'assign'; data: { [key: string]: any } },
    },

    preserveActionOrder: true,
    tsTypes: {} as import('./fileMachine.typegen').Typegen0,
  },
  {
    actions: {
      setFiles: assign((_, event) => {
        return { project: event.data }
      }),
      setSelectedDirectory: assign((_, event) => {
        return { selectedDirectory: event.data }
      }),
    },
  }
)
