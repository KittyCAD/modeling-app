import { assign, createMachine } from 'xstate'
import type { FileEntry } from 'lib/types'
import { Project } from 'wasm-lib/kcl/bindings/Project'

export const fileMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QDECWAbMACAtgQwGMALVAOzAGI9ZZUpSBtABgF1FQAHAe1oBdUupdiAAeiACwAmADQgAnogAcANgCsAOnHiAjOICcAZh3K9TRQHYAvpdlpMuQiXIUASmABmAJzhFmbJCDcfAJCAWIIUrIKCHpq6nraipJJKorahqrWthjY+MRkYOoAEtRYpFxY7jmwFADC3ni82FWYfsJBqPyCwuG6hurKTAYG5mlSyeJRiHqS2prKg6Mj2pKz4lkgdrmOBcWlLXCuYKR4OM05bQEdXaGgvdpD6qPiioqqieJM2gaqUxELT3MQz0eleBlMhmUGy2Dny5D2sEq1TqDSaSNarHaPE6IR6iD6BgGQxGY1Wikm8gkQM0n2UknERm0qmUw2hOVhTkKJURBxqABEwJg0QdLpxsTc8QhtNLlOozKNlNpzOZDEwTH80upEuZkg9zKoDJIDGo2fY8pyEejDgB5DjHK2iwLi3FhfH6QmDYajXRkinRHSKLXgph6VSSVQqh4GU3bOFc-bIgDKYF4WFggrABCaECwEFQ3izXE8ckd1xdd3xkhZ6neP0UQ1mZL+xvEcul4PSiiMOkkMY5u3qYEaZCgWDwpBzXDtpBHVooEEEhTIADcuABrQoEVFgAC044gO6nxx3IsxV2d3VdUtr6iSPwDH0+fvxTCrNdUTHEzKYP8NPz75oDqis77lgR4zqQo4HBQYCeJ4RbqBw6CNO4RY4OoW5Dk0e4Toe04nhcZ5isEl4VteTJaiy+riKMqhJF+fwRkw6jGskigJOSaTfABOzwm4Jw4LO0ELvCK7roU3gCbup7+MROKkaIiAjOY6j0uYyg6iyBqKuYfx0hoqixECIaGZITCqJkNibOygF8ccpxCTkMFwQhSEoWh6iSac0mEbJTokbcikIMpqk0RpVY-MaSp-Dqki3mCuhmGoRp6DxcbqAKQqOZg86LuoYkbuoEAZthMlYgFkohWp4VaVFumUsFP5apIoYWO26nKmlFqZSm2WULB8GeIhyG8KhnjocVQo+Rifllgp4RVWFmmRTpfxmXFXb1l+OlMl8XW7G4eB5pBVo1CJS6kKuhUNAevKlhegXhDMzE-OYwxqMoryhtoMUrHKhraIqtWzIo+12UdfVnXlBUSUOt3VAw2izQ9krPSxEbvcyX3vH8piyoqBoWF9rWpVZMK2YUh3HVByIDa5I1jehN0EZgsD3RVV5o69mOfexOMNfWegsUayphVWT5g-GPLIoOjTnK0SPlfJj1uv0nokj6EyMWZmhfMqiq0iGvZkzZvGFLL-AncJ0OXeJGHbizYDs8rkpMiqAyqDRryfcaJgGH8KzpKp9IvF+UhfJZ2Rmmb6gW31zmDcN7njfbWHTU7RH+S7V5MvW8R6C8hoGqYTDmD9DXSjqqlaeInpSAYTLWFZ5TFfAATk2bSsSleO7KH8O4aCCQ-D8PP6R9Z0fpdyZQVLyXflkF3whgMtcQq8+gWc+MSzAMm2GTMZkGEkkuWnP54c2R3xKpoEzfEfEYBn8q+aK8iS6EYmkn3HJ2geBfXz-NfEow4o+gsKsT6LVIgV1fISdS7EdQpAeBZE+-EHJWxyAAlWEQZANUWKpYYDYhiJGUF+E+PVLY00wJgyU7EBiA09uYHQ3YLL1WiJ2VSOofySEYR-AmKC4aQ2oVeOkcx7xh3JHoZUkjcbL09gXX84UuIn1tMcf+59s6X2AVqKQYCqxJALjg6I4JCQRi2jpZUnsv7AXQVQ9R3dNFJG0ckWKECDEByVHFUuFkwzGjeHRJulggA */
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
            target: 'Creating and opening file',
          },
        },
      },

      'Has files': {
        on: {
          'Rename file': {
            target: 'Renaming file',
          },

          'Create file': [
            {
              target: 'Creating and opening file',
              cond: 'Is not silent',
            },
            'Creating file',
          ],

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

      'Creating and opening file': {
        invoke: {
          id: 'create-and-open-file',
          src: 'createAndOpenFile',
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

      'Creating file': {
        invoke: {
          src: 'createFile',
          id: 'create-file',
          onDone: 'Reading files',
          onError: 'Reading files',
        },
      },
    },

    schema: {
      events: {} as
        | { type: 'Open file'; data: { name: string } }
        | {
            type: 'Rename file'
            data: { oldName: string; newName: string; isDir: boolean }
          }
        | {
            type: 'Create file'
            data: {
              name: string
              makeDir: boolean
              content?: string
              silent?: boolean
              makeUnique?: boolean
            }
          }
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
            type: 'done.invoke.create-and-open-file'
            data: {
              message: string
              path: string
            }
          }
        | {
            type: 'done.invoke.create-file'
            data: {
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
