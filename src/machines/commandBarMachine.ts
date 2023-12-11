import { AnyStateMachine, assign, createMachine } from 'xstate'
import {
  Command,
  CommandArgument,
  CommandArgumentWithName,
} from 'lib/commandTypes'

export const commandBarMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QGED2BbdBDAdhABAEJYBOAxMgDaqxgDaADALqKgAONAlgC6eo6sQAD0QB2UQBoQAT0QBGAJwAmACwA6BSpUMFDFQA4FCgGwBWJQF8LUtJlwFi5AIIQCAYwzY8sRiyQgOWB4+AX8RBAU5UTVjY1ElE1E5U1MAZj0pWQQ5S2sQWy8HUjIAJTB0VAA3MHwPO29fQUDg-kFw3VS1VP1UlVMGU31RUwVTSRlEJTkGJTU9FSV4+ITjVNSrG097ImKqMFJG-2beVrDEXWM1UQZr1PEzfWM5VMzJhgZL0WNR-UVu-R6og2+S2eB2JDUVBokDIAHk2GAcId2FwTqFQOFkuodEpFv1ripjKpXtkiQorlN9EoiasBiogXkCttHGoAMpgShgNy8HBQWqgiBkdmc7n8+oQZEBVEhNqTSJqQYKfSmVapYwfBTjLJRS4jYaa9WGPoA4FMsEss0EWgi7gwgAicA5XO4YsKkuOMrOCFECzUWm0qgSSg1xhJzx6aiU+i0ilUchUo1ym3F4MhAvw1udMPd0tOGMmvwVhmVqvV3y1iEJsyGSjWayi3QY8dN6Yt6cz3Ozcj8KKCaNl2WSV1SI0WDEBKhHphJpmeMVSkUMpgMDBHLZTLIA4lhuAALMAkTi8-CkKAAV3QiO4sDUTgA7lhgsej2wz9whWeAEboHgnkjny8cG4HM+09fMEGMQtjAWJsclxEcbhJcRTAVTQVX+FUxgZZNClTbc9wPI8+VPC8rxvAA1LBKE4CAdyIsgIH4MA1CPSpUAAa2YyoqJoncwCcf9SKAkCWnRYR5HpdRribZQ9CiPQlBJb5PiWbpYhUORfhUddcK3Hd90PY8SMA681Eo6jaJ5KAyAPEhUAhNhKB3AAzez0DUbiLL4gSAKvET+y9SC5BiGC5Dg2t8SQqMrluEZCSbFIdOZUg1DKSpODAO8P2-X86jdZgmlzMTwgAWnjFDIi+X4G1Ebow00-Q1CGNJqR9X5ViS80UrSjKspcAhjL8gqjiKgdFkuAYRgUNUAUnEYXgmCDRkjeIwq0AYqrkTqighHrMtKcoqhqQbhOG3tRIHAwULkaC9FkmlaqU9I-RmsxeiSZJ1kZVturAdL9oAUQgX8TuAs6pVAvNxIQca5hSIwZujEdpqQ3QFUJfQBk0pV6QUbbU2Qfc3HYoj8B8oTrwYpiWJwNjOI8njLP4wSTJ8cGPSh8IxgYLoEgBHJxC0QYSSMS5uiUNIl002d8YtImSePcnWapnBmNYjiuMZ7yWbIuhu0KyHivOURyVnIl4z6VJgy0MMo06G7ehg9IE26WWUsJrkFb5JWyJskg7IcpzuFckh3M83jbR9oC2Z7CGLq9B3Zl6SrJKrNYSQXaIkliEdHjg6MrDyHBUAgOBBEtcEDfj8CSvSclscz2Jl36OQSUMFaMfVabCSVUw3YhKFaAgKuAprsKUNER5YmVEcnn6BQwxGFDgzC6Y1UgoY8e+jcUuFZ1Sby+wR7A6G4miR4xnSVRxCpCtsmXckEyGZSNOucx+7TFMO1tYeRsNgc4gkmDDzKIYVoJrF+KuJUH98IGVJqDeAf9q7Q3pDzJ4VYfS1mGDOZUVwxg5CpGFH0k8YH6UIkZHW0dbwPifHyF8b5j6c0QLORq6CiSYLuNORatVOgyWpNMaMHQvo4WShCWB5DiKUNMuZCORFGFGwQIYaIfQxiQQSPGOIiluGKA0DoPompNSY30B-Pad55EDhKvwtQDcDRmD6E2NugwVpNg0pSBcygP4e2JqTKO15zEJ1nNiYsGFJygJFu8SM6oxhPw0h8L6VggA */
    context: {
      commands: [] as Command[],
      selectedCommand: undefined as Command | undefined,
      currentArgument: undefined as
        | (CommandArgument<unknown> & { name: string })
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
            actions: [
              assign({
                selectedCommand: (_c, e) => e.data.command,
                argumentsToSubmit: (_c, e) => {
                  const { command } = e.data
                  if (!command.args) return {}
                  const args: { [x: string]: unknown } = {}
                  for (const [argName, arg] of Object.entries(command.args)) {
                    args[argName] = arg.payload
                  }
                  return args
                },
              }),
            ],
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
        entry: ['Log context'],
      },
      'Gathering arguments': {
        initial: 'Awaiting input',
        entry: ['Log context'],
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
                    (c2) =>
                      c2.name === c.name && c2.ownerMachine === c.ownerMachine
                  )
              ),
          }),
        ],
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
      'Log context': (context, event) => console.log(event.type, context),
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
