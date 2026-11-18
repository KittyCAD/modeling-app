import { Popover } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import { useViewControlMenuItems } from '@src/components/ViewControlMenu'
import { useApp } from '@src/lib/boot'
import {
  type ViewControlMenuItem,
  viewControlMenuItemsFacet,
} from '@src/registry/contracts/viewControls'
import { useEffect, useRef, useState } from 'react'

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

  useEffect(() => {
    if (activeHelp && !contributions.includes(activeHelp)) {
      setActiveHelp(undefined)
      return
    }
    if (open) {
      const help = activeHelp ?? (canOfferHelp ? requestedHelp : undefined)
      if (help) {
        setActiveHelp(help)
        help.help?.shown()
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
          '[role="dialog"], [role="menu"], [role="listbox"], [aria-haspopup][aria-expanded="true"]'
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
        data-testid="gizmo-view-menu"
        className="absolute bottom-full right-0 mb-2 w-56 max-h-[70vh] overflow-y-auto bg-2 border border-solid b-4 rounded shadow-lg"
      >
        {activeHelp?.help && (
          <div className="p-2 border-b b-4">
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
        <ul className="relative flex flex-col items-stretch content-stretch p-0.5">
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
