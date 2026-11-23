import Tooltip from '@src/components/Tooltip'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => vi.restoreAllMocks())

it('opens from its trigger, dismisses on mouse leave and activation, and releases listeners', () => {
  const show = vi.spyOn(HTMLElement.prototype, 'showPopover').mockClear()
  const hide = vi.spyOn(HTMLElement.prototype, 'hidePopover').mockClear()
  const mounted = render(
    <button type="button">
      Start sketch
      <Tooltip>Choose a plane</Tooltip>
    </button>
  )
  const trigger = screen.getByRole('button', { name: /Start sketch/ })
  const tooltip = screen.getByRole('tooltip')

  fireEvent.mouseEnter(trigger)
  expect(show).toHaveBeenCalledWith({ source: trigger })
  expect(show.mock.contexts[0]).toBe(tooltip)
  fireEvent.mouseLeave(trigger)
  expect(hide).toHaveBeenCalledTimes(1)
  fireEvent.focus(trigger)
  expect(show).toHaveBeenCalledTimes(2)
  fireEvent.click(trigger)
  expect(hide).toHaveBeenCalledTimes(2)
  expect(hide.mock.contexts[1]).toBe(tooltip)

  mounted.unmount()
  fireEvent.mouseEnter(trigger)
  fireEvent.click(trigger)
  expect(show).toHaveBeenCalledTimes(2)
  expect(hide).toHaveBeenCalledTimes(2)
})
