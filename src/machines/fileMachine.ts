import { assign, createMachine } from 'xstate'
import type { FileEntry } from 'lib/types'
import { Project } from 'wasm-lib/kcl/bindings/Project'

export const fileMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QDECWAbMACAtgQwGMALVAOzAGI9ZZUpSBtABgF1FQAHAe1oBdUupdiAAeiAKwBGcQDoALACYAHAE4AzGoUA2JXK1yANCACeiabOmSlGpkqsqAvg6NpMuQiXIUASmABmAE5wRMxsSCDcfAJC4WIIWgpMMtpqkgrKalJa0kamCJIA7AUySgX6mkwK4gXVckpOLhjY+MRkYDIAEtRYpFxYfk2wFADCQXi82AOYocKRqPyCwnGSmbJa4ulKquJqcnriuYiaKsm2BSpVTAVyTOJyDSCuzR5tnd1TcD5gpHg4k00zcJzBYxUBxFRKWRKLS3XRqFSSHTVQ4IXRJAppRJWSr6erOR5NdytchvWD9QYjMYTcnTVizHjzaJLMyrGTrTbbXb7FF3E6SOSaNRMJhaLQFeEKB5PImedpdMkfIYAETAmGpH0BnAZIOZ+VZ7OUnL26xRui0MnE2WkpQxq0l+OlLVlpJpnwA8hxvq7NRFtUzYizxGsNoaVDtjQcTIh1JISsLMiLUlIrlLCU7XvLXUMAMpgXhYWCqsAECYQLAQVBBEtcALGH3A-1gsxpYoIla6BQqcUqbIo65JGF3LRCjSSJj3B1pl4k0ZgcZkKCuigQQTtMgANy4AGt2gQqWAALQaulAv2LAP5ZQnaoQuR3K5KJg5KMIeFJJSJfQFeM7NSQ1NuOmM5UguS5gAEAQ1jIHDoOMfg1jgMh7nOExHgCJ5alE55NnqloyBCWjqIo0iVJGeR2DImidgociIukOiEQBzzEu0vg-DgoEfMuq4yBu27tEE7GHseYSYYy2GiEcTBqPIVQ1FcEL8toKIJOaaQXPY2TWOIeKNIB06sd8vycU0FDgZBATQbBvDwQEiGCb8wnoaJvpYaCkmvp28gqD5kJ-lc-LQiif7mqKFwXNk8aVExMqvCqaomZg3EknxO4yBARaoSJ9JubqKx4SsNyWmkGgfkoPIQvhOg1AoRQ+TpkgxUB7TxXmiWUOZUEwXBCHpZlTm0i5DYScsmTFHopRPn+cg9oifZ3MkNp-to4iJloTUGTIvh4BWpCLoqyVrqQm5pWMEBoZgsD1me7lxHYMljpUNGJOKahin2dTyH+BR2J2w6WmoG0sVtc67ftFIrilx38TIZ0XXADCSENN26vdMiPekihXBo70vkmyQ2D5Qrik+BRA8621g1mZkQV11m2fZoPw1dGGueJt2IGjGPPdjb0FCi6QKPh4g9gK1G-qKTj4r0GXwOEjoGTl7O6gomgWtcVR3kVH6GC+B5QuUlphtJKhaxOenMc6ma9FmSs6hekiFLGyjfnUdwzQokjBV5ahlGUqSVPCYbmwS+nA5mip242HmOz9bKFEU7t3rVaimjcJSPoU1jSAUnviOTryzvOe2ulHI1mHcraclsOyiyoPLCnGthpDcGLrGTk5hxTRkcSXHxlxzCDKEktSa-eOk0aajslLstyu9J1j2hbsUkq1-B900A95ZX+HV35demtJBMTRCwqdpoBckpT7Vy2J9s4RsSgzyLiQRqTKJ7CcOtYtcqSFetndLavA9N8dqW8HY7whGGP8+99D1xfCoWwFodiijGrcT2eInBAA */
    id: 'File machine',

    initial: 'Reading files',

    context: {
      project: {} as Project,
      selectedDirectory: {} as FileEntry,
      itemsBeingRenamed: [] as string[],
    },

    on: {
      assign: {
        actions: assign((_, event) => ({
          ...event.data,
        })),
        target: '.Reading files',
      },

      Refresh: '.Reading files',
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
              actions: [
                'createToastSuccess',
                'addFileToRenamingQueue',
                'navigateToFile',
              ],
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
              actions: ['renameToastSuccess'],
            },
          ],
          onError: [
            {
              target: '#File machine.Reading files',
              actions: ['toastError'],
            },
          ],
        },

        exit: 'removeFileFromRenamingQueue',
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

    schema: {
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
            data: Project
          }
        | {
            type: 'done.invoke.rename-file'
            data: {
              message: string
              oldPath: string
              newPath: string
            }
          }
        | {
            type: 'done.invoke.create-file'
            data: {
              message: string
              path: string
            }
          }
        | { type: 'assign'; data: { [key: string]: any } }
        | { type: 'Refresh' },
    },

    predictableActionArguments: true,
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
