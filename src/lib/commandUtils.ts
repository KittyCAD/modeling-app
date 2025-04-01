// Some command argument payloads are objects with a value field that is a KCL expression.
// That object also contains some metadata about what to do with the KCL expression,
// such as whether we need to create a new variable for it.
// This function extracts the value field from those arg payloads and returns
import { Command } from './commandTypes'

// The arg object with all its field as natural values that the command to be executed will expect.
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
