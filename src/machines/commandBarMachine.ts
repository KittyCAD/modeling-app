import { AnyStateMachine, assign, createMachine } from 'xstate'
import { Command, CommandArgument } from 'lib/commandTypes'

export const commandBarMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QGED2BbdBDAdhABAEJYBOAxMgDaqxgDaADALqKgAONAlgC6eo6sQAD0QA2AOwAaEAE9EAFgDMAVgB0ygIyLRADmU7F8+QCZlo+QF8L0tJlwFi5AIIQCAYwzY8sRiyQgOWB4+AX8RBB0dY1VxcXlxUVEGZIZ5HSlZRA1U8XV5DSNlYw1iqKsbT3siUjIAJTB0VAA3MHwPO29fQUDg-kFwnV1VeQBOBhHjBmM4hkVxZWk5BA0C6J0NUQL9Iq2dcpBbLwdSVSoaSDIAeTYwHC7-Ht4+sLEk9SnlWOy58RLFhRU6i0un0hhMZks1gOlTw1RIqgAymBKGA3LwcFA2jCIGQkSi0ViOhB7uwuE9QqBwsZEqpRCN5AxfnSNJpIvJ-hENKpFMZjJEGIkGeIGBpxPtDlVHKdsfhaPjuBcACJwZGo7iEo4kgJkkL9BRKVSpAwqUziRTaBIcllcjYCyLmFaKHQmcUyqUS2FytUXLWPXUvBB80S0+mMjYja1sjmmLlmEoMdYaEYJCOiV1EuHSjNetE+jR+UlBcl6wODENC8OR50cwzRc2MsxmOZpYzpo6ZgDiWG4AAswCROBj8KQoABXdC3biwVROADuWGCQ8HbFH3Fxo4ARugeMOSGOJzhuL6dc9KVljIDlIpk6YktljMmOUo1AnDBH7yZeW3JScu73+4OmIjuOk7TgAalglCcBA3aAWQED8GAqiDk0qAANZIU0kHQd2YBOHuIGHseRb+meyymqoLKiMoUxOiMIzKCMigchIDCqIMOgMJ8ojGPEdKQhUGZSn+fYDkOwEHlOqgQVBMHolAZD9iQqDwmwlDdgAZip6CqFhsm4fh+6TsRvQUsIWSrOovwChMozOiyT4GIaBijCsUyfq2UIesc8L1E0nBgLO65bju7Sasw3QnmZ4SKFo3KcdSDJMSUfyZMsUy5IkrKmBM4zUt+sJSn5AVBS4BAScZEUPFFJaJGxihcWk6ziLxSbGCxzqUSULUmBMmx6AVPmqMVgV1A0zStBVRFVYWpkltkmVOh8C1OkoOgci53JOktxQsrxYpeW6JwjUFACiEA7lNR4zdqJGnuZgZmIaZipNR9mGAsaWxDotINa9UTKAy+iDZmyB9m4aGAfghmEVO8GIchOCoRhunYXJeEEZJPg3X690DL8lFOr8vGDJMKwcgxbEMgyBjpLyPUg+64OQ0OMNY4pJDKap6ncFpJA6XpOEKmzoEmcWAb0WxCTOskyiAwmHLiJxhM2fIuhJXEVhQjgqAQHAgjeXCkV3dFWQjByAC0wYpLMowXkovISIzJxnLQEDG3NAZy2ocT0T1JraJ9SzyPowwCrxIeTGaSbO-CeJqlDYX2B74tkV8wwFNkxqMfR61pZM8hh9oDKJPM0wbLHWbtjmCru9VJu1RkSw8pl9G8smIdJk7h1Cb+3aiVDV3wPXntkcleTaLFej3gxNbxDESRJNM+ScWylciQB4mY6BM7zoumLLquKekQ9yYjBPohT5oUyz2laS5OavHFIysTS+v-eb0B2+HuBaOwRix88ZZBUD9VazoWrTAavSJ8cRVC8mpLMHkgwmIjEridQBpsEC6DYsmHQIw6TT3onLCmSt2ItUTIHEOIdK5g1RCzTEIsf4YPmvEQuDVRgQOahMZiaUojBniBoY0vwjCRy1hYIAA */
    context: {
      commands: [] as Command<AnyStateMachine, unknown>[],
      selectedCommand: undefined as Command | undefined,
      currentArgument: undefined as
        | (CommandArgument<unknown> & { name: keyof Command })
        | undefined,
      argumentsToSubmit: {} as { [x: string]: unknown },
    },
    id: 'Command Bar',
    initial: 'Closed',
    states: {
      Closed: {
        on: {
          Open: {
            target: 'Selecting command',
            actions: ['Log context'],
          },
        },
      },
      'Selecting command': {
        on: {
          'Select command': {
            target: 'Command selected',
          },
        },
      },
      'Command selected': {
        always: [
          {
            target: 'Closed',
            cond: 'Command has no arguments',
            actions: ['Execute command'],
          },
          {
            target: 'Gathering arguments',
          },
        ],
        on: {
          'Deselect command': {
            target: 'Selecting command',
            actions: [
              assign({
                selectedCommand: (_c, _e) => undefined,
              }),
            ],
          },
        },
      },
      'Gathering arguments': {
        initial: 'Awaiting input',
        states: {
          'Awaiting input': {
            on: {
              'Submit argument': {
                target: 'Validating',
              },
            },
          },
          Validating: {
            invoke: {
              src: 'Validate argument',
              id: 'validateArgument',
              onDone: [
                {
                  target: '#Command Bar.Checking Arguments',
                },
              ],
              onError: [
                {
                  target: 'Awaiting input',
                },
              ],
            },
          },
        },
      },
      Review: {
        on: {
          'Submit command': {
            target: 'Closed',
            actions: ['Execute command'],
          },
          'Add argument': {
            target: 'Gathering arguments',
            actions: ['Set current argument'],
          },
          'Remove argument': {
            target: 'Review',
            actions: [
              assign({
                argumentsToSubmit: (context, event) => {
                  const argName = Object.keys(event.data)[0]
                  const { argumentsToSubmit } = context
                  const newArgumentsToSubmit = { ...argumentsToSubmit }
                  delete newArgumentsToSubmit[argName]
                  return newArgumentsToSubmit
                },
              }),
            ],
          },
          'Edit argument': {
            target: 'Gathering arguments',
            actions: ['Set current argument'],
          },
        },
      },
      'Checking Arguments': {
        invoke: {
          src: 'Validate all arguments',
          id: 'validateArguments',
          onDone: [
            {
              target: 'Review',
              cond: 'Arguments are ready',
              actions: ['Add arguments'],
            },
          ],
          onError: [
            {
              target: 'Gathering arguments',
              actions: ['Set current argument'],
            },
          ],
        },
      },
    },
    on: {
      Close: {
        target: '.Closed',
        actions: 'Clear argument data',
      },
      'Add commands': {
        target: '#Command Bar',
        actions: [
          assign({
            commands: (context, event) =>
              [...context.commands, ...event.data.commands].sort(sortCommands),
          }),
        ],
      },
      'Remove commands': {
        target: '#Command Bar',
        actions: [
          assign({
            commands: (context, event) =>
              context.commands.filter(
                (c) =>
                  !event.data.commands.some(
                    (c2) => c2.name === c.name && c2.owner === c.owner
                  )
              ),
          }),
        ],
      },
    },
    schema: {
      events: {} as
        | { type: 'Open' }
        | { type: 'Close' }
        | {
            type: 'Select command'
            data: { command: Command }
          }
        | { type: 'Deselect command' }
        | { type: 'Submit command'; data: Command['args'] }
        | {
            type: 'Add argument'
            data: { argument: CommandArgument<unknown> }
          }
        | {
            type: 'Remove argument'
            data: { [x: string]: CommandArgument<unknown> }
          }
        | {
            type: 'Edit argument'
            data: { argument: CommandArgument<unknown> }
          }
        | {
            type: 'Add commands'
            data: { commands: Command[] }
          }
        | {
            type: 'Remove commands'
            data: { commands: Command[] }
          }
        | { type: 'Submit argument'; data: { [x: string]: unknown } },
    },
    predictableActionArguments: true,
    preserveActionOrder: true,
  },
  {
    actions: {
      'Set current argument': (context, event) => {},
      'Clear argument data': assign({
        selectedCommand: undefined,
        currentArgument: undefined,
        argumentsToSubmit: {},
      }),
      'Log context': (context, event) => console.log(event.type, context),
    },
    delays: {},
  }
)

function sortCommands(a: Command, b: Command) {
  if (b.ownerMachine === 'auth') return -1
  if (a.ownerMachine === 'auth') return 1
  return a.name.localeCompare(b.name)
}
