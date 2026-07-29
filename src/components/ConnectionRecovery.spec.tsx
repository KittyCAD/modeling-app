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
  expect(screen.getByRole('separator')).toBeInTheDocument()
  expect(
    screen.getByRole('link', {
      name: 'the problem may be on our side',
    })
  ).toHaveAttribute('href', ZOO_STATUS_URL)
  expect(
    screen.queryByRole('button', { name: /clear chat/i })
  ).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: /reconnect/i }))

  expect(onReconnect).toHaveBeenCalledTimes(1)
})

test('ConnectionRecovery accepts contextual recovery copy', () => {
  render(
    <ConnectionRecovery
      title="No internet connection."
      description="Check your network connection, then try again."
      onReconnect={() => {}}
    />
  )

  expect(screen.getByTestId('connection-recovery')).toHaveTextContent(
    'No internet connection.'
  )
  expect(screen.getByTestId('connection-recovery')).toHaveTextContent(
    'Check your network connection, then try again.'
  )
  expect(
    screen.queryByRole('link', { name: 'the problem may be on our side' })
  ).not.toBeInTheDocument()
})

test('ConnectionRecovery disables reconnecting when requested', () => {
  const onReconnect = vi.fn()

  render(
    <ConnectionRecovery onReconnect={onReconnect} reconnectDisabled={true} />
  )

  const reconnectButton = screen.getByRole('button', { name: /reconnect/i })
  expect(reconnectButton).toBeDisabled()
  fireEvent.click(reconnectButton)
  expect(onReconnect).not.toHaveBeenCalled()
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
