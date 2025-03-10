import { assign, createActor, fromPromise, setup, SnapshotFrom } from 'xstate'
import {
  Command,
  CommandArgument,
  CommandArgumentWithName,
  KclCommandValue,
} from 'lib/commandTypes'
import { getCommandArgumentKclValuesOnly } from 'lib/commandUtils'
import { MachineManager } from 'components/MachineManagerProvider'
import toast from 'react-hot-toast'
import { useSelector } from '@xstate/react'
import { authCommands } from 'lib/commandBarConfigs/authCommandConfig'

export type CommandBarContext = {
  commands: Command[]
  selectedCommand?: Command
  currentArgument?: CommandArgument<unknown> & { name: string }
  argumentsToSubmit: { [x: string]: unknown }
  machineManager: MachineManager
}

export type CommandBarMachineEvent =
  | { type: 'Open' }
  | { type: 'Close' }
  | { type: 'Clear' }
  | {
      type: 'Select command'
      data: { command: Command; argDefaultValues?: { [x: string]: unknown } }
    }
  | { type: 'Deselect command' }
  | { type: 'Submit command'; output: { [x: string]: unknown } }
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
      type: 'xstate.done.actor.validateSingleArgument'
      output: { [x: string]: unknown }
    }
  | {
      type: 'xstate.done.actor.validateArguments'
      output: { [x: string]: unknown }
    }
  | {
      type: 'xstate.error.actor.validateArguments'
      error: { message: string; arg: CommandArgumentWithName<unknown> }
    }
  | {
      type: 'Find and select command'
      data: {
        name: string
        groupId: string
        argDefaultValues?: { [x: string]: unknown }
      }
    }
  | {
      type: 'Change current argument'
      data: { [x: string]: CommandArgumentWithName<unknown> }
    }
  | { type: 'Set machine manager'; data: MachineManager }

