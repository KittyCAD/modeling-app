import { AnyStateMachine, assign, createMachine } from 'xstate'
import { Command, CommandArgument } from 'lib/commandTypes'

export const commandBarMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QGED2BbdBDAdhABAEJYBOAxMgDaqxgDaADALqKgAONAlgC6eo6sQAD0QA2AOwAaEAE9EAFgDMAVgB0ygIyLRADmU7F8+QCZlo+QF8L0tJlwFi5AIIQCAYwzY8sRiyQgOWB4+AX8RBB0dY1VxcXlxUVEGZIZ5HSlZRA1U8XV5DSNlYw1iqKsbT3siUjIAJTB0VAA3MHwPO29fQUDg-kFwnV1VeQBOBhHjBmM4hkVxZWk5BA0C6J0NUQL9Iq2dcpBbLwdSVSoaSDIAeTYwHC7-Ht4+sLEk9SnlWOy58RLFhRU6i0un0hhMZks1gOlTw1RIqgAymBKGA3LwcFA2jCIGQkSi0ViOhB7uwuE9QqBwsZEqpRCN5AxfnSNJpIvJ-hENKpFMZjJEGIkGeIGBpxPtDlVHKdsfhaPjuBcACJwZGo7iEo4kgJkkL9RDTUS0+mMjYjFkaNkcyZc8QqUQQqKibTKcUyqUS2FytUXLWPXUvBB8w10oWm82WzKBzTqTaTdYaEYJM2iV1EuHStNetE+jR+UlBcl6wODI2h5msnTsyOGaKKRSMsxmOZpYypo7pgDiWG4AAswCROBj8KQoABXdC3biwVROADuWGCQ8HbFH3Fxo4ARugeL6dc9KWJ8qo9MKEyzlKNphzT8eGPpknX5LGU1CPcd4V3e-3B5iR+PJ9OABqWCUJwEDdj+ZAQPwYCqIOTSoAA1rBTQgWB3ZgE4JBjhOODcLuBb+geyymLkLL2lMig6CMIzKCMigchIDDHrod4JMY8Qhm2konJ+fYDkOf64VOqjAaB4HolAZD9iQqDwmwlDdgAZnJ6CqKh4kYVhOGTgRvQUsIh5cieIpmsoF4TBkSz2vIqgjOs5ksooYxTC+FRplK9RNJwYCzuuW47sw3R7gZ4QWmoAp6PS2QzEkDGRkUhpxrGOh3jylbcbCnlgN5vlkC4BBCbpQUPCFRYJhFILRYyDJxYxxTDAYihaIUxgTIomXvqoXk+X59SNC0w7Yf+eF6YWAYxbSVEfDFVFKDoHIGLZdYGKlxQshxYqvm6Jw9XlACiEA8ENOmjSV+b6UWpiGneSRPvo+SGAskaxDoU3JE+UQXneezbR5JzIH2biIT++DaSNU5QTBcE4AhyHqWhEmYcNwk+Od2qEfuhlRjdZipPalYtc9Sztao1KpaMvx6J8bnQv98KA6iINDuDqPSSQsnyYp3AqSQakaehCqswBY1Edj4Jk+Mwr2SKkQFFWSwGMxNH3SYHH0c1VhQjgqAQHAghvnCwWY6FWQjByAC0N0pDbtt8p16ZnLQEDG5dAbmWocQ0eIHEqMYzocvI+jDAKHFB5MtoJg7Up4mqoPtEcrvjcRXzDAU2RNXRNELZGky2Qy2i1RIRRMtHAMylmCou6VJtFhIHI8rkdITG1cSaCMEhlx+3b8aDRV4fANdu8RSjMVEtHrPMiSpXEHLmW94iJuIBjZCUqRd6ofHfoJKMATO86Lpiy6rknYvhPEb3j-oopmKxs+RvaIxk-WaTmkonytn97ZSlvAm-rvA9RKIwghiU+WMBifFpMKRevweQd1SIxJ8qg16JDmPaaYJgN57VnGA02ywGBvVqs1AhT47wEKsogeitlNj1lSnoAokQtruW-gDIGzNMTCwHrg8q8RlqpETLySe7VFrUmGFTOsvwjDhy1hYIAA */
    context: {
      commands: [] as Command<AnyStateMachine, unknown>[],
      selectedCommand: undefined as
        | Command<AnyStateMachine, unknown>
        | undefined,
      currentArgument: undefined as
        | CommandArgument<AnyStateMachine, unknown>
        | undefined,
      argumentsToSubmit: {} as CommandArgument<AnyStateMachine, unknown>[],
    },
    id: 'Command Bar',
    initial: 'Closed',
    states: {
      Closed: {
        on: {
          Open: {
            target: 'Selecting command',
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
              Submit: {
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
          Submit: {
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
            commands: (_c, _e) => [],
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
            data: { command: Command<AnyStateMachine, unknown> }
          }
        | { type: 'Deselect command' }
        | { type: 'Submit'; data: Command<AnyStateMachine, unknown>['args'] }
        | {
            type: 'Add argument'
            data: { argument: CommandArgument<AnyStateMachine, unknown> }
          }
        | { type: 'Remove argument' }
        | {
            type: 'Edit argument'
            data: { argument: CommandArgument<AnyStateMachine, unknown> }
          }
        | {
            type: 'Add commands'
            data: { commands: Command<AnyStateMachine, unknown>[] }
          }
        | {
            type: 'Remove commands'
            data: { commands: Command<AnyStateMachine, unknown>[] }
          },
    },
    predictableActionArguments: true,
    preserveActionOrder: true,
  },
  {
    actions: {
      'Set current argument': (context, event) => {},
      'Remove argument': (context, event) => {},
      'Remove commands': assign({
        commands: (context, event) => {
          return context.commands.filter(
            (a) =>
              !event.data.commands.some(
                (b) => b.name === a.name && b.owner === a.owner
              )
          )
        },
      }),
    },
    delays: {},
  }
)

function sortCommands(
  a: Command<AnyStateMachine, unknown>,
  b: Command<AnyStateMachine, unknown>
) {
  if (b.owner === 'auth') return -1
  if (a.owner === 'auth') return 1
  return a.name.localeCompare(b.name)
}
