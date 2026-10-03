import type {
  Command,
  CommandArgument,
  KclCommandValue,
} from '@src/lib/commandTypes'
import type { CommandBarContext } from '@src/machines/commandBarMachine'

export function shouldPrepopulateArgument(
  arg: Pick<CommandArgument<unknown>, 'prepopulate' | 'machineActor'>,
  context: CommandBarContext
): boolean {
  return typeof arg.prepopulate === 'function'
    ? arg.prepopulate(context, arg.machineActor?.getSnapshot().context)
    : !!arg.prepopulate
}

// Extract the KCL value from argument payloads that also carry UI metadata.
export function getCommandArgumentKclValuesOnly(args: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => {
      if (value !== null && typeof value === 'object' && 'value' in value) {
        return [key, value.value]
      }
      return [key, value]
    })
  )
}

export interface CommandWithDisabledState {
  command: Command
  disabled: boolean
}

export function isModelingDialogCommand(
  command: Pick<Command, 'groupId' | 'useModelingDialog'> | undefined
): command is Command & { groupId: 'modeling'; useModelingDialog: true } {
  return command?.groupId === 'modeling' && command.useModelingDialog === true
}

export const commandKey = (command: Command) =>
  command.id ?? `${command.groupId}:${String(command.name)}`

/**
 * Sorting logic for commands in the command combo box.
 */
export function sortCommands(
  a: CommandWithDisabledState,
  b: CommandWithDisabledState
) {
  // Disabled commands should be at the bottom
  if (a.disabled && !b.disabled) {
    return 1
  }
  if (b.disabled && !a.disabled) {
    return -1
  }
  // Settings commands should be next-to-last
  if (a.command.groupId === 'settings' && b.command.groupId !== 'settings') {
    return 1
  }
  if (b.command.groupId === 'settings' && a.command.groupId !== 'settings') {
    return -1
  }
  // Modeling commands should be first
  if (a.command.groupId === 'modeling' && b.command.groupId !== 'modeling') {
    return -1
  }
  if (b.command.groupId === 'modeling' && a.command.groupId !== 'modeling') {
    return 1
  }
  // Sort alphabetically
  return (a.command.displayName || a.command.name).localeCompare(
    b.command.displayName || b.command.name
  )
}

/**
 * Type guard to safely check if a value is a KclCommandValue.
 *
 * @param value - The value to check.
 * @returns True if the value is a KclCommandValue, false otherwise.
 */
export function isKclCommandValue(value: unknown): value is KclCommandValue {
  return (
    value !== null &&
    typeof value === 'object' &&
    'valueText' in value &&
    'valueAst' in value &&
    'valueCalculated' in value
  )
}
