import type { IconName } from '@kittycad/ui-kit'
import type { ToolbarItem } from '@src/contracts/sceneModes'

/**
 * Toolbar buttons, derived from a list of tools.
 *
 * One function for every toolbar in the app, because the derivation is the same
 * wherever the tools come from: an ungrouped tool is a button, a group is one
 * button holding its members in order, and a group nobody joined is not a button
 * at all. Modelling had this and sketching hand-wrote the equivalent twice, which
 * is how the two toolbars came to disagree about where placement is declared.
 *
 * What it deliberately does *not* do is invent ids. Each catalogue names its own
 * commands and its own items — `modeling.extrude`, `sketch.tool.line` — and those
 * rules belong with the catalogue that has to keep them stable, not in a shared
 * helper that would then own everybody's naming.
 */

/** A tool, as far as its button is concerned. */
export interface ToolbarEntry {
  /** The command pressing it runs. */
  commandId: string
  /** The button's own id, which is not the command's. */
  itemId: string
  /** Whose toolbar this appears in. */
  mode: string
  /** The run of buttons it belongs to. A change of section draws a rule. */
  section?: string
  /** Shares one button with every other entry naming the same group. */
  group?: string
  /** Lower sorts earlier, within the section and within the group. */
  order?: number
}

/** A button shared by several tools. Everything else is read from its members. */
export interface ToolbarGroup {
  id: string
  /** The button's own id. */
  itemId: string
  /** Names the group in its menu: "Pattern", "Constraints". */
  title: string
  icon?: IconName
}

export function toolbarItemsFrom(
  entries: readonly ToolbarEntry[],
  groups: readonly ToolbarGroup[]
): readonly ToolbarItem[] {
  const items: ToolbarItem[] = []

  for (const entry of entries) {
    if (entry.group) continue
    items.push({
      kind: 'command',
      id: entry.itemId,
      mode: entry.mode,
      section: entry.section,
      order: entry.order,
      commandId: entry.commandId,
    })
  }

  for (const group of groups) {
    const members = [...entries]
      .filter((entry) => entry.group === group.id)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

    /*
     * A group nobody joined is not a button.
     *
     * Which is what lets a group survive its members being removed — a caret
     * over an empty menu is worse than a missing button.
     */
    const first = members[0]
    if (!first) continue

    items.push({
      kind: 'group',
      id: group.itemId,
      // From the first member, so a group's place is where its tools are rather
      // than a second number to keep in step.
      mode: first.mode,
      section: first.section,
      order: first.order,
      title: group.title,
      icon: group.icon,
      commandIds: members.map((member) => member.commandId),
    })
  }

  return items
}
