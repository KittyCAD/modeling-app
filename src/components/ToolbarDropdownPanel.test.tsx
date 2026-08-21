import { forwardRef, useRef } from 'react'
import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { ToolbarDropdownPanel } from '@src/components/ToolbarDropdownPanel'

const originalHidePopover = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'hidePopover'
)
const originalShowPopover = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'showPopover'
)

vi.mock('@headlessui/react', () => ({
  Popover: {
    Panel: forwardRef<
      HTMLDivElement,
      React.ComponentPropsWithoutRef<'div'> & { unmount?: boolean }
    >(function MockPopoverPanel({ unmount: _unmount, ...props }, ref) {
      return <div ref={ref} {...props} />
    }),
  },
}))

function Dropdown({ label }: { label: string }) {
  const buttonRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button ref={buttonRef} type="button">
        {label}
      </button>
      <ToolbarDropdownPanel buttonRef={buttonRef} open>
        <li>{label} item</li>
      </ToolbarDropdownPanel>
    </>
  )
}

describe('ToolbarDropdownPanel', () => {
  beforeEach(() => {
    Object.defineProperties(HTMLElement.prototype, {
      hidePopover: { configurable: true, value: vi.fn() },
      showPopover: { configurable: true, value: vi.fn() },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalHidePopover) {
      Object.defineProperty(
        HTMLElement.prototype,
        'hidePopover',
        originalHidePopover
      )
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'hidePopover')
    }
    if (originalShowPopover) {
      Object.defineProperty(
        HTMLElement.prototype,
        'showPopover',
        originalShowPopover
      )
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'showPopover')
    }
  })

  test('connects each trigger and panel with a unique explicit anchor', async () => {
    const { container } = render(
      <>
        <Dropdown label="First" />
        <Dropdown label="Second" />
      </>
    )

    const buttons = [...container.querySelectorAll('button')]
    const panels = [...container.querySelectorAll<HTMLElement>('[popover]')]

    await waitFor(() => {
      expect(buttons[0].style.getPropertyValue('anchor-name')).not.toBe('')
    })

    const firstAnchor = buttons[0].style.getPropertyValue('anchor-name')
    const secondAnchor = buttons[1].style.getPropertyValue('anchor-name')

    expect(panels[0].style.getPropertyValue('position-anchor')).toBe(
      firstAnchor
    )
    expect(panels[1].style.getPropertyValue('position-anchor')).toBe(
      secondAnchor
    )
    expect(firstAnchor).not.toBe(secondAnchor)
  })
})
