import { assign, fromPromise, setup } from 'xstate'
import { Project, FileEntry } from 'lib/project'

type FileMachineContext = {
  project: Project
  selectedDirectory: FileEntry
  itemsBeingRenamed: (FileEntry | string)[]
}

type FileMachineEvents =
  | { type: 'Open file'; data: { name: string } }
  | { type: 'Open file in new window'; data: { name: string } }
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
        shouldSetToRename?: boolean
        targetPathToClone?: string
      }
    }
  | { type: 'Delete file'; data: FileEntry }
  | { type: 'Set selected directory'; directory: FileEntry }
  | { type: 'navigate'; data: { name: string } }
  | {
      type: 'xstate.done.actor.read-files'
      output: Project
    }
  | {
      type: 'xstate.done.actor.rename-file'
      output: {
        message: string
        oldPath: string
        newPath: string
      }
    }
  | {
      type: 'xstate.done.actor.create-and-open-file'
      output: {
        message: string
        path: string
        shouldSetToRename: boolean
      }
    }
  | {
      type: 'xstate.done.actor.create-file'
      output: {
        path: string
      }
    }
  | {
      type: 'xstate.done.actor.delete-file'
      output: {
        message: string
      }
    }
  | { type: 'assign'; data: { [key: string]: any } }
  | { type: 'Refresh' }

