import { assign, createMachine } from 'xstate'
import {
  Command,
  CommandArgument,
  CommandArgumentWithName,
  KclCommandValue,
} from 'lib/commandTypes'
import { Selections } from 'lib/selections'
import { getCommandArgumentKclValuesOnly } from 'lib/commandUtils'

export const commandBarMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QGED2BbdBDAdhABAEJYBOAxMgDaqxgDaADALqKgAONAlgC6eo6sQAD0QBaAJwA6AGwAmAKwBmBoukAWafIAcDcSoA0IAJ6JZDaZIDs8hgzV6AjA61a1DWQF8PhtJlwFiciowUkYWJBAOWB4+AQiRBFF5CwdpcVkHS1lpVyU5QxNEh1lFGTUsrUUtOQd5SwZLLx8MbDwiUkkqGkgyAHk2MBwwwSiY-kEEswdJNWcNbPFLNMr5AsRFWUtJcVSdRR2VVMUmkF9WgI6u2ggyADFONv98WkowAGNufDeW-2GI0d443iiHESkktUUG1klTsSi0awQDgYWhmqkWjnUslBWhOZyegU61GuZAAghACN8-HhYH92FxAXFQAlRA5FpJ5FjFPYtNDpIpLOkEW4GNs4eJxJoGvJxOVcT82gSrj0AEpgdCoABuYC+8ogNOYI3psQmYlkGUkU2slhc6mkmUUCIyKLc4i0lkU8iUyjUHLlVIuJEkAGUwK8Pg8oDr-WQQ2HPpTzrTIkagUzEDkLHZkQK1CUtKCHAiNlsdjkVAdFEc-ed2oG8W0Xu9uD0kwDjcCEJDplUPfn+Ut7CUhXJJFo6uYbBOMtJq-jLrrnqGmy2HOE6dEGSbESoRSUHOVqpV99Zh7JR+PXPu1G7zI1vKcFwSAOJYbgACzAJAj+FIUAAruggzcLAFBvrgMBfH+JAkEBP4kP+gE4NwrYpoywiIA4qjyDIyR2LmlTSHY8LGBhyjsrm-L2No0hpHys4Kh0L7vp+36-gBQEgQAInAS4fFGiYGv8qFbjkpSWLmswMNK-LOI6UmSKouZOBo8jOPu9EBpITEfl+OCRmxiHAZIJIAO5YDEen4A8bB-twMZ-gARugPBwQhQEoRu7ZpoiyRbLm1HiJC16bLIQo7FYUrVNkKhZJ4971pp2ksZZBkcZIABqWCUJwECvhGZAQPwYCSA8GqoAA1sVGpZTlr5gCS8HsUhHljGhCTODYVissoxaWPutQInyFhctKSL8jFmwabWWmvjprGNYZsAZTVuW8HpZCfiQqCBmwlCvgAZtt6CSNV2WrfVC3uYJ66tVuqQlNsaTpKkUlCrMClqNeuibHUolTQSqoapwYAmfZTkuQmvzXcmnmpuhCB9eyOieuk1o6C4DokQjZHqKjO66C6-0dIDwOg2SBCpc10NtnDCTiqU0ICjyciyG4+RYwKpQaBmSKpE4dpE4GJMg2QqrqlqrlNch1PCR2vNSLa4rZq4eaDVyo4+jymRqJWDQ4vFj7E2AQMiwAohALmU9La4w7dHaaNhNjaBKnqsqCatqBrdTirMNiQuIgudB+bzld+DVuUhIGFTgxWlRVVUrXV4dS-qNs021iDyO9TslMoTj1LJWN6BYOsyphOhmDkcXNP603IMHoeWcni0FUVJU4GVlUnYnzbNxxdCroasMZwgWKPay0qWNYLhZ+UCIuGeyR6O47o0ZsAcG7XioN2Hl2Rxt0HbZIu0HUd3dnUne-AS1m5y+UWz7DkY7pKpsKDRoMz1MK4olO4G-3jgVAEA4CCASrWIedtvKiAWBaBgmQ6g2g0PaR00xWYSjHFPHQNFCIzk3jWRURJIAQNvlA4oFo8zWlSPUT00pVhYw9NMHWrhKwbH2GaNQgdYxNm-JDPAxCvLw1mAzTY3opJ9TqKFehqlUTMMwiUdIrNA5gMbB8IhQlh5bkWFsVwyJshYmkNYQs9DNhI2vJhFQZp+SgkDklXS+kr7wHUZA+G-UzwygUPyLB+xApFh9BaCU6hpSLGqNKDheC5yBlsfNCORlTLmTWpGaytl+G0wwhoEU7ilDWnMN4zGhRPqO0Cn1XQthVKaBsbNZK9iYlLUyhfBJKSR7OH2FYAi1oDGzFSNIIUGwZiVD0BKTCSkFCB2FiZRpIlMjgk+v2VQch0jEUKIYz+HoOSaA0IeJRO8m4OImXLTQjDYRpAFIsfckillZAUjYGipceQ6zvF4IAA */
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
            data: { [x: string]: CommandArgumentWithName<unknown> }
          },
    },
    predictableActionArguments: true,
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
          selectedCommand?.onSubmit(getCommandArgumentKclValuesOnly(event.data))
        } else {
          selectedCommand?.onSubmit()
        }
      },
      'Set current argument to first non-skippable': assign({
        currentArgument: (context) => {
          const { selectedCommand } = context
          if (!(selectedCommand && selectedCommand.args)) return undefined

          // Find the first argument that is not to be skipped:
          // that is, the first argument that is not already in the argumentsToSubmit
          // or that is not undefined, or that is not marked as "skippable".
          // TODO validate the type of the existing arguments
          let argIndex = 0
          while (argIndex < Object.keys(selectedCommand.args).length) {
            const argName = Object.keys(selectedCommand.args)[argIndex]
            const mustNotSkipArg =
              !context.argumentsToSubmit.hasOwnProperty(argName) ||
              context.argumentsToSubmit[argName] === undefined ||
              !selectedCommand.args[argName].skip
            if (mustNotSkipArg) {
              return {
                ...selectedCommand.args[argName],
                name: argName,
              }
            }
            argIndex++
          }
          // Just show the last argument if all are skippable
          // TODO: use an XState service to continue onto review step
          // if all arguments are skippable and contain values.
          const argName = Object.keys(selectedCommand.args)[argIndex - 1]
          return {
            ...selectedCommand.args[argName],
            name: argName,
          }
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
          return rest
        },
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
      'Remove current argument and set a new one': assign({
        currentArgument: (context, event) => {
          if (event.type !== 'Change current argument')
            return context.currentArgument
          return Object.values(event.data)[0]
        },
        argumentsToSubmit: (context, event) => {
          if (
            event.type !== 'Change current argument' ||
            !context.currentArgument
          )
            return context.argumentsToSubmit
          const { name, required } = context.currentArgument
          if (required)
            return {
              [name]: undefined,
              ...context.argumentsToSubmit,
            }

          const { [name]: _, ...rest } = context.argumentsToSubmit
          return rest
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
          for (const [argName, arg] of Object.entries(
            context.argumentsToSubmit
          )) {
            let argConfig = context.selectedCommand!.args![argName]

            if (
              ('defaultValue' in argConfig &&
                argConfig.defaultValue &&
                typeof arg !== typeof argConfig.defaultValue &&
                argConfig.inputType !== 'kcl') ||
              (argConfig.inputType === 'kcl' &&
                !(arg as Partial<KclCommandValue>).valueAst) ||
              ('options' in argConfig &&
                typeof arg !== typeof argConfig.options[0].value)
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
