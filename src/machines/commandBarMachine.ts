import { assign, createMachine } from 'xstate'
import {
  Command,
  CommandArgument,
  CommandArgumentWithName,
} from 'lib/commandTypes'
import { Selections } from 'lib/selections'

export const commandBarMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QGED2BbdBDAdhABAEJYBOAxMgDaqxgDaADALqKgAONAlgC6eo6sQAD0QBaAJwA6AGwAmAKwBmBoukAWafIAcDcSoA0IAJ6JZDaZIDs8hgzV6AjA61a1DWQF8PhtJlwFiciowUkYWJBAOWB4+AQiRBFF5CwdpcVkHS1lpVyU5QxNEh1lFGTUsrUUtOQd5SwZLLx8MbDwiUkkqGkgyAHk2MBwwwSiY-kEEswdJNWcNbPFLNMr5AsRFWUtJcVSdRR2VVMUmkF9WgI6u2ggyADFONv98WkowAGNufDeW-2GI0d443iiHESkktUUG1klTsSi0awQDgYWhmqkWjnUslBWhOZyegU61GuZAAghACN8-HhYH92FxAXFQAlRA5FpJ5FjFPYtNDpIpLOkEW4GNs4eJxJoGvJxOVcT82gSrj0AEpgdCoABuYC+8ogNOYI3psQmYlkGUkU2slhc6mkmUUCIyKLc4i0lkU8iUyjUHLlVIuJEkAGUwK8Pg8oDr-WQQ2HPpTzrTIkagUzEDkLHZkQK1CUtKCHAiNlsdjkVAdFEc-ed2oG8W0Xu9uD0ACJwUNNqOJg3-FOM4TpypWXOzBjS-nOR1jySqXNODTyZwONTV-GXXXPDsfHpJgHG4EISHTKoe-P8pb2EpCuSSLR1cw2B8ZaSrhXr-2buM7hzhOnRBkmoiKgiiUy7WjklblKsxiIPMt73q4y5qG65iNN4pwbgSADiWDcAAFmAJARvgpBQAAruggzcLAkgkgA7lgMQ4JGDxsGR3AxmRABG6A8CRJDkZRODcLufaAcuKi3lUfKpEiyFqA6MEIOUKIOB68i5rYEouCu6H1gGkg4fhhHEaRFFUTRABqWCUJwEC4RGZAQPwYCSA8GqoAA1q5Go2XZuFgCSAnmcJon-vuaaIpY5QzGaMrZDoY7LgiMkzu6NibIuWTHHpmEdEZBFEcx-GCRZkjWbZ9m8MxZCESQqCBmwlC4QAZg16CSL5lUBUFpWhT2f5jP2CTLtIIpVAlVQ6JoWRCpsVhZEsGU2Lkr4GaqGqcGAdGcTxfEJr8A3JuFqYDggljTNoY7SpsLjIpUCLuiK6jpPUyi6C6a21pIG1bTtZIEGZQkiUde6nQk4qlNCAo8nIshuPkSkCqUGgZkismyV9BK-dtZCquqWolSFIO-sdQ3iQwrJlGkehuq4eYpVyt4+jymQKUi1pYx0OM7QAohAfFA1RYXkwemjyOyY75uLrKgozajM3U4qzDYkLiFzdYEW8nnEb1xOwE5LluTgHneZ1flVYFwXA-qpNg8NiAaZdY4lMoTj1JOSl6BYCkympOhmDkni5R+ipazrxV6zbhs4K57leT5Fs9dbFl0D+honQ7CBYtsdqgos1guBp5QIi4sjsmktibKocgChrnTh7rKfCQbdUNZITWte15vdc2Uep6DYkHmBWz7Dkd7pIusIpRoMz1MK4olO46shzW2G4YVpnN9RFB4bgMBfGRJAkFRRPAyLAHD6oEuaGNai5pUd-wkpakihpJTRdi0hpHyXjoTgqAIBwEEPpWsGdRaRVEAsC0lMrQ2g0PaR00x5zmB9HYSo1QSj1yVBAcBl9IHFAtHma0qR6iemlNBQoHppgKVcJWDY+wzS6WaKHDosYmzEQOngPBEUzqzChtXLMdRaizSUtQ1EdC1IlHSPDbBG5Gzblwb2TOgFF4WmyvyZQd1tCOnUHPCa9h3B2HdPXAqJlipCxbjw8GiBihVBkEodIGgtDLkXI6VwVgKH7DHJoJcpiN7mMjJY6itEGJMRYjgNi3BrFZ2KGydS71kRmGSGoIUGxJDuFSN-F6lRNj+OMkVIJ28rJJ2qlAGJ4lpBLHBBKe+H0C78iFM4bYThqh5GrtFZhGFWGBh5hUsWmRwT33PDXLE0JHqLn0Z6bIGkMw4lXmuTW7wI6Rn7lY5RECzqpEmW4H0aQBSLGXLIR6WQZw2G-r7HkCk0IsLXvlAJhSz5lVjnRZ43AAr4AcP0yKxRqgOMYc41xhYlIchFNUWpLi0hcn2H-DwQA */
    context: {
      commands: [] as Command[],
      selectedCommand: undefined as Command | undefined,
      currentArgument: undefined as
        | (CommandArgument<unknown> & { name: string })
        | undefined,
      selectionRanges: {
        otherSelections: [],
        codeBasedSelections: [],
      } as Selections,
      argumentsToSubmit: {} as { [x: string]: unknown },
    },
    id: 'Command Bar',
    initial: 'Closed',
    states: {
      Closed: {
        on: {
          Open: {
            target: 'Selecting command',
          },

          'Find and select command': {
            target: 'Command selected',
            actions: [
              'Find and select command',
              'Initialize arguments to submit',
            ],
          },

          'Add commands': {
            target: 'Closed',

            actions: [
              assign({
                commands: (context, event) =>
                  [...context.commands, ...event.data.commands].sort(
                    sortCommands
                  ),
              }),
            ],

            internal: true,
          },

          'Remove commands': {
            target: 'Closed',

            actions: [
              assign({
                commands: (context, event) =>
                  context.commands.filter(
                    (c) =>
                      !event.data.commands.some(
                        (c2) =>
                          c2.name === c.name &&
                          c2.ownerMachine === c.ownerMachine
                      )
                  ),
              }),
            ],

            internal: true,
          },
        },
      },

      'Selecting command': {
        on: {
          'Select command': {
            target: 'Command selected',
            actions: ['Set selected command', 'Initialize arguments to submit'],
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
            actions: [
              assign({
                currentArgument: (context, event) => {
                  const { selectedCommand } = context
                  if (!(selectedCommand && selectedCommand.args))
                    return undefined
                  const argName = Object.keys(selectedCommand.args)[0]
                  return {
                    ...selectedCommand.args[argName],
                    name: argName,
                  }
                },
              }),
            ],
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
              onDone: {
                target: '#Command Bar.Checking Arguments',
                actions: [
                  assign({
                    argumentsToSubmit: (context, event) => {
                      const [argName, argData] = Object.entries(event.data)[0]
                      const { currentArgument } = context
                      if (!currentArgument) return {}
                      return {
                        ...context.argumentsToSubmit,
                        [argName]: argData,
                      }
                    },
                  }),
                ],
              },
              onError: [
                {
                  target: 'Awaiting input',
                },
              ],
            },
          },

          'new state 1': {},
        },

        initial: 'Awaiting input',

        on: {
          'Change current argument': {
            target: 'Gathering arguments',
            internal: true,
            actions: ['Set current argument'],
          },
        },
      },

      Review: {
        entry: ['Clear current argument'],
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
                  newArgumentsToSubmit[argName] = undefined
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
              cond: 'Command needs review',
            },
            {
              target: 'Closed',
              actions: 'Execute command',
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
      },

      Clear: {
        target: '#Command Bar',
        internal: true,
        actions: ['Clear argument data'],
      },
    },
    schema: {
      events: {} as
        | { type: 'Open' }
        | { type: 'Close' }
        | { type: 'Clear' }
        | {
            type: 'Select command'
            data: { command: Command }
          }
        | { type: 'Deselect command' }
        | { type: 'Submit command'; data: { [x: string]: unknown } }
        | {
            type: 'Add argument'
            data: { argument: CommandArgumentWithName<unknown> }
          }
        | {
            type: 'Remove argument'
            data: { [x: string]: CommandArgumentWithName<unknown> }
          }
        | {
            type: 'Edit argument'
            data: { arg: CommandArgumentWithName<unknown> }
          }
        | {
            type: 'Add commands'
            data: { commands: Command[] }
          }
        | {
            type: 'Remove commands'
            data: { commands: Command[] }
          }
        | { type: 'Submit argument'; data: { [x: string]: unknown } }
        | {
            type: 'done.invoke.validateArguments'
            data: { [x: string]: unknown }
          }
        | {
            type: 'error.platform.validateArguments'
            data: { message: string; arg: CommandArgumentWithName<unknown> }
          }
        | {
            type: 'Find and select command'
            data: { name: string; ownerMachine: string }
          }
        | {
            type: 'Change current argument'
            data: { arg: CommandArgumentWithName<unknown> }
          },
    },
    predictableActionArguments: true,
    preserveActionOrder: true,
  },
  {
    actions: {
      'Execute command': (context, event) => {
        console.log('Executing command', context, event.type)
        if (
          event.type !== 'Submit command' &&
          event.type !== 'done.invoke.validateArguments'
        )
          return
        const { selectedCommand } = context
        if (!selectedCommand) return
        if (selectedCommand.args) {
          selectedCommand.onSubmit(event.data)
        } else {
          selectedCommand.onSubmit()
        }
      },
      'Clear current argument': assign({
        currentArgument: undefined,
      }),
      'Set current argument': assign({
        currentArgument: (context, event) => {
          switch (event.type) {
            case 'error.platform.validateArguments':
              return event.data.arg
            case 'Edit argument':
              return event.data.arg
            case 'Change current argument':
              return event.data.arg
            default:
              return context.currentArgument
          }
        },
      }),
      'Clear argument data': assign({
        selectedCommand: undefined,
        currentArgument: undefined,
        argumentsToSubmit: {},
      }),
      'Set selected command': assign({
        selectedCommand: (c, e) =>
          e.type === 'Select command' ? e.data.command : c.selectedCommand,
      }),
      'Find and select command': assign({
        selectedCommand: (c, e) => {
          if (e.type !== 'Find and select command') return c.selectedCommand
          const found = c.commands.find(
            (cmd) =>
              cmd.name == e.data.name && cmd.ownerMachine == e.data.ownerMachine
          )

          return !!found ? found : c.selectedCommand
        },
      }),
      'Initialize arguments to submit': assign({
        argumentsToSubmit: (c, e) => {
          if (
            e.type !== 'Select command' &&
            e.type !== 'Find and select command'
          )
            return c.argumentsToSubmit
          const command =
            'command' in e.data ? e.data.command : c.selectedCommand!
          if (!command.args) return {}
          const args: { [x: string]: unknown } = {}
          for (const [argName, arg] of Object.entries(command.args)) {
            args[argName] = arg.payload
          }
          return args
        },
      }),
    },
    guards: {
      'Command needs review': (context, _) =>
        context.selectedCommand?.needsReview || false,
    },
    services: {
      'Validate argument': (context, event) => {
        if (event.type !== 'Submit argument') return Promise.reject()
        return new Promise((resolve, reject) => {
          // TODO: figure out if we should validate argument data here or in the form itself,
          // and if we should support people configuring a argument's validation function

          resolve(event.data)
        })
      },
      'Validate all arguments': (context, _) => {
        return new Promise((resolve, reject) => {
          console.log(
            'validating context.argumentsToSubmit',
            context.argumentsToSubmit
          )
          for (const [argName, arg] of Object.entries(
            context.argumentsToSubmit
          )) {
            let argConfig = context.selectedCommand!.args![argName]

            console.log({ argName, arg, argConfig })
            if (
              typeof arg !== typeof argConfig.payload &&
              typeof arg !== typeof argConfig.defaultValue &&
              'options' in argConfig &&
              typeof arg !== typeof argConfig.options[0].value
            ) {
              return reject({
                message: 'Argument payload is of the wrong type',
                arg: {
                  ...argConfig,
                  name: argName,
                },
              })
            }

            if (!arg && argConfig.required) {
              return reject({
                message: 'Argument payload is falsy but is required',
                arg: {
                  ...argConfig,
                  name: argName,
                },
              })
            }
          }

          console.log('...and we are good to go')

          return resolve(context.argumentsToSubmit)
        })
      },
    },
    delays: {},
  }
)

function sortCommands(a: Command, b: Command) {
  if (b.ownerMachine === 'auth') return -1
  if (a.ownerMachine === 'auth') return 1
  return a.name.localeCompare(b.name)
}
