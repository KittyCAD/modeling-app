import type { MenuSection } from '@kittycad/ui-kit'
import type { CommandService } from '@src/contracts/commands'
import type { ContextMenuContribution } from '@src/contracts/contextMenu'

/**
 * Turn domain contributions into the ui-kit's intentionally context-free rows.
 *
 * Commands supply their own title, icon, shortcut and availability unless the
 * placement overrides presentation. Direct handlers remain available for an
 * action whose context cannot be represented by today's argument-free command
 * contract.
 */
export function resolveContextMenu<Context>(
  contributions: readonly ContextMenuContribution<Context>[],
  context: Context,
  commands: CommandService
): MenuSection[] {
  const sections = new Map<
    string,
    {
      id: string
      order?: number
      label?: string
      items: NonNullable<MenuSection['items']>
    }
  >()

  const ordered = [...contributions].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id)
  )

  for (const contribution of ordered) {
    if (contribution.visible && !contribution.visible(context)) {
      continue
    }

    const command = contribution.commandId
      ? commands.get(contribution.commandId)
      : undefined
    const label = contribution.label ?? command?.title
    // A missing command is not an inert row. It is the same as an unavailable
    // capability and disappears until a provider exists.
    if (!label || (contribution.commandId && !command)) {
      continue
    }
    if (!contribution.commandId && !contribution.onSelect) {
      continue
    }

    const placement = contribution.section ?? { id: 'default' }
    const section = sections.get(placement.id) ?? {
      id: placement.id,
      order: placement.order,
      label: placement.label,
      items: [],
    }
    if (sections.has(placement.id)) {
      if (placement.order !== undefined) {
        section.order =
          section.order === undefined
            ? placement.order
            : Math.min(section.order, placement.order)
      }
      section.label ??= placement.label
    } else {
      sections.set(placement.id, section)
    }

    const explicitlyDisabled =
      typeof contribution.disabled === 'function'
        ? contribution.disabled(context)
        : (contribution.disabled ?? false)
    const commandDisabled = command?.enabled?.value === false

    section.items.push({
      id: contribution.id,
      label,
      icon: contribution.icon ?? command?.icon,
      shortcut: contribution.shortcut ?? command?.shortcut,
      destructive: contribution.destructive,
      disabled: explicitlyDisabled || commandDisabled,
      onSelect: () => {
        if (contribution.commandId) {
          commands.run(contribution.commandId)
          return
        }
        contribution.onSelect?.(context)
      },
    })
  }

  return [...sections.values()]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
    .map(({ order: _order, ...section }) => ({
      ...section,
      items: section.items,
    }))
}
