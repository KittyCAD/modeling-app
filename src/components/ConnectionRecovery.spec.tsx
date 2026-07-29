import {
  ConnectionRecovery,
  DIAGNOSING_NETWORK_ISSUES_URL,
} from '@src/components/ConnectionRecovery'
import Loading from '@src/components/Loading'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

test('ConnectionRecovery shows the shared recovery UI and reconnects', () => {
  const onReconnect = vi.fn()

  render(<ConnectionRecovery onReconnect={onReconnect} />)

  expect(screen.getByRole('alert')).toHaveTextContent('Failed to connect.')
  expect(screen.getByRole('alert')).toHaveTextContent(
    'diagnosing network connection issues'
  )
  expect(
    screen.getByRole('link', {
      name: 'diagnosing network connection issues',
    })
  ).toHaveAttribute('href', DIAGNOSING_NETWORK_ISSUES_URL)
  expect(
    screen.queryByRole('button', { name: /clear chat/i })
  ).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: /reconnect/i }))

  expect(onReconnect).toHaveBeenCalledTimes(1)
})

test('ConnectionRecovery accepts a contextual title', () => {
  render(
    <ConnectionRecovery
      title="No internet connection."
      onReconnect={() => {}}
    />
  )

  expect(screen.getByTestId('connection-recovery')).toHaveTextContent(
    'No internet connection.'
  )
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
