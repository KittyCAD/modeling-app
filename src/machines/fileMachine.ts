import { assign, createMachine } from 'xstate'
import type { FileEntry } from 'lib/types'
import { Project } from 'wasm-lib/kcl/bindings/Project'

export const fileMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QDECWAbMACAtgQwGMALVAOzAGI9ZZUpSBtABgF1FQAHAe1oBdUupdiAAeiAKwBGcQDoALACYAHAE4AzGoUA2JXK1yANCACeiabOmSlGpkqsqAvg6NpMuQiXIUASmABmAE5wRMxsSCDcfAJC4WIIWgpMMtpqkgrKalJa0kamCJIA7AUySgX6mkwK4gXVckpOLhjY+MRkYDIAEtRYpFxYfk2wFADCQXi82AOYocKRqPyCwnGSmbJa4ulKquJqcnriuYiaKsm2BSpVTAVyTOJyDSCuzR5tnd1TcD5gpHg4k00zcJzBYxUBxFRKWRKLS3XRqFSSHTVQ4IXRJAppRJWSr6erOR5NdytchvWD9QYjMYTcnTVizHjzaJLMyrGTrTbbXb7FF3E6SOSaNRMJhaLQFeEKB5PImedpdMkfIYAETAmGpH0BnAZIOZ+VZ7OUnL26xRui0MnE2WkpQxq0l+OlLVlpJpnwA8hxvq7NRFtUzYizxGsNoaVDtjQcTIh1JISsLMiLUlIrlLCU7XvLXUMAMpgXhYWCqsAECYQLAQVBBEtcALGH3A-1gsxpYoIla6BQqcUqbIo65JGF3LRCjSSJj3B1pl4k0ZgcZkKCuigQQTtMgANy4AGt2gQqWAALQaulAv2LAN6vbJLtXc7KDYXFE3YoihQFJhqcXiJiFPGNNzpjOVILkuYABAENYyBw6DjH4NY4DIe5zhMR4AieWpROeTZ6paMgQlo6iKNIlSRnkdgyJonYKHIiLpDoBGpgB07tL4Pw4CBHzLquMgbtu7RBGxh7HmEGGMlhohHB+8hVDUVwQvy2gogk5ppBc9jZNY4h-gSTHEix3y-BxTQUGBEEBFBMG8HBAQIQJvxCWhIm+phoISQgxzyCoXmQmoShXPy0Ior55qihcFzZPGlSMc8ekyCqapGZgXEkrxO4yBARYocJ9IubqKy4SsNyWmkGhKMoPIQnhOg1G+5xhnY0Uyq88V5ollCmZB0GwfB6WZQ5tJOQ24nLJkxR6KUP6+XIPaIn2dzJDavnaN+w5aI1gH6XgFakIuirJWupCbmlYwQKhmCwPWZ6uXEdhqDIY6VNRiTimoYp9nU8i+QUdidsOlpqOtzEyL4W1tUMK4pYdfEyCdZ1wAwkiDVduq3fdwrpIoVwaG9UbudIyQ2F5Qrij+BSA7FIPbbtFIdeZXVWT1sOKpduUXqjD0Y892MFCi6QKHh4g9gKVE7K9a0PL0GXwOEjrMTlYnXYgCiaBa1xVHIdywtRKIHlC5QadRdjTRc5POpmvRZvLOoXpIhSxso751Hc00KJIQWdhRZRlKklTwmGE7-jFZvvIMVuNm5tvfWyhRFM7Gtvmopo3CUfm-kmBSu+IpuvLO847a6YfDWYdytpyWw7ELKg8sKca2Gkz6ItU2ckqxhn5x8heKwgyhJLU6ua1p2u43YsbWEVjsftY9qB01JItfw7dNJ3eUl3hZc+ZXppScr40Quj6jTzpQevJTYPLxeGxKCUmQXOO+yk0+00lE9pMCrbuzizPG0yB63xtef2FpByFLmGXyG99BV1xioWwFodiilGrcV2eInBAA */
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
              actions: ['toastSuccess', 'addFileToRenamingQueue'],
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
        | { type: 'done.invoke.create-file'; data: string }
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
