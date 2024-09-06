import { assign, createMachine } from 'xstate'
import { Project, FileEntry } from 'lib/project'

export const fileMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QDECWAbMACAtgQwGMALVAOzAGI9ZZUpSBtABgF1FQAHAe1oBdUupdiAAeiACwAmADQgAnogAcANgCsAOnHiAjOICcAZh3K9TRQHYAvpdlpMuQiXIUASmABmAJzhFmbJCDcfAJCAWIIUrIKCHpq6nraipJJKorahqrWthjY+MRkYOoAEtRYpFxY7jmwFADC3ni82FWYfsJBqPyCwuG6hurKTAYG5mlSyeJRiHqS2prKg6Mj2pKz4lkgdrmOBcWlLXCuYKR4OM05bQEdXaGgvdpD6qPiioqqieJM2gaqUxELT3MQz0eleBlMhmUGy2Dny5D2sEq1TqDSaSNarHaPE6IR6iD6BgGQxGY1Wikm8gkQM0n2UknERm0qmUw2hOVhTkKJURBxq9TAjXOrW0-k42JueIQBKJw1GujJFOiqkkTE0X3M5mUuiYgxmbPseU5CPRhwAImBMGiDpcxcFumF8dptMp1GZRlqNYYdXo-ml1IlzMkHuZVAZJAY1PrtnCuftkQB5DjHE02wLi3EOqX6QmDWWkiZ-HSKf3gph6ZWqcwJIZRjm7bkmmoAZTAvCwsAtYAITQgWAgqG83a4njkqeuGbu+MkLPU7x+iiGszJfwj4ldTvB6UURh0klrht2-MaZCgWDwpF7XCTpBPJooEEEhTIADcuABrQoEVFgAC054gP5XscP7WpiVzpvak5SnO6hJD8RYfJ8ir4kw06zqoTDiMyTA4WGPz7js8JHvwpCnv+WBATepF3mAnieMO6gcOgjTuMOODqF+ApNH+F6AdeIEXGBto4pBoj4u8GjOiMqjiKMqhJFhfyVqqEbJIoCTkmk3wETG6huCcOC3gc96PuoL7voU3gGb+oGimmdq3GJCARuY8RMroEk6MMihKeWrpYepEZMKMSw6Ua+mnEZOQULR9GeIxzG8KxnjsVZpw2YJdnjqJ4QjK59KaoGLKhh6fyBpIsFgtqKjKuCYW7OalpRZgJnwuZH7qBAnbcbZWIOZKeXqAVyhFT8EbaOYK44f6kjlhYG6FVYNibOyB7wo1rbNZQsUMUxLFsZ13UZRiWUQY5uUakNskjdOY2lZSCAqhV24LlhHpMl89Xwm4eD9tRvKtU+pCvh1DQAbyY5nZKMwqZWwxqMorzltoZUrK6YbOlJoazIoX2FD9f2ngDD5tcDFnqGDAmYLADAin1InndMKrqD85jw8ySPvH8pgulqoYWEjc16HjekCoTjYxXRu2JclqVi1TcCQ-1mYwyzcMRhz6lcw9C56Cz4Yatd05ISLxFbYDZlkx1nGCgrSsM5KTJVgMMmjKkEYmAYfwrOkQ30i8WFSF8mTLTCa2FGb-3RTt8V7UlB02z1mX0xKmZMgu8R6C8YahqYwUow9TqBkNxXiLmUgGEyIsRYZUctSTQMg5ZxzpXbdPgcrUEuW57xYUyXkGD5D2Bhog9aKsLyzQywsbOUXXwAEYeEWAKcTk5P7KH8G+ujhuHDDJTJZ0t2QGsvxrlI2q85fiBhlgMZcQq8+iqDJ3OzAML2qCCqxDEkIsNryK+jMpSV1clIck3xB6ViLIWEwmhXiJF0EYIqptUS3nIpRLaQDHajAqvKCwqxEZTxkIXVChJNTqUDCkB4L9q4t1rkTHI2DMyRAeosIawxFxDESMoLCIsNokUYZgZhUF1IDGdK7LyWgX6TULqCIagYcKSHMAya6VdQ6rTPgTLaC9hKpygnSOY8FA7kj0J6WR0QISzn0J8IYN0tIi0TMcLBHcHZp1wf6cB5UiFZxIdEcEhJKyvQ9BqGSqCuIuL0WvXoHj8HeKSL472E0KrBRfrVRGL9cbWEsEAA */
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
              cond: 'Name has been changed',
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
    guards: {
      'Name has been changed': (_, event) => {
        return event.data.newPath !== event.data.oldPath
      },
    },
  }
)
