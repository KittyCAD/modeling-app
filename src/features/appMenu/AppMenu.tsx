import { useComputed } from '@preact/signals'
import { Button, Icon, Menu, type MenuSection } from '@kittycad/ui-kit'
import { useService, useValueSpec } from '@src/app/context'
import {
  appMenuSectionGroupsValueSpec,
  appMenuSectionsValueSpec,
  appMenuTriggerValueSpec,
} from '@src/contracts/appMenu'
import { commandService } from '@src/contracts/commands'
import './appMenu.css'

/**
 * The app menu in the top bar.
 *
 * Assembles contributed sections and resolves each item to either a command or
 * a direct handler. Preferring `commandId` means most entries are reachable
 * three ways — menu, palette, keybinding — from one declaration.
 */
export function AppMenu() {
  const sections = useValueSpec(appMenuSectionsValueSpec)
  const groups = useValueSpec(appMenuSectionGroupsValueSpec)
  const trigger = useValueSpec(appMenuTriggerValueSpec)
  const commands = useService(commandService)

  const resolved = useComputed<MenuSection[]>(() => {
    const all = [...sections.value, ...groups.value.flat()].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id)
    )

    return (
      all
        .filter((section) => section.visible?.value ?? true)
        .map((section) => ({
          id: section.id,
          label: section.label,
          content: section.content?.(),
          items: (section.items ?? []).map((item) => ({
            id: item.id,
            label: item.label,
            icon: item.icon,
            shortcut:
              item.shortcut ??
              (item.commandId
                ? commands.get(item.commandId)?.shortcut
                : undefined),
            destructive: item.destructive,
            disabled:
              item.disabled?.value ??
              (item.commandId
                ? (commands.get(item.commandId)?.enabled?.value ?? true) ===
                  false
                : false),
            onSelect: () => {
              if (item.commandId) {
                commands.run(item.commandId)
                return
              }
              item.onSelect?.()
            },
          })),
        }))
        // A section with nothing in it would render as a stray rule.
        .filter(
          (section) =>
            (section.items?.length ?? 0) > 0 || section.content !== undefined
        )
    )
  })

  return (
    <Menu
      label="Application menu"
      align="end"
      sections={resolved.value}
      trigger={({ open, toggle, ref }) =>
        trigger.value ? (
          trigger.value.render({ open, toggle, ref })
        ) : (
          <Button
            variant="chassis"
            iconOnly
            icon="moreHorizontal"
            label="Menu"
            pressed={open}
            onClick={toggle}
            elementRef={ref}
          />
        )
      }
    />
  )
}

/** A compact identity card, for the menu's identity section. */
export function MenuIdentity({
  name,
  detail,
  /**
   * A second, quieter line: the org, when there is one.
   *
   * Separate from `detail` rather than folded into it, because the two answer
   * different questions — which account this is, and whose plan it bills to —
   * and the second is the one somebody checks when the app says they have no
   * credits.
   */
  meta,
  imageUrl,
}: {
  name: string
  detail?: string
  meta?: string
  imageUrl?: string
}) {
  return (
    <div class="zds-menu-identity">
      <span class="zds-menu-identity__avatar">
        {imageUrl ? (
          <img src={imageUrl} alt="" />
        ) : (
          <Icon name="dot" size="small" />
        )}
      </span>
      <span class="zds-menu-identity__text">
        <span class="zds-menu-identity__name">{name}</span>
        {detail ? (
          <span class="zds-menu-identity__detail zds-value">{detail}</span>
        ) : null}
        {meta ? <span class="zds-menu-identity__meta">{meta}</span> : null}
      </span>
    </div>
  )
}
