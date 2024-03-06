import { assign, createMachine } from 'xstate'
import type { FileEntry, ProjectWithEntryPointMetadata } from 'lib/types'

export const FILE_PERSIST_KEY = 'Last opened KCL files'
export const DEFAULT_FILE_NAME = 'Untitled'

export const fileMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QDECWAbMACAtgQwGMALVAOzAGI9ZZUpSBtABgF1FQAHAe1oBdUupdiAAeiAKwBGcQDoALACYAHAE4AzGoUA2JXK1yANCACeiabOmSlGpkqsqAvg6NpMuQiXIyAEtSykuLAAzDDgKAGEAJzA8XmwQzGY2JBBuPgEhFLEESTVxWS1xBWVVcTU5PXEjUwRNFRkFWwB2FQVxJia5JnE5JxdQ92IyMB8-BLCAJTBSPBx40KThNNR+QWFslSVZJS1u3TUVSR1xJurEXSYZJslipismbTklPpBXbHwhr19YYNDYCOisXmiVYSx4Kwy6zMeQKRRKKjKFUKZwQPXqkjkmjUTCYWi0TQOCheb0GnhG31+mH+ABEwJg4pSwIsUstVplQNlcvkZIVikpSuVKijdFoZOItJJpEomtcYUTnK8Bh8yaMfuN-gB5DjTRnMzjgtlQnIwnlw-kIwXIkyIdSSGRKHF5XFqSwdYlKjzDVWM-4AZTAvCwsDpYAIcQgWAgqGiYa4kWMetSBshWTMNyaMkOuV0ChUBJUEpRnUuux6WmxGkkTF6CpJyq9URi-FIUEZFAgghGZAAblwANYjAiAuIAWnGidZKY50O5vPhiKF1oQcnF9q0myYCN2FSa4ndbnrXkbsTIrfGFDAkUicZkHHQsSCcZwMiHTbAY4WoJZybWqeNq82ddygUaQHiqJc7BkTRcwUOQjmKHR133d5PS8KYZhwU82w7Lwe37EZogw99xy-fV0l-adalzeQVForY1Ada4ni0FE5CaJRM0UAlmm6LRkNJL10NmLDz0va9Ilve9eEfSJn0I2ZiM-ZIyIhCjREQOoaLospGIxHYUQY0U8VaVoJUdB5+MPEZaXpETQnbTsZDwgcZAgENRxI5Sk3I9l1P-UVci6cUbg0JRlBRcRNkzHRdwUGVaPEOxLNQ6z3LszALyvG87wfJ9XPcxSQS8yc1M5PIMz0aU7gYuQCyOIsegaaUCTCwpnT42sPU+EYpjwKMWx9BzcNIXsXMBCAPypCcf187I7DUGQqweWDGgJNR8SLJ55AY9ibgLPJy2S7qZF6-qzz+IauxG-CZHGya4AYSRipmo15sWnFikUDoNA2pcXVkBQbFo7FuMkJojpVU70rCMTsqkmS5JiCb1WmnzXtyd7lq+tbfpqYoFEzSL9DqNofo6-oDxSigpiCaJYCIVHVNmxAtEaBpyxuZQ8iOaQUTBjNpWJxo2l3TpnheAI3PgFI6xSsE0b-EcWKXJWZBxHF2hAip0ySzrKeOikAh9eWmaNSVriappqy2CpWkkAzqLUJp8Q5h4DgRGsKZQg2xj+E3DT-c2OIlGVdwqFc4rUYUuntB0wesaQmhAvc9e9lVj2bc7MH9qc-OkNjMwFfkygLWqIpxe0cTsWCOiOE4IcE6ZhIG8Yc9KxBFFYlp5EkWirFB6Q1AbrwbIDaG2+ZnIegzTYLWLg59BUYUmAWwHKo3B51HlL2BLQpHoellSA8oooOOsSLGiRdowdY2r7RWu5OhdQLycVfWVS1aZx+-BXKPzmei70VLkvJcKhbBijKHicq3QQLiycEAA */
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
            data: ProjectWithEntryPointMetadata
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
