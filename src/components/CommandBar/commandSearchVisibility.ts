import type { Command } from '@src/lib/commandTypes'
import { isDesktop } from '@src/lib/isDesktop'

export function isCommandVisibleInSearch(
  command: Command,
  desktop = isDesktop()
) {
  if (command.hideFromSearch === true) return false
  if (command.hide === 'both') return false
  if (command.hide === 'desktop' && desktop) return false
  if (command.hide === 'web' && !desktop) return false
  return true
}
