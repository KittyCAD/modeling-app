import { assign, createMachine } from 'xstate'
import {
  Command,
  CommandArgument,
  CommandArgumentWithName,
  KclCommandValue,
} from 'lib/commandTypes'
import { Selections } from 'lib/selections'
import { getCommandArgumentKclValuesOnly } from 'lib/commandUtils'

export type CommandBarContext = {
  commands: Command[]
  selectedCommand?: Command
  currentArgument?: CommandArgument<unknown> & { name: string }
  selectionRanges: Selections
  argumentsToSubmit: { [x: string]: unknown }
}

export const commandBarMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QGED2BbdBDAdhABAEJYBOAxMgDaqxgDaADALqKgAONAlgC6eo6sQAD0QBaAJwA6AGwAmAKwBmBoukAWafIAcDcSoA0IAJ6JZDaZIDs8hgzV6AjA61a1DWQF8PhtJlwFiciowUkYWJBAOWB4+AQiRBFF5CwdpcVkHS1lpVyU5QxNEh1lFGTUsrUUtOQd5SwZLLx8MbDwiUkkqGkgyAHk2MBwwwSiY-kEEswZJbPltM0U3eXLZAsRFeQcrerUHRbTFvfkmkF9WgI6u2ggyADFONv98WkowAGNufDeW-2GI0d443iiHESkktUUilkskqdiUWjWCAcDC0kjUqnElkc6lkoK0JzOT0CnWo1zIAEEIARvn48LA-uwuIC4qAEqIHJjJPJcYtxFoYdJFFjVsZEG5pqCquJxJoGvJxOUCT82sSrj0AEpgdCoABuYC+yog9OYIyZsQmYmhWzMmTqLnU0kyikRGVRbj5lg2SmUam5StpFxIkgAymBXh8HlADQGyKHw58aecGZEzUDWYgchY7CisWoSlpQQ5EVDLJJxKkdIpyypUop-ed2kHCW0Xu9uD1kwDzcCEJCtlUNgWhZZ1OlnaKEBpZJItHVzDZ5xlpPWiZdDc8w22Ow5wozosyLUiVNMSg5ytVKmfrIipzO564z2otPVpI1vKd18SAOJYbgACzAEhI3wUgoAAV3QQZuFgCg-1wGAvjAkgSCgkCSHAyCcG4TtUxZYRED2TQZGSOw80qaQ7ARCc9mmZYSksextGkNJBRXFUOh-f9AOA0CIKgmCABE4E3D5oyTE1-lww8clKBjZF2Bh5SFZwXUUyRVDzJwNE2LQzzYwNJE4gCgJwKNeMw6DJHJAB3LAYlM-AHjYMDuFjMCACN0B4NCMKgnD927dMkWSUs8yY8RISfWQshvcsrDlapshULJPHfZsDKM7iHPM-jJAANSwShOAgX9IzICB+DASQHh1VAAGsqp1Qrit-MByXQvisP8sY8ISZwbCsDllBLSwz1qRFBQsRZ5WRIVkui-TG0M39jJ4jqLNgfLmpK3hTLIQCSFQIM2EoX8ADMjvQSQmqKna2vWvyJL3HrD1SEoyzSdJUkUm9dnUtQn10aK6hkxbiU1HVODAay3M87zE1+J6UwCtN8IQUauR0OZ0ksFwUUqRFPWmUdouPXR3TBjoIahmHKQIHKuqRrtUYSaVShhLF+TkeTzBFQosVKDRM2RVInEdSmg2p6GyE1bU9R8zrsKZqSexFqQHWlHNXHzCbFhnX1+UydFkVxiXJClmGAFEIG8hmld3ZGXp7TR5C5RSCxdjlQV1tR9bqaVdhsSFxDN5AALeOrgPa3ysJgiqcCqmr6sa7bWujxXjQd5nesQZYthsblIQYJx6hUic9AsdEFT2HQzByVLmgDJaw-eSOHPTjbysq6qcFqhrrtT9sO-4ugd1NFGc4QXEPo5eVLGsFxlnKREXGnZI9HcT1mOikO0s-S5w7bqNh9j-bkKOyQTvOy6B9utOHtj7qD1V8pSyrHJZ3STY4QmjQ0R2Ww0oSjuF3u+HAqAIBwEEOlRs48nZBVENkKQNprC42qBoJ0LothaXMJ9aElRXDLj3k3VUpJIBwOfgg4oMx8y41SPUOY8p5DFk2GiKoxsoRVmhGoM2cY2zAQRngChgU0a7HZtFH0ilRp1D5usVh6JXCKD2CUdI8lQ7rlbB8chkkJ6HkxFsBeulbQZAUCwrYCiqzIhyE+fqZtMomTMg-aCwiWYEV2NOBUCghQ6EFGzYsvpwQUT5MxawFECx2JWllRxMdLI2TsrtKMTkXIuMnmeCiZYwrePMFWCKv1XZKVGroWwmxNARK4g4hWG0tp3wSSk16lQpC41ULjV8uxUjSBvFCNEDTdCOkWCY44xCGzgzAJDaGdTnaZHBADYcqg5DpCovzeRno5izA0BeUOh8o5OPgDo+BaNvqV0xNFaE7gdYTnnvkmUChdKEMyF4LwQA */
    predictableActionArguments: true,
    tsTypes: {} as import('./commandBarMachine.typegen').Typegen0,
    context: {
      commands: [],
      selectedCommand: undefined,
      currentArgument: undefined,
      selectionRanges: {
        otherSelections: [],
        codeBasedSelections: [],
      },
      argumentsToSubmit: {},
    } as CommandBarContext,
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
            actions: ['Set current argument to first non-skippable'],
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
                actions: [assign({
                  argumentsToSubmit: (context, event) => {
                    const [argName, argData] = Object.entries(event.data)[0]
                    const { currentArgument } = context
                    if (!currentArgument) return {}
                    return {
                      ...context.argumentsToSubmit,
                      [argName]: argData,
                    }
                  },
                })],
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
            actions: ['Remove current argument and set a new one'],
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
            actions: ['Remove argument'],
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
              actions: ['Set current argument to first non-skippable'],
            },
          ],
        }
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
            data: { [x: string]: CommandArgumentWithName<unknown> }
          },
    },
    preserveActionOrder: true,
  },
  {
    actions: {
      'Execute command': (context, event) => {
        const { selectedCommand } = context
        if (!selectedCommand) return
        if (
          (selectedCommand?.args && event.type === 'Submit command') ||
          event.type === 'done.invoke.validateArguments'
        ) {
          const resolvedArgs = {} as { [x: string]: unknown }
          for (const [argName, argValue] of Object.entries(getCommandArgumentKclValuesOnly(event.data))) {
            resolvedArgs[argName] =
              typeof argValue === 'function' ? argValue(context) : argValue
          }
          selectedCommand?.onSubmit(resolvedArgs)
        } else {
          selectedCommand?.onSubmit()
        }
      },
      'Set current argument to first non-skippable': assign({
        currentArgument: (context, event) => {
          const { selectedCommand } = context
          if (!(selectedCommand && selectedCommand.args)) return undefined
          const rejectedArg = 'data' in event && event.data.arg


          // Find the first argument that is not to be skipped:
          // that is, the first argument that is not already in the argumentsToSubmit
          // or that is not undefined, or that is not marked as "skippable".
          // TODO validate the type of the existing arguments
          let argIndex = 0

          while (argIndex < Object.keys(selectedCommand.args).length) {
            const [argName, argConfig] = Object.entries(selectedCommand.args)[
              argIndex
            ]
            const argIsRequired =
              typeof argConfig.required === 'function'
                ? argConfig.required(context)
                : argConfig.required
            const mustNotSkipArg =
              argIsRequired &&
              ((!context.argumentsToSubmit.hasOwnProperty(argName) ||
                context.argumentsToSubmit[argName] === undefined) ||
                (rejectedArg && rejectedArg.name === argName))

            console.log('mustNotSkipArg? ', {
              mustNotSkipArg,
              argName,
              argConfig,
            })

            if (mustNotSkipArg === true) {
              console.log('I guess we must not skip this arg', argName)
              return {
                ...selectedCommand.args[argName],
                name: argName,
              }
            }
            argIndex++
          }

          // TODO: use an XState service to continue onto review step
          // if all arguments are skippable and contain values.
          return undefined
        },
      }),
      'Clear current argument': assign({
        currentArgument: undefined,
      }),
      'Remove argument': assign({
        argumentsToSubmit: (context, event) => {
          if (event.type !== 'Remove argument') return context.argumentsToSubmit
          const argToRemove = Object.values(event.data)[0]
          // Extract all but the argument to remove and return it
          const { [argToRemove.name]: _, ...rest } = context.argumentsToSubmit
          console.log({
            argToRemove,
            rest,
            argumentsToSubmit: context.argumentsToSubmit,
          })
          return rest
        },
      }),
      'Set current argument': assign({
        currentArgument: (context, event) => {
          switch (event.type) {
            case 'Edit argument':
              return event.data.arg
            default:
              return context.currentArgument
          }
        },
      }),
      'Remove current argument and set a new one': assign({
        argumentsToSubmit: (context, event) => {
          if (
            event.type !== 'Change current argument' ||
            !context.currentArgument
          )
            return context.argumentsToSubmit
          const { name } = context.currentArgument

          const { [name]: _, ...rest } = context.argumentsToSubmit
          return rest
        },
        currentArgument: (context, event) => {
          if (event.type !== 'Change current argument')
            return context.currentArgument
          return Object.values(event.data)[0]
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
          const command =
            'command' in e.data ? e.data.command : c.selectedCommand!
          if (!command.args) return {}
          const args: { [x: string]: unknown } = {}
          for (const [argName, arg] of Object.entries(command.args)) {
            args[argName] =
              arg.skip && 'defaultValue' in arg ? arg.defaultValue : undefined
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
          for (const [argName, argConfig] of Object.entries(
            context.selectedCommand!.args!
          )) {
            let arg = context.argumentsToSubmit[argName]
            let argValue = typeof arg === 'function' ? arg(context) : arg

            try {
              const isRequired =
                typeof argConfig.required === 'function'
                  ? argConfig.required(context)
                  : argConfig.required

              const resolvedDefaultValue =
                'defaultValue' in argConfig
                  ? typeof argConfig.defaultValue === 'function'
                    ? argConfig.defaultValue(context)
                    : argConfig.defaultValue
                  : undefined

              console.log({
                argValue,
                resolvedDefaultValue,
              })

              const hasMismatchedDefaultValueType =
                isRequired &&
                typeof argValue !== typeof resolvedDefaultValue &&
                !(argConfig.inputType === 'kcl' || argConfig.skip)
              const hasInvalidKclValue =
                argConfig.inputType === 'kcl' &&
                !(argValue as Partial<KclCommandValue> | undefined)?.valueAst
              const hasInvalidOptionsValue = isRequired &&
                'options' in argConfig &&
                  !(typeof argConfig.options === 'function'
                    ? argConfig.options(context)
                    : argConfig.options).some(o => o.value === argValue)

              if (
                hasMismatchedDefaultValueType ||
                hasInvalidKclValue ||
                hasInvalidOptionsValue
              ) {
                console.error('Argument payload is of the wrong type', {
                  argValue,
                  resolvedDefaultValue,
                  argConfig,
                })
                return reject({
                  message: 'Argument payload is of the wrong type',
                  arg: {
                    ...argConfig,
                    name: argName,
                  },
                })
              }

              if (!argValue && isRequired) {
                console.error('Argument payload is falsy but is required', {
                  argValue,
                  argConfig,
                })
                return reject({
                  message: 'Argument payload is falsy but is required',
                  arg: {
                    ...argConfig,
                    name: argName,
                  },
                })
              }
            } catch (e) {
              console.error('Error validating argument', context, e)
              throw e
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