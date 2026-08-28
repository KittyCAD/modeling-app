import { useComputed, useSignal } from '@preact/signals'
import type { ComponentChildren } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import type { IconName } from '../icons'
import { Icon } from './icon'
import { type BaseProps, cx } from './shared'
import './menu.css'

export interface MenuItem {
  id: string
  label: string
  icon?: IconName
  /** Display form of the keybinding, e.g. `⌘K`. */
  shortcut?: string
  disabled?: boolean
  /** Marks a destructive action, which is styled and confirmed differently. */
  destructive?: boolean
  onSelect?: () => void
}

export interface MenuSection {
  id: string
  /** Mono heading. Omit for an unlabelled group separated by a rule. */
  label?: string
  /** Arbitrary content instead of items — an identity card, a status readout. */
  content?: ComponentChildren
  items?: MenuItem[]
}

export interface MenuProps extends BaseProps {
  /** The button that opens the menu. Rendered with the open state applied. */
  trigger: (props: {
    open: boolean
    toggle: () => void
    /** Forward to the trigger element, so focus can return to it on close. */
    ref: (element: HTMLElement | null) => void
  }) => ComponentChildren
  sections: MenuSection[]
  /** Which edge the panel aligns to. Defaults to the trigger's inline end. */
  align?: 'start' | 'end'
  label: string
}

/**
 * A menu anchored to a trigger.
 *
 * The trigger is a render prop rather than a component, because what opens a
 * menu varies — a chassis button, an avatar, a text label — and a component
 * would either take a dozen props or force a wrapper element into the layout.
 *
 * Sections may hold items or arbitrary content, which is what lets a menu carry
 * an identity card at the top and actions below it without the menu knowing what
 * identity is.
 */
export function Menu({
  trigger,
  sections,
  align = 'end',
  label,
  class: className,
  ...rest
}: MenuProps) {
  const open = useSignal(false)
  const highlighted = useSignal(-1)
  const container = useRef<HTMLDivElement>(null)
  const triggerElement = useRef<HTMLElement | null>(null)

  /** Flat list of selectable items, for keyboard navigation across sections. */
  const selectable = useComputed(() =>
    sections.flatMap((section) =>
      (section.items ?? []).filter((item) => !item.disabled)
    )
  )

  const close = () => {
    open.value = false
    highlighted.value = -1
    // Focus goes back to the trigger, so a keyboard user is not stranded.
    triggerElement.current?.focus()
  }

  useEffect(() => {
    if (!open.value) return

    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) {
        open.value = false
        highlighted.value = -1
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'Escape':
          event.preventDefault()
          close()
          break
        case 'ArrowDown':
        case 'ArrowUp': {
          event.preventDefault()
          const count = selectable.value.length
          if (count === 0) return
          const delta = event.key === 'ArrowDown' ? 1 : -1
          highlighted.value = (highlighted.value + delta + count) % count
          break
        }
        case 'Enter':
        case ' ': {
          const item = selectable.value[highlighted.value]
          if (!item) return
          event.preventDefault()
          close()
          item.onSelect?.()
          break
        }
      }
    }

    // Capture, so the menu answers Escape before anything focused inside it.
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown, { capture: true })
    }
  })

  let itemIndex = -1

  return (
    <div
      {...rest}
      ref={container}
      class={cx('zds-menu', className)}
      data-align={align}
    >
      {trigger({
        open: open.value,
        toggle: () => {
          open.value = !open.value
          highlighted.value = -1
        },
        ref: (element) => {
          triggerElement.current = element
        },
      })}

      {open.value ? (
        <div class="zds-menu__panel" role="menu" aria-label={label}>
          {sections.map((section, sectionIndex) => (
            <div
              class="zds-menu__section"
              key={section.id}
              // A rule between groups, never above the first one.
              data-first={sectionIndex === 0}
            >
              {section.label ? (
                <p class="zds-label zds-menu__section-label">{section.label}</p>
              ) : null}
              {section.content ? (
                <div class="zds-menu__content">{section.content}</div>
              ) : null}
              {(section.items ?? []).map((item) => {
                if (!item.disabled) itemIndex += 1
                const index = itemIndex

                return (
                  <button
                    type="button"
                    class="zds-menu__item"
                    key={item.id}
                    role="menuitem"
                    disabled={item.disabled}
                    data-destructive={item.destructive ?? false}
                    aria-current={
                      !item.disabled && index === highlighted.value
                        ? 'true'
                        : undefined
                    }
                    onPointerEnter={() => {
                      if (!item.disabled) highlighted.value = index
                    }}
                    onClick={() => {
                      close()
                      item.onSelect?.()
                    }}
                  >
                    {item.icon ? (
                      <Icon name={item.icon} size="small" />
                    ) : (
                      <span class="zds-menu__no-icon" aria-hidden="true" />
                    )}
                    <span class="zds-menu__label">{item.label}</span>
                    {item.shortcut ? (
                      <kbd class="zds-menu__shortcut">{item.shortcut}</kbd>
                    ) : null}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
