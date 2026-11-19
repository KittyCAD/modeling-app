import { Popover } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import { useViewControlMenuItems } from '@src/components/ViewControlMenu'
import { useApp } from '@src/lib/boot'
import {
  type ViewControlMenuItem,
  viewControlMenuItemsFacet,
} from '@src/registry/contracts/viewControls'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export default function GizmoDropdown({
  canOfferHelp,
}: {
  canOfferHelp: boolean
}) {
  return (
    <Popover className="absolute top-0 right-0 pointer-events-auto">
      {(popover) => (
        <GizmoMenu
          open={popover.open}
          close={() => popover.close()}
          canOfferHelp={canOfferHelp}
        />
      )}
    </Popover>
  )
}

function GizmoMenu({
  open,
  close,
  canOfferHelp,
}: {
  open: boolean
  close: () => void
  canOfferHelp: boolean
}) {
  useSignals()
  const { registry } = useApp()
  const contributions = registry.observe(viewControlMenuItemsFacet).value
  const requestedHelp = contributions.find((item) => item.help?.requested.value)
  const [activeHelp, setActiveHelp] = useState<ViewControlMenuItem>()
  const items = useViewControlMenuItems(activeHelp?.id)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const menuItems = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (activeHelp && !contributions.includes(activeHelp)) {
      setActiveHelp(undefined)
      return
    }
    if (open) {
      const help = activeHelp ?? (canOfferHelp ? requestedHelp : undefined)
      if (help) {
        setActiveHelp(help)
      }
      return
    }
    setActiveHelp(undefined)
    if (!canOfferHelp || !requestedHelp) return
    let timeout: ReturnType<typeof setTimeout>
    const offer = () => {
      if (!requestedHelp.help?.requested.value) return
      if (
        document.hidden ||
        !document.hasFocus() ||
        document.querySelector(
          '[role="dialog"], [role="menu"], [role="listbox"], [aria-haspopup][aria-expanded="true"], [data-headlessui-state~="open"][id^="headlessui-popover-panel"]'
        ) ||
        document.activeElement?.closest(
          'input, textarea, [contenteditable="true"], [role="textbox"]'
        )
      ) {
        timeout = setTimeout(offer, 500)
        return
      }
      setActiveHelp(requestedHelp)
      button.current?.click()
    }
    timeout = setTimeout(offer, 500)
    return () => clearTimeout(timeout)
  }, [open, canOfferHelp, requestedHelp, activeHelp, contributions])

  useLayoutEffect(() => {
    if (!open) return
    const position = () => {
      const dropdown = panel.current
      const trigger = button.current
      const list = menuItems.current
      if (!dropdown || !trigger || !list) return
      const anchor = trigger.getBoundingClientRect()
      const box = dropdown.getBoundingClientRect()
      dropdown.style.position = 'fixed'
      dropdown.style.bottom = 'auto'
      dropdown.style.right = 'auto'
      dropdown.style.left = `${Math.max(8, Math.min(anchor.right - box.width, window.innerWidth - box.width - 8))}px`
      dropdown.style.top = `${Math.max(8, Math.min(anchor.top - box.height - 8, window.innerHeight - box.height - 8))}px`
      if (!activeHelp) return
      const row = [
        ...list.querySelectorAll<HTMLElement>('[data-view-control-item]'),
      ].find((node) => node.dataset.viewControlItem === activeHelp.id)
      const target = row?.querySelector<HTMLElement>('button, a[href]')
      if (!target) return
      const action = target.getBoundingClientRect()
      const visible = list.getBoundingClientRect()
      list.scrollTop +=
        action.top - visible.top - (visible.height - action.height) / 2
      const scrolled = target.getBoundingClientRect()
      if (
        scrolled.height > 0 &&
        scrolled.width > 0 &&
        scrolled.top >= visible.top - 1 &&
        scrolled.bottom <= visible.bottom + 1 &&
        visible.top >= 0 &&
        visible.bottom <= window.innerHeight
      ) {
        activeHelp.help?.shown()
      }
    }
    position()
    window.addEventListener('resize', position)
    return () => window.removeEventListener('resize', position)
  }, [open, activeHelp, items])

  return (
    <>
      <Popover.Button
        ref={button}
        className="border-none p-0 m-0 -translate-y-1/4 translate-x-1/4"
      >
        <CustomIcon name="caretDown" className="w-4 h-4 ui-open:rotate-180" />
        <span className="sr-only">View settings</span>
      </Popover.Button>
      <Popover.Panel
        ref={panel}
        data-testid="gizmo-view-menu"
        className="absolute z-50 bottom-full right-0 mb-2 w-56 max-w-[calc(100vw-1rem)] max-h-[70vh] flex flex-col overflow-hidden bg-2 border border-solid b-4 rounded shadow-lg"
      >
        {activeHelp?.help && (
          <div className="shrink-0 p-2 border-b b-4">
            <p role="status" className="m-0 text-sm">
              {activeHelp.help.message}
            </p>
            <button
              type="button"
              className="mt-1 text-sm underline border-none"
              onClick={() => close()}
            >
              Got it
            </button>
          </div>
        )}
        <ul
          ref={menuItems}
          className="relative min-h-0 overflow-y-auto flex flex-col items-stretch content-stretch p-0.5"
        >
          {items.map((item, index) => (
            <li key={index} className="contents" onClick={() => close()}>
              {item}
            </li>
          ))}
        </ul>
      </Popover.Panel>
    </>
  )
}