export const fileMachine = setup({
  types: {} as {
    context: FileMachineContext
    events: FileMachineEvents
    input: Partial<Pick<FileMachineContext, 'project' | 'selectedDirectory'>>
  },
  actions: {
    setFiles: assign(({ event }) => {
      if (event.type !== 'xstate.done.actor.read-files') return {}
      return { project: event.output }
    }),
    setSelectedDirectory: assign(({ event }) => {
      if (event.type !== 'Set selected directory') return {}
      return { selectedDirectory: event.directory }
    }),
    addFileToRenamingQueue: assign({
      itemsBeingRenamed: ({ context, event }) => {
        if (event.type !== 'xstate.done.actor.create-and-open-file')
          return context.itemsBeingRenamed
        return [...context.itemsBeingRenamed, event.output.path]
      },
    }),
    removeFileFromRenamingQueue: assign({
      itemsBeingRenamed: ({ context, event }) => {
        if (event.type !== 'xstate.done.actor.rename-file')
          return context.itemsBeingRenamed
        return context.itemsBeingRenamed.filter(
          (path) => path !== event.output.oldPath
        )
      },
    }),
    navigateToFile: () => {},
    openFileInNewWindow: () => {},
    renameToastSuccess: () => {},
    createToastSuccess: () => {},
    toastSuccess: () => {},
    toastError: () => {},
  },
  guards: {
    'Name has been changed': ({ event }) => {
      if (event.type !== 'xstate.done.actor.rename-file') return false
      return event.output.newPath !== event.output.oldPath
    },
    'Has at least 1 file': ({ event }) => {
      if (event.type !== 'xstate.done.actor.read-files') return false
      return !!event?.output?.children && event.output.children.length > 0
    },
    'Is not silent': ({ event }) =>
      event.type === 'Create file' ? !event.data.silent : false,
    'Should set to rename': ({ event }) =>
      (event.type === 'xstate.done.actor.create-and-open-file' &&
        event.output.shouldSetToRename) ||
      false,
  },
  actors: {
    readFiles: fromPromise(({ input }: { input: Project }) =>
      Promise.resolve(input)
    ),
    createAndOpenFile: fromPromise(
      (_: {
        input: {
          name: string
          makeDir: boolean
          selectedDirectory: FileEntry
          targetPathToClone?: string
          content?: string
          shouldSetToRename: boolean
        }
      }) => Promise.resolve({ message: '', path: '' })
    ),
    renameFile: fromPromise(
      (_: {
        input: {
          oldName: string
          newName: string
          isDir: boolean
          selectedDirectory: FileEntry
        }
      }) => Promise.resolve({ message: '', newPath: '', oldPath: '' })
    ),
    deleteFile: fromPromise(
      (_: {
        input: { path: string; children: FileEntry[] | null; name: string }
      }) => Promise.resolve({ message: '' } as { message: string } | undefined)
    ),
    createFile: fromPromise(
      (_: {
        input: {
          name: string
          makeDir: boolean
          selectedDirectory: FileEntry
          content?: string
        }
      }) => Promise.resolve({ path: '' })
    ),
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QDECWAbMACAtgQwGMALVAOzAGI9ZZUpSBtABgF1FQAHAe1oBdUupdiAAeiACwAmADQgAnogAcANgCsAOnHiAjOICcAZh3K9TRQHYAvpdlpMuQiXIUASmABmAJzhFmbJCDcfAJCAWIIUrIKCHpq6nraipJJKorahqrWthjY+MRkYOoAEtRYpFxY7jmwFADC3ni82FWYfsJBqPyCwuG6hurKTAYG5mlSyeJRiHqS2prKg6Mj2pKz4lkgdrmOBcWlLXCuYKR4OM05bQEdXaGgvdpD6qPiioqqieJM2gaqUxELT3MQz0eleBlMhmUGy2Dny5D2sEq1TqDSaSNarHaPE6IR6iF0ij08SGklUpikym0qkm8gkJie1KYklB70UBkkTChNk2OVhTkKJURBxq9TAjXOrW0-k42JueIQfQMAyGIzGq0UNOiqg5mi+5nMlM+gxm0N5eX5CPRhwAImBMGiDpcZcFumF8dptMp1GZRpT9YZOXo-ml1IlzMkHuZVOyDGpTfZzbtBVaagB5DjHK1OwKy3FuhX6JWDYajXTqzUSRKh8FMPTa1TmBJDePbOEC-bIgDKYF4WFgdrABCaECwEFQ3iHXE8cmz1zzd3xkmUSveP0UJJWyT+sfE3o94PSbK0KxbfN2osaZCgWDwpBHXAzpCvVooEEEhTIADcuABrQoEVEwAAWlvCAgIfY4gMdTErlzV0FwVH5dx3ZdtUSA9lD+B4qW9EkmE5ZkEnMAxT0TeEL34Uhr1ArAIKfKiXzfeEv1-f9AJAu9wMfKCLilLEXVuURpmUcw91JakDAsLQRiwplFHUIxlDeUxZlGRRSJ2cjUWfGi6OfA4KDATxPCndQOHQRp3CnHB1AAsUmg4sC6J4jFpRzAT5SpHDPRGalRlUJJxF+WkEAbJgFOUZJCQ+NJvg0tt1DcE4cH0nJX3fdQWL-dRvGS4DoLcud4KEhBY1EhJ3iCqkdGGRQ-jJDQmCCwlYyYUYlnii0ktOVLMHS5jSG-bLctOfLeMKuDBPCMr4i8qrqW+SS-nDDRJK0VYXmZcRwU63ZupShiDKMkzPDMizeCszwbJGs4XLAWdJvlEZRMkcQDXDVDY20cxltWdRXjZXQzDUSQdu5GEyMKW17V6ygmI-QbWPUCABwcgr+JxYrpv1dRXvepcfi+n6QoMfDQ2ZALzH3d6rHBs1NKh1HYcM4zTPMyzrOR1GxtcjG5XzZ7cbekSCejP0-g5SR-skprVD9Kkvl2+E3DwMdDuReHMsR4axTA4UHo8-MZnCn5iNjOXXjrbRlpWb12U9Hzo1mdS6YTBnEt12Gak1rLCgaPXqgYPjYMNhDjYUhthjUJTCXeP5TC9SlowsS260JJXChVtXr2FFmTrOjmrpy3W7tgA3Mam6YdVNqOLdj62QvXIkY31YWl0+dZXdbC0KOZn3tbY+yefumDnQrzyGyJNQ3teJTYxMAwsNmIkNpeIKpC+TIu7PLT7OZ462fOy6bLs8U7vL-mEKpdd4j0F52WjUw2ob6IPXDXHUPEYspAMKlrG5coKN4ABAhgzPm84SpAUwiFKBuF8L7iZGoEEPwM6WnKCmcBWN8Skynl-CErx9CqGpPHWYAw2TKRmBySSkhUHJmFJgyuiFvqaAmItN45gdB1RCngzQrxEi6CMB9VBvcGK6UfLDBhnlRhSzLBYVYSktoyBCg8UGTwlJ6HDCkB4RDUH7QkSHce+ZIghUWLjYYeFf4qCCqg6GPZ9Fj0viVQkAxPR+RqloIhxNX6glxuGfCkgOGCKTroz26tMDAIcRA8IkU5hIXXhqDRjYvHTFrOoakd98JlQjNoVB6Zjj2PcoYq+0jQxSDkUuJId8lHRHBCuUYTU-T6mpMI7SYSwCSPzN9JIpTkjhgqYorC30pZtSIdqWMbwAr-0sEAA */
  id: 'File machine',

  initial: 'Reading files',

  context: ({ input }) => {
    return {
      project: input.project ?? ({} as Project), // TODO: Either make this a flexible type or type this property to allow empty object
      selectedDirectory: input.selectedDirectory ?? ({} as FileEntry), // TODO: Either make this a flexible type or type this property to allow empty object
      itemsBeingRenamed: [],
    }
  },

  on: {
    assign: {
      actions: assign(({ event }) => ({
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
            guard: 'Is not silent',
          },
          'Creating file',
        ],

        'Delete file': {
          target: 'Deleting file',
        },

        'Open file': {
          target: 'Opening file',
        },

        'Open file in new window': {
          target: 'Opening file in new window',
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
        input: ({ event, context }) => {
          if (event.type !== 'Create file')
            // This is just to make TS happy
            return {
              name: '',
              makeDir: false,
              selectedDirectory: context.selectedDirectory,
              content: '',
              shouldSetToRename: false,
            }
          return {
            name: event.data.name,
            makeDir: event.data.makeDir,
            selectedDirectory: context.selectedDirectory,
            targetPathToClone: event.data.targetPathToClone,
            content: event.data.content,
            shouldSetToRename: event.data.shouldSetToRename ?? false,
          }
        },
        onDone: [
          {
            target: 'Reading files',

            actions: [
              {
                type: 'createToastSuccess',
                params: ({
                  event,
                }: {
                  // TODO: rely on type inference
                  event: Extract<
                    FileMachineEvents,
                    { type: 'xstate.done.actor.create-and-open-file' }
                  >
                }) => {
                  return { message: event.output.message }
                },
              },
              'addFileToRenamingQueue',
              'navigateToFile',
            ],

            guard: 'Should set to rename',
          },
          {
            target: 'Reading files',
            actions: [
              {
                type: 'createToastSuccess',
                params: ({
                  event,
                }: {
                  // TODO: rely on type inference
                  event: Extract<
                    FileMachineEvents,
                    { type: 'xstate.done.actor.create-and-open-file' }
                  >
                }) => {
                  return { message: event.output.message }
                },
              },
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
        input: ({ event, context }) => {
          if (event.type !== 'Rename file') {
            // This is just to make TS happy
            return {
              oldName: '',
              newName: '',
              isDir: false,
              selectedDirectory: {} as FileEntry,
            }
          }
          return {
            oldName: event.data.oldName,
            newName: event.data.newName,
            isDir: event.data.isDir,
            selectedDirectory: context.selectedDirectory,
          }
        },

        onDone: [
          {
            target: '#File machine.Reading files',
            actions: ['renameToastSuccess'],
            guard: 'Name has been changed',
          },
          'Reading files',
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
        input: ({ event }) => {
          if (event.type !== 'Delete file') {
            // This is just to make TS happy
            return {
              path: '',
              children: [],
              name: '',
            }
          }
          return {
            path: event.data.path,
            children: event.data.children,
            name: event.data.name,
          }
        },
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
        input: ({ context }) => context.project,
        onDone: [
          {
            guard: 'Has at least 1 file',
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

    'Opening file in new window': {
      entry: ['openFileInNewWindow'],
    },

    'Creating file': {
      invoke: {
        src: 'createFile',
        id: 'create-file',
        input: ({ event, context }) => {
          if (event.type !== 'Create file') {
            // This is just to make TS happy
            return {
              name: '',
              makeDir: false,
              selectedDirectory: {} as FileEntry,
              content: '',
            }
          }
          return {
            name: event.data.name,
            makeDir: event.data.makeDir,
            selectedDirectory: context.selectedDirectory,
            content: event.data.content,
          }
        },
        onDone: 'Reading files',
        onError: 'Reading files',
      },
    },
  },
})
