import { assign, fromPromise, setup } from 'xstate'
import { Project, FileEntry } from 'lib/project'

type FileMachineContext = {
  project: Project
  selectedDirectory: FileEntry
  itemsBeingRenamed: (FileEntry | string)[]
}

type FileMachineEvents =
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
      }
    }
  | {
      type: 'xstate.done.actor.create-file'
      output: {
        path: string
      }
    }
  | { type: 'assign'; data: { [key: string]: any } }
  | { type: 'Refresh' }

export const fileMachine = setup({
  types: {} as {
    context: FileMachineContext
    events: FileMachineEvents
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
          content: string
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
      }) => Promise.resolve('' as string | undefined)
    ),
    createFile: fromPromise(
      (_: {
        input: {
          name: string
          makeDir: boolean
          selectedDirectory: FileEntry
          content: string
        }
      }) => Promise.resolve({ path: '' })
    ),
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QDECWAbMACAtgQwGMALVAOzAGI9ZZUpSBtABgF1FQAHAe1oBdUupdiAAeiACwAmADQgAnogAcANgCsAOnHiAjOICcAZh3K9TRQHYAvpdlpMuQiXIUASmABmAJzhFmbJCDcfAJCAWIIUrIKCHpq6nraipJJKorahqrWthjY+MRkYOoAEtRYpFxY7jmwFADC3ni82FWYfsJBqPyCwuG6hurKTAYG5mlSyeJRiHqS2prKg6Mj2pKz4lkgdrmOBcWlLXCuYKR4OM05bQEdXaGgvdpD6qPiioqqieJM2gaqUxELT3MQz0eleBlMhmUGy2Dny5D2sEq1TqDSaSNarHaPE6IR6iD6BgGQxGY1Wikm8gkQM0n2UknERm0qmUw2hOVhTkKJURBxq9TAjXOrW0-k42JueIQBKJw1GujJFOiqkkTE0X3M5mUuiYgxmbPseU5CPRhwAImBMGiDpcxcFumF8dptMp1GZRlqNYYdXo-ml1IlzMkHuZVAZJAY1PrtnCuftkQB5DjHE02wLi3EOqX6QmDWWkiZ-HSKf3gph6ZWqcwJIZRjm7bkmmoAZTAvCwsAtYAITQgWAgqG83a4njkqeuGbu+MkLPU7x+iiGszJfwj4ldTvB6UURh0klrht2-MaZCgWDwpF7XCTpBPJooEEEhTIADcuABrQoEVFgAC054gP5XscP7WpiVzpvak5SnO6hJD8RYfJ8ir4kw06zqoTDiMyTA4WGPz7js8JHvwpCnv+WBATepF3mAnieMO6gcOgjTuMOODqF+ApNH+F6AdeIEXGBto4pBoj4u8GjOiMqjiKMqhJFhfyVqqEbJIoCTkmk3wETG6huCcOC3gc96PuoL7voU3gGb+oGimmdq3GJCARuY8RMroEk6MMihKeWrpYepEZMKMSw6Ua+mnEZOQULR9GeIxzG8KxnjsVZpw2YJdnjqJ4QjK59KaoGLKhh6fyBpIsFgtqKjKuCYW7OalpRZgJnwuZH7qBAnbcbZWIOZKeXqAVyhFT8EbaOYK44f6kjlhYG6FVYNibOyB7wo1rbNZQsUMUxLFsZ13UZRiWUQY5uUakNskjdOY2lZSCAqhV24LlhHpMl89Xwm4eD9tRvKtU+pCvh1DQAbyY5nZKMwqZWwxqMorzltoZUrK6YbOlJoazIoX2FD9f2ngDD5tcDFnqGDAmYLADAin1InndMKrqD85jw8ySPvH8pgulqoYWEjc16HjekCoTjYxXRu2JclqVi1TcCQ-1mYwyzcMRhz6lcw9C56Cz4Yatd05ISLxFbYDZlkx1nGCgrSsM5KTJVgMMmjKkEYmAYfwrOkQ30i8WFSF8mTLTCa2FGb-3RTt8V7UlB02z1mX0xKmZMgu8R6C8YahqYwUow9TqBkNxXiLmUgGEyIsRYZUctSTQMg5ZxzpXbdPgcrUEuW57xYUyXkGD5D2Bhog9aKsLyzQywsbOUXXwAEYeEWAKcTk5P7KH8G+ujhuHDDJTJZ0t2QGsvxrlI2q85fiBhlgMZcQq8+iqDJ3OzAML2qCCqxDEkIsNryK+jMpSV1clIck3xB6ViLIWEwmhXiJF0EYIqptUS3nIpRLaQDHajAqvKCwqxEZTxkIXVChJNTqUDCkB4L9q4t1rkTHI2DMyRAeosIawxFxDESMoLCIsNokUYZgZhUF1IDGdK7LyWgX6TULqCIagYcKSHMAya6VdQ6rTPgTLaC9hKpygnSOY8FA7kj0J6WR0QISzn0J8IYN0tIi0TMcLBHcHZp1wf6cB5UiFZxIdEcEhJKyvQ9BqGSqCuIuL0WvXoHj8HeKSL472E0KrBRfrVRGL9cbWEsEAA */
  id: 'File machine',

  initial: 'Reading files',

  context: {
    project: {} as Project, // TODO: Either make this a flexible type or type this property to allow empty object
    selectedDirectory: {} as FileEntry, // TODO: Either make this a flexible type or type this property to allow empty object
    itemsBeingRenamed: [],
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
            }
          return {
            name: event.data.name,
            makeDir: event.data.makeDir,
            selectedDirectory: context.selectedDirectory,
            content: event.data.content ?? '',
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
            content: event.data.content ?? '',
          }
        },
        onDone: 'Reading files',
        onError: 'Reading files',
      },
    },
  },
})
