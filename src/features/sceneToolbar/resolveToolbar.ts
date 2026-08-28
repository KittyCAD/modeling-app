import type { IconName } from '@kittycad/ui-kit'
import type { Command } from '@src/contracts/commands'
import type { ToolbarItem } from '@src/contracts/sceneModes'
import { byOrder } from '@src/lib/registryOrdering'

export interface ResolvedButton {
  kind: 'command'
  id: string
  command: Command
}

export interface ResolvedGroup {
  kind: 'group'
  id: string
  title: string
  icon?: IconName
  /** What the face runs: the last used command, or the first. */
  face: Command
  /** Every command in the group, in contributed order, face included. */
  commands: readonly Command[]
}

export type ResolvedEntry = ResolvedButton | ResolvedGroup

/** A run of entries drawn together, with a rule between one run and the next. */
export interface ToolbarSection {
  id: string
  entries: readonly ResolvedEntry[]
}

export interface ResolveToolbarOptions {
  items: readonly ToolbarItem[]
  /** Null before any mode exists, which resolves to nothing. */
  mode: string | null
  commandFor: (commandId: string) => Command | undefined
  lastUsed: ReadonlyMap<string, string>
}

/**
 * What the active mode's toolbar is, right now.
 *
 * Everything the toolbar draws is decided here, so the component holds no policy
 * at all — which is what makes the awkward parts testable: a group whose face is
 * the last thing you used, a group that has shrunk to one command, an item naming
 * a command that no longer exists.
 *
 * An item whose command is missing is dropped rather than drawn disabled. A
 * disabled button is a promise that the action exists and cannot run now; a
 * button for a command nobody registered is a bug in a contribution, and drawing
 * it would put that bug in the user's way instead of the developer's. A command
 * that exists but cannot run *is* drawn, disabled — that is what `enabled` is
 * for.
 */
export function resolveToolbar(
  options: ResolveToolbarOptions
): readonly ToolbarSection[] {
  const { items, mode, commandFor, lastUsed } = options
  if (!mode) return []

  const sections: ToolbarSection[] = []
  const entriesFor = new Map<string, ResolvedEntry[]>()

  for (const item of byOrder(
    items.filter((candidate) => candidate.mode === mode)
  )) {
    const entry = resolveEntry(item, commandFor, lastUsed)
    if (!entry) continue

    const sectionId = item.section ?? ''
    const existing = entriesFor.get(sectionId)
    if (existing) {
      existing.push(entry)
      continue
    }

    const entries = [entry]
    entriesFor.set(sectionId, entries)
    // First appearance fixes the section's position, so a section is where its
    // earliest item is rather than wherever its last one landed.
    sections.push({ id: sectionId, entries })
  }

  return sections
}

function resolveEntry(
  item: ToolbarItem,
  commandFor: (commandId: string) => Command | undefined,
  lastUsed: ReadonlyMap<string, string>
): ResolvedEntry | null {
  if (item.kind === 'command') {
    const command = commandFor(item.commandId)
    return command ? { kind: 'command', id: item.id, command } : null
  }

  const commands = item.commandIds
    .map((commandId) => commandFor(commandId))
    .filter((command): command is Command => command !== undefined)

  if (commands.length === 0) return null

  /*
   * A group of one is a button.
   *
   * Not a special case so much as the general one: a group is a way to spend one
   * button on several commands, and with nothing to choose between, the caret
   * asks a question with one answer. This is how a group behaves as its
   * contributions come and go — three tools behind experimental flags, two of
   * them off — without anybody writing that condition.
   */
  if (commands.length === 1) {
    return { kind: 'command', id: item.id, command: commands[0] }
  }

  const remembered = lastUsed.get(item.id)
  const face =
    commands.find((command) => command.id === remembered) ?? commands[0]

  return {
    kind: 'group',
    id: item.id,
    title: item.title,
    icon: item.icon,
    face,
    commands,
  }
}
