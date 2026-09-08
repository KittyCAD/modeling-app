import { forwardRef, useRef } from 'react'
import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { ToolbarDropdownPanel } from '@src/components/ToolbarDropdownPanel'

const mocks = vi.hoisted(() => ({
  reportClientError: vi.fn(async () => {}),
}))

vi.mock('@src/lib/clientErrors', () => ({
  ClientErrorCode: {
    ToolbarDropdownAnchorPositioningError:
      'toolbar_dropdown_anchor_positioning_error',
  },
  reportClientError: mocks.reportClientError,
}))

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
      <button
        ref={buttonRef}
        type="button"
        data-onboarding-id={`${label.toLowerCase()}-dropdown-button`}
      >
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
    vi.clearAllMocks()
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
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        return this.tagName === 'BUTTON'
          ? new DOMRect(100, 100, 40, 30)
          : new DOMRect(20, 146, 200, 100)
      }
    )

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
    expect(mocks.reportClientError).not.toHaveBeenCalled()
  })

  test('falls back to trigger geometry when native anchoring does not resolve', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        return this.tagName === 'BUTTON'
          ? new DOMRect(520, 120, 40, 30)
          : new DOMRect(0, 0, 200, 100)
      }
    )

    const { container } = render(<Dropdown label="Tools" />)
    const panel = container.querySelector<HTMLElement>('[popover]')

    expect(panel).not.toBeNull()
    if (!panel) return

    await waitFor(() => {
      expect(panel.style.position).toBe('fixed')
    })

    expect(panel.style.left).toBe('440px')
    expect(panel.style.top).toBe('166px')
    expect(mocks.reportClientError).toHaveBeenCalledWith({
      code: 'toolbar_dropdown_anchor_positioning_error',
      errorName: 'ToolbarDropdownAnchorPositioningError',
      message: 'Toolbar dropdown CSS anchor positioning did not resolve.',
      dedupeKey: 'ToolbarDropdownPanel:unresolved-css-anchor',
      extra: expect.objectContaining({
        source: 'ToolbarDropdownPanel',
        buttonRect: {
          height: 30,
          left: 520,
          top: 120,
          width: 40,
        },
        panelRect: {
          height: 100,
          left: 0,
          top: 0,
          width: 200,
        },
        cssSupport: {
          anchorName: true,
          positionAnchor: true,
          anchorFunction: true,
        },
        computedAnchorStyles: expect.objectContaining({
          buttonAnchorNameSet: true,
          panelPositionAnchorSet: true,
          anchorNamesMatch: true,
        }),
        triggerOnboardingId: 'tools-dropdown-button',
        viewport: expect.objectContaining({
          devicePixelRatio: window.devicePixelRatio,
          height: window.innerHeight,
          width: window.innerWidth,
        }),
      }),
    })
  })
})