export const commandBarMachine = setup({
  types: {
    context: {} as CommandBarContext,
    input: {} as { commands: Command[] },
    events: {} as CommandBarMachineEvent,
  },
  actions: {
    enqueueValidArgsToSubmit: assign({
      argumentsToSubmit: ({ context, event }) => {
        if (event.type !== 'xstate.done.actor.validateSingleArgument') return {}
        const [argName, argData] = Object.entries(event.output)[0]
        const { currentArgument } = context
        if (!currentArgument) return {}
        return {
          ...context.argumentsToSubmit,
          [argName]: argData,
        }
      },
    }),
    'Set machine manager': assign({
      machineManager: ({ event, context }) => {
        if (event.type !== 'Set machine manager') return context.machineManager
        return event.data
      },
    }),
    'Execute command': ({ context, event }) => {
      const { selectedCommand } = context
      if (!selectedCommand) return
      if (
        (selectedCommand?.args && event.type === 'Submit command') ||
        event.type === 'xstate.done.actor.validateArguments'
      ) {
        const resolvedArgs = {} as { [x: string]: unknown }
        for (const [argName, argValue] of Object.entries(
          getCommandArgumentKclValuesOnly(event.output)
        )) {
          resolvedArgs[argName] =
            typeof argValue === 'function' ? argValue(context) : argValue
        }
        selectedCommand?.onSubmit(resolvedArgs)
      } else {
        selectedCommand?.onSubmit()
      }
    },
    'Clear selected command': assign({
      selectedCommand: undefined,
    }),
    'Set current argument to first non-skippable': assign({
      currentArgument: ({ context, event }) => {
        const { selectedCommand } = context
        if (!(selectedCommand && selectedCommand.args)) return undefined
        const rejectedArg =
          'data' in event && 'arg' in event.data && event.data.arg

        // Find the first argument that is not to be skipped:
        // that is, the first argument that is not already in the argumentsToSubmit
        // or hidden, or that is not undefined, or that is not marked as "skippable".
        // TODO validate the type of the existing arguments
        const nonHiddenArgs = Object.entries(selectedCommand.args).filter(
          (a) => !a[1].hidden
        )
        let argIndex = 0

        while (argIndex < nonHiddenArgs.length) {
          const [argName, argConfig] = nonHiddenArgs[argIndex]
          const argIsRequired =
            typeof argConfig.required === 'function'
              ? argConfig.required(context)
              : argConfig.required
          const mustNotSkipArg =
            argIsRequired &&
            (!context.argumentsToSubmit.hasOwnProperty(argName) ||
              context.argumentsToSubmit[argName] === undefined ||
              (rejectedArg &&
                typeof rejectedArg === 'object' &&
                'name' in rejectedArg &&
                rejectedArg.name === argName))

          if (
            mustNotSkipArg === true ||
            argIndex + 1 === Object.keys(nonHiddenArgs).length
          ) {
            // If we have reached the end of the arguments and none are skippable,
            // return the last argument.
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
      argumentsToSubmit: ({ context, event }) => {
        if (event.type !== 'Remove argument') return context.argumentsToSubmit
        const argToRemove = Object.values(event.data)[0]
        // Extract all but the argument to remove and return it
        const { [argToRemove.name]: _, ...rest } = context.argumentsToSubmit
        return rest
      },
    }),
    'Set current argument': assign({
      currentArgument: ({ context, event }) => {
        switch (event.type) {
          case 'Edit argument':
            return event.data.arg
          case 'Change current argument':
            return Object.values(event.data)[0]
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
      selectedCommand: ({ context, event }) =>
        event.type === 'Select command'
          ? event.data.command
          : context.selectedCommand,
    }),
    'Find and select command': assign({
      selectedCommand: ({ context, event }) => {
        if (event.type !== 'Find and select command')
          return context.selectedCommand
        const found = context.commands.find(
          (cmd) =>
            cmd.name === event.data.name && cmd.groupId === event.data.groupId
        )

        return !!found ? found : context.selectedCommand
      },
    }),
    'Initialize arguments to submit': assign({
      argumentsToSubmit: ({ context, event }) => {
        if (
          event.type !== 'Select command' &&
          event.type !== 'Find and select command'
        )
          return {}
        const command =
          'data' in event && 'command' in event.data
            ? event.data.command
            : context.selectedCommand
        if (!command?.args) return {}
        const args: { [x: string]: unknown } = {}
        for (const [argName, arg] of Object.entries(command.args)) {
          args[argName] =
            event.data.argDefaultValues &&
            argName in event.data.argDefaultValues
              ? event.data.argDefaultValues[argName]
              : arg.skip && 'defaultValue' in arg
              ? arg.defaultValue
              : undefined
        }
        return args
      },
    }),
  },
  guards: {
    'Command needs review': ({ context }) =>
      context.selectedCommand?.needsReview ||
      ('nodeToEdit' in context.argumentsToSubmit &&
        context.argumentsToSubmit.nodeToEdit !== undefined) ||
      false,
    'Command has no arguments': ({ context }) => {
      return (
        !context.selectedCommand?.args ||
        Object.keys(context.selectedCommand?.args).length === 0
      )
    },
    'All arguments are skippable': ({ context }) => {
      return Object.values(context.selectedCommand!.args!).every(
        (argConfig) => argConfig.skip || argConfig.hidden
      )
    },
    'Has selected command': ({ context }) => !!context.selectedCommand,
  },
  actors: {
    'Validate argument': fromPromise(
      ({
        input,
      }: {
        input: {
          context: CommandBarContext | undefined
          event: CommandBarMachineEvent | undefined
        }
      }) => {
        return new Promise((resolve, reject) => {
          if (!input || input?.event?.type !== 'Submit argument') {
            toast.error(`Unable to validate, wrong event type.`)
            return reject(`Unable to validate, wrong event type`)
          }

          const context = input?.context

          if (!context) {
            toast.error(`Unable to validate, wrong argument.`)
            return reject(`Unable to validate, wrong argument`)
          }

          const data = input.event.data
          const argName = context.currentArgument?.name
          const args = context?.selectedCommand?.args
          const argConfig = args && argName ? args[argName] : undefined
          // Only do a validation check if the argument, selectedCommand, and the validation function are defined
          if (
            context.currentArgument &&
            context.selectedCommand &&
            (argConfig?.inputType === 'selection' ||
              argConfig?.inputType === 'kcl' ||
              argConfig?.inputType === 'selectionMixed') &&
            argConfig?.validation
          ) {
            argConfig
              .validation({ context, data })
              .then((result) => {
                if (typeof result === 'boolean' && result === true) {
                  return resolve(data)
                } else {
                  // validation failed
                  if (typeof result === 'string') {
                    // The result of the validation is the error message
                    toast.error(result)
                    return reject(
                      `unable to validate ${argName}, Message: ${result}`
                    )
                  } else {
                    // Default message if there is not a custom one sent
                    toast.error(`Unable to validate ${argName}`)
                    return reject(`unable to validate ${argName}}`)
                  }
                }
              })
              .catch(() => {
                return reject(`unable to validate ${argName}}`)
              })
          } else {
            // Missing several requirements for validate argument, just bypass
            return resolve(data)
          }
        })
      }
    ),
    'Validate all arguments': fromPromise(
      ({ input }: { input: CommandBarContext }) => {
        return new Promise((resolve, reject) => {
          for (const [argName, argConfig] of Object.entries(
            input.selectedCommand!.args!
          )) {
            let arg = input.argumentsToSubmit[argName]
            let argValue = typeof arg === 'function' ? arg(input) : arg

            try {
              const isRequired =
                typeof argConfig.required === 'function'
                  ? argConfig.required(input)
                  : argConfig.required

              const resolvedDefaultValue =
                'defaultValue' in argConfig
                  ? typeof argConfig.defaultValue === 'function'
                    ? argConfig.defaultValue(input)
                    : argConfig.defaultValue
                  : undefined

              const hasMismatchedDefaultValueType =
                isRequired &&
                resolvedDefaultValue !== undefined &&
                typeof argValue !== typeof resolvedDefaultValue &&
                !(argConfig.inputType === 'kcl' || argConfig.skip)
              const hasInvalidKclValue =
                argConfig.inputType === 'kcl' &&
                !(argValue as Partial<KclCommandValue> | undefined)?.valueAst
              const hasInvalidOptionsValue =
                isRequired &&
                'options' in argConfig &&
                !(
                  typeof argConfig.options === 'function'
                    ? argConfig.options(
                        input,
                        argConfig.machineActor?.getSnapshot().context
                      )
                    : argConfig.options
                ).some((o) => o.value === argValue)

              if (
                hasMismatchedDefaultValueType ||
                hasInvalidKclValue ||
                hasInvalidOptionsValue
              ) {
                return reject({
                  message: 'Argument payload is of the wrong type',
                  arg: {
                    ...argConfig,
                    name: argName,
                  },
                })
              }

              if (
                (argConfig.inputType !== 'boolean' &&
                argConfig.inputType !== 'options'
                  ? !argValue
                  : argValue === undefined) &&
                isRequired
              ) {
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
              return reject(e)
            }
          }

          return resolve(input.argumentsToSubmit)
        })
      }
    ),
  },
}).createMachine({
  /** @xstate-layout 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 */
  context: ({ input }) => ({
    commands: input.commands || [],
    selectedCommand: undefined,
    currentArgument: undefined,
    selectionRanges: {
      otherSelections: [],
      codeBasedSelections: [],
    },
    argumentsToSubmit: {},
    machineManager: {
      machines: [],
      machineApiIp: null,
      currentMachine: null,
      setCurrentMachine: () => {},
      noMachinesReason: () => undefined,
    },
  }),
  id: 'Command Bar',
  initial: 'Closed',
  states: {
    Closed: {
      on: {
        Open: {
          target: 'Selecting command',
        },

        'Add commands': {
          target: 'Closed',

          actions: [
            assign({
              commands: ({ context, event }) =>
                [...context.commands, ...event.data.commands].sort(
                  sortCommands
                ),
            }),
          ],
        },

        'Remove commands': {
          target: 'Closed',

          actions: [
            assign({
              commands: ({ context, event }) =>
                context.commands.filter(
                  (c) =>
                    !event.data.commands.some(
                      (c2) => c2.name === c.name && c2.groupId === c.groupId
                    )
                ),
            }),
          ],
        },
      },

      always: {
        target: 'Command selected',
        guard: 'Has selected command',
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
          guard: 'Command has no arguments',
          actions: ['Execute command', 'Clear selected command'],
        },
        {
          target: 'Checking Arguments',
          guard: 'All arguments are skippable',
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
            id: 'validateSingleArgument',
            input: ({ event, context }) => {
              if (event.type !== 'Submit argument')
                return { event: undefined, context: undefined }
              return { event, context }
            },
            onDone: {
              target: '#Command Bar.Checking Arguments',
              actions: ['enqueueValidArgsToSubmit'],
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
          actions: ['Execute command', 'Clear selected command'],
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
        input: ({ context }) => context,
        onDone: [
          {
            target: 'Review',
            guard: 'Command needs review',
          },
          {
            target: 'Closed',
            actions: ['Execute command', 'Clear selected command'],
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
    'Set machine manager': {
      reenter: false,
      actions: 'Set machine manager',
    },

    Close: {
      target: '.Closed',
      actions: 'Clear selected command',
    },

    Clear: {
      target: '#Command Bar',
      reenter: false,
      actions: ['Clear argument data'],
    },

    'Find and select command': {
      target: '.Command selected',
      actions: ['Find and select command', 'Initialize arguments to submit'],
    },
  },
})

function sortCommands(a: Command, b: Command) {
  if (b.groupId === 'auth' && !(a.groupId === 'auth')) return -2
  if (a.groupId === 'auth' && !(b.groupId === 'auth')) return 2
  if (b.groupId === 'settings' && !(a.groupId === 'settings')) return -1
  if (a.groupId === 'settings' && !(b.groupId === 'settings')) return 1
  return a.name.localeCompare(b.name)
}

export const commandBarActor = createActor(commandBarMachine, {
  input: {
    commands: [...authCommands],
  },
}).start()

/** Basic state snapshot selector */
const cmdBarStateSelector = (state: SnapshotFrom<typeof commandBarActor>) =>
  state
export const useCommandBarState = () => {
  return useSelector(commandBarActor, cmdBarStateSelector)
}
