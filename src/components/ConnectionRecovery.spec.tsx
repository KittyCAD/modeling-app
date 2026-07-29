import {
  ConnectionRecovery,
  ZOO_STATUS_URL,
} from '@src/components/ConnectionRecovery'
import Loading from '@src/components/Loading'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

test('ConnectionRecovery shows the shared recovery UI and reconnects', () => {
  const onReconnect = vi.fn()

  render(<ConnectionRecovery onReconnect={onReconnect} />)

  expect(
    screen.getByRole('heading', { name: 'Failed to connect.' })
  ).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Click below to try again. If it persists, the problem may be on our side.'
  )
  expect(
    screen
      .getByTestId('connection-recovery')
      .querySelector('svg[aria-label="close"]')
  ).toHaveClass('h-8', 'w-8')
  expect(screen.getByRole('separator')).toBeInTheDocument()
  const statusLink = screen.getByRole('link', {
    name: 'the problem may be on our side',
  })
  expect(statusLink).toHaveAttribute('href', ZOO_STATUS_URL)

  fireEvent.click(screen.getByRole('button', { name: /reconnect/i }))

  expect(onReconnect).toHaveBeenCalledTimes(1)
})

test('Loading uses ConnectionRecovery for Engine manual reconnects', () => {
  const onReconnect = vi.fn()

  render(
    <Loading
      showManualConnect={true}
      callback={onReconnect}
      dataTestId="loading-engine"
    />
  )

  expect(screen.getByTestId('loading-engine')).toHaveTextContent(
    'Failed to connect.'
  )
  fireEvent.click(screen.getByRole('button', { name: /reconnect/i }))
  expect(onReconnect).toHaveBeenCalledTimes(1)
})
