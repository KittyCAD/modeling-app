import { assign, createMachine } from 'xstate'
import {
  Command,
  CommandArgument,
  CommandArgumentWithName,
} from 'lib/commandTypes'
import { Selections } from 'lib/selections'

export const commandBarMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QGED2BbdBDAdhABAEJYBOAxMgDaqxgDaADALqKgAONAlgC6eo6sQAD0QBaAJwA6AGwAmAKwBmBoukAWafIAcDcSoA0IAJ6JZDaZIDs8hgzV6AjA61a1DWQF8PhtJlwFiciowUkYWJBAOWB4+AQiRBFF5CwdpcVkHS1lpVyU5QxNEh1lFGTUsrUUtOQd5SwZLLx8MbDwiUkkqGkgyAHk2MBwwwSiY-kEEswdJNWcNbPFLNMr5AsRFWUtJcVSdRR2VVMUmkF9WgI6u2ggyADFONv98WkowAGNufDeW-2GI0d443iiHESkktUUG1klTsSi0awQDgYWhmqkWjnUslBWhOZyegU61GuZAAghACN8-HhYH92FxAXFQAlRA5FpJ5FjFPYtNDpIpLOkEW4GNs4eJxJoGvJxOVcT82gSrj0AEpgdCoABuYC+8ogNOYI3psQmYlkGUkU2slhc6mkmUUCIyKLc4i0lkU8iUyjUHLlVIuJEkAGUwK8Pg8oDr-WQQ2HPpTzrTIkagUzEDkLHZkQK1CUtKCHAiNlsdjkVAdFEc-ed2oGAOJYbgACzAJAj+FIUAAruhBtxYGQACJwUPveO6pMA43AhA5UqWXOzBjS-nOR3LySqXNODTyZwONTV-GXXXPUcfHqTlOM4TrSublb5-lLewlIVySRaOrmGw-jLSI8FRPf0zzjS8HHCOlogZE1ERUEUSgPa05yQ1ZjEQeZP2-VwDzUN1zEabxTlPAkG2bVt207Hs+wHZAm1wGAvi7EgSD7DsSG7XscG4K9oOnNNEVUeQZGSOxc0qaQ7HhdDBJFeRc35extGkNI+UAgNJDIls2xwSMqK4-tJBJAB3LAYl0-AHjYLtuBjLsACN0B4djOL7XixhvBIDxUT8qj5VIkTwtQHRk8oUQcD15LMXQclcdTa00xttMojjqO42BJAANSwShOAgRsIzICB+DASQHg1VAAGtSo1HK8sbMASVSgz3JgmdMnKGYzRlbIdGXA8EX8zd3RsTY9yyY4iLxID6ySiiLP0misrq-LeF0shWxIVBAzYShGwAM229BJFq3LVsa5q3INf5r1gg9JIfXqqh0TQsiFTYrCyJZRpsXJ4oJVUNU4MBjLsxznITX5rqgjzYMsaZtGXaVNhcZFKgRd0RXUdJ6mUXQXX+jpAeB0GyQIRbuNa-jbwQcVSmhAUeTkWQ3HyGSBVKDQMyRAKAsJwNiZBshVXVLUXLSnjoeTPjUxpnmpFtcVs1cPNBq5T8fR5DrKwaHEppIomwCBoWAFEIGcinJcg6XYZnTRhJsbQJU9VlQTVtQNbqcVZhsSFxH5zoWzeSr2ya1z0qKkqypwCrqpOlaGrDiX9WtqdZYSeSEeXEplCceo1xkvQLGCmUIp0Mwck8fWQMVIOQ4spODIHYqcFK8qqpqhPuAu8P+zoCDDRlzzTCkCVWWlSxrBceTygRFxZHZNJbE2VQ5AFAO6PeevI0bmiNpY7bJF2g6jvjs7E8u9KqfTxAkK2fZYuRvdYUGjQZnqYVxRKdx-ZOHBUAgHAQQ00AyD1tgJUQCwLQMEyHUG0Gh7SOmmDuGB6gOTyVBMkDeRJIBgLahA4oFo8zWlSPUT00o0KFA9NMYKrhKwbH2GaQ81cawEljGOdskM8B4OpgkWY9MV5ZjqLUN6MlqGojoRFEo6QWYb1PC8McuCbpD1gosLYrhkTZCxNIawhYxEfW0HhCKKgzT8lBAHLS809KX37Dwm+iIWZSEinjTRy51BFnvNofM7hGZfgXBYuaOlrG9wyiZMya1IxWRsnY4eDi2TONsK45IaghQbEkO4VIKlsaVE2AE8iQTxZN2WufCJMS7o6JSBKNQLp7CT35EKZw2wnDVDyCvBczDmg10NsbYyZS7aZHBNU58q8sTQgxnud+kVsjyQzHrTprDLh11DjY+AyjwFy00DQ2EaQBSLAPLIDGWRNw2BUiXHkwVCJeCAA */
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
        },

        initial: 'Awaiting input',

        on: {
          'Change current argument': {
            target: 'Gathering arguments',
            internal: true,
            actions: ['Set current argument'],
          },

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
              cmd.name === e.data.name &&
              cmd.ownerMachine === e.data.ownerMachine
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
          for (const [argName, arg] of Object.entries(
            context.argumentsToSubmit
          )) {
            let argConfig = context.selectedCommand!.args![argName]

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
