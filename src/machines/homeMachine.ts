import { assign, createMachine, fromPromise, setup } from 'xstate'
import { type ProjectWithEntryPointMetadata } from 'lib/types'
import { HomeCommandSchema } from 'lib/commandBarConfigs/homeCommandConfig'
import { useNavigate } from 'react-router-dom'

export const homeMachine = setup({
  types: {
    context: {} as {
      projects: ProjectWithEntryPointMetadata[]
      defaultProjectName: string
      defaultDirectory: string
      navigate: ReturnType<typeof useNavigate>
    },
    events: {} as
      | { type: 'Open project'; data: HomeCommandSchema['Open project'] }
      | { type: 'Rename project'; data: HomeCommandSchema['Rename project'] }
      | { type: 'Create project'; data: HomeCommandSchema['Create project'] }
      | { type: 'Delete project'; data: HomeCommandSchema['Delete project'] },
    input: {} as {
      navigate: ReturnType<typeof useNavigate>
      defaultProjectName: string
      defaultDirectory: string
    },
  },
  actions: {} as { toastSuccess: () => void; toastError: () => void },
  actors: {
    readProjects: fromPromise(async () => {
      return []
    }),
    createProject: fromPromise(async () => {
      return
    }),
    renameProject: fromPromise(async () => {
      return
    }),
    deleteProject: fromPromise(async () => {
      return
    }),
  },
}).createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QAkD2BbMACdBDAxgBYCWAdmAMS6yzFSkDaADALqKgAOqtALsaqXYgAHogAsAJgA0IAJ6IJATgAcAOgBsAdgCsYzYoCMEsdu3LNAXwsy0mHARLlVyallKosHAE6oAVmHweWAoAYS8wXB5sbz8AnmY2JBAuXn5BJNEEAzF1MVVdXUV1JnVtCXUVGXkECW0DVTEAZgNlRvUDbINS5SsbDGw8IjIwZ1cY-0DggCUwUlw7cbiEoRTiPgEhTI6O-KZtJnMzOs0dKsRNVtU9xqbG5Wzc7V6QWwGHYdHYTx8JoNDwyLRH5LVgrbhrNKbRAPPIFMRFEplCrKM4IXL1MRdCq1C7KRSKRrPV72IZOFxfRaTCgAETAABswFFvrFAsskqt1ulQFscrCTPDiqVypU5OdlNpVBJlMUzLkVCcJET+iTHCNyczfsEAPIcWYakGJTjgzlQrK8-L8hFC5Go1oS7aFfSKJpKuyDVWqMIRPikKD6wIUCACEZkABuqAA1iN8ACogBaSnxUHs42QjLQ81wq1IkXVEzqVTSlQlJgGRoEgyut6kkZeyJkP2JihgLw+LyqDh0yIAM1QXnQqhj3rACeBrOTRtSG3TZtKheUTFLEnL2hXYlt9UaEiUBmdYjx6illesL2V7o+Mzm6Ab-p4geDqjDkZG4SvI8TbMnEOn3MQjR0hb4uoFSNGUkhMIoqKrnkByHioigQUoRRViqF6zPMN5Ni2bYdl2PC9v2qivvM75jkmhrJKmP4iH+AF4kUIFgRIEGomImKFkYyiSNo6h3EYigoeeTi0gyPqNmR95OE+UaqBA9KMqRLLkWCU5cjRs4SkwzH3Ioq56eYUHwqo2RboeoHOgYmjqIJ7zCfJYm3s2rZ9rhPZ9gOcmiYpvyfpRqmmg8BagauoHSroXHrqKaIElcRiHlxjRMCuTwnsSQkjDMuAQJhZHBEGUmkOGMkAhAo5KbAvkcmmv4IIozHGXUpYVGxByNKiFRMKoJz4icOSGGYYg2TWqiZdlvq3nlD7SS+ESlYmFUGBRVXUZkdWdQYjVdHurWos0ErLolJxcR05hWUNHqjTl5VOThnZuYRJVlZqlVUWpq31RtBhNdtrSotuEiqLpRR6IelklMeJ7uHJ8BJGltlgCp35vYgcbqKiqPnR86ruBNiMmjOnGaA0pilJomI6FKf11Pk+KtPiJTOkwg2pWe8OfLjKb+QTShqN1bHKOUOQC21UWaJZXV6V0G1MJoUopX0bps3WDmJnj1XqWDm73CYuiy0Ypiol9BZ4gN4raDomh8ZjTiXhh42q5zSOmpIUE3PkvH7KU7QmPo1sjCJjJXb8asrdCmilqofE63oEj69oUEVF1i6x7LBzStZLOK8Nl327lIfIwgZiKF1Nw3GWShJXsu31ZbiUErXuRnZn1YejqsxB3E+cBeHWvZKYMdxxu9TSvuYhNdKjR3FYVhAA */
    id: 'Home machine',

    initial: 'Reading projects',

    context: ({ input }) => ({
      projects: [] as ProjectWithEntryPointMetadata[],
      ...input,
    }),

    states: {
      'Has no projects': {
        on: {
          'Create project': {
            target: 'Creating project',
          },
        },
      },

      'Has projects': {
        on: {
          'Rename project': {
            target: 'Renaming project',
          },

          'Create project': {
            target: 'Creating project',
          },

          'Delete project': {
            target: 'Deleting project',
          },

          'Open project': {
            target: 'Opening project',
          },
        },
      },

      'Creating project': {
        invoke: {
          id: 'create-project',
          src: 'createProject',
          onDone: [
            {
              target: 'Reading projects',
              actions: ['toastSuccess'],
            },
          ],
          onError: [
            {
              target: 'Reading projects',
              actions: ['toastError'],
            },
          ],
        },
      },

      'Renaming project': {
        invoke: {
          id: 'rename-project',
          src: 'renameProject',
          onDone: [
            {
              target: '#Home machine.Reading projects',
              actions: ['toastSuccess'],
            },
          ],
          onError: [
            {
              target: '#Home machine.Reading projects',
              actions: ['toastError'],
            },
          ],
        },
      },

      'Deleting project': {
        invoke: {
          id: 'delete-project',
          src: 'deleteProject',
          onDone: [
            {
              actions: ['toastSuccess'],
              target: '#Home machine.Reading projects',
            },
          ],
          onError: {
            actions: ['toastError'],
            target: '#Home machine.Has projects',
          },
        },
      },

      'Reading projects': {
        invoke: {
          id: 'read-projects',
          src: 'readProjects',
          onDone: [
            {
              cond: 'Has at least 1 project',
              target: 'Has projects',
              actions: ['setProjects'],
            },
            {
              target: 'Has no projects',
              actions: ['setProjects'],
            },
          ],
          onError: [
            {
              target: 'Has no projects',
              actions: ['toastError'],
            },
          ],
        },
      },

      'Opening project': {
        entry: ['navigateToProject'],
      },
    },
    },

    predictableActionArguments: true,
    preserveActionOrder: true,
  },
)
