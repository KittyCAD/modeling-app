import { ContextMenu } from '@src/components/ContextMenu'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { expect, test, vi } from 'vitest'

const Harness = ({
  disabled,
  event = 'contextmenu',
  guard,
  callback,
}: {
  disabled: boolean
  event?: 'contextmenu' | 'mouseup'
  guard?: (event: MouseEvent) => boolean
  callback?: (event: MouseEvent) => void
}) => {
  const target = useRef<HTMLDivElement>(null)

  return (
    <>
      <div ref={target} data-testid="context-menu-target" />
      <ContextMenu
        disabled={disabled}
        event={event}
        guard={guard}
        callback={callback}
        menuTargetElement={target}
        items={[
          <button key="item" autoFocus={true}>
            Menu item
          </button>,
        ]}
      />
    </>
  )
}

test('closes and blocks a context menu when disabled', async () => {
  const { rerender } = render(<Harness disabled={false} />)
  const target = screen.getByTestId('context-menu-target')

  fireEvent.contextMenu(target)
  expect(screen.getByText('Menu item')).toBeVisible()
  await waitFor(() => expect(screen.getByText('Menu item')).toHaveFocus())

  rerender(<Harness disabled={true} />)
  expect(screen.queryByText('Menu item')).not.toBeInTheDocument()

  fireEvent.contextMenu(target)
  expect(screen.queryByText('Menu item')).not.toBeInTheDocument()
})

test('does not consume disabled events rejected by the guard', () => {
  const callback = vi.fn()
  render(
    <Harness
      disabled={true}
      event="mouseup"
      guard={() => false}
      callback={callback}
    />
  )
  const event = new MouseEvent('mouseup', {
    bubbles: true,
    cancelable: true,
  })

  screen.getByTestId('context-menu-target').dispatchEvent(event)

  expect(event.defaultPrevented).toBe(false)
  expect(callback).not.toHaveBeenCalled()
})
