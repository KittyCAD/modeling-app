import { fireEvent, render, screen } from '@testing-library/react'
import { NetworkHealthState } from 'hooks/useNetworkStatus'
import { BrowserRouter } from 'react-router-dom'

import {
  NETWORK_HEALTH_TEXT,
  NetworkHealthIndicator,
} from './NetworkHealthIndicator'

function TestWrap({ children }: { children: React.ReactNode }) {
  // wrap in router and xState context
  return <BrowserRouter>{children}</BrowserRouter>
}

// Our Playwright tests for this are much more comprehensive.
describe('NetworkHealthIndicator tests', () => {
  test('Renders the network indicator', () => {
    render(
      <TestWrap>
        <NetworkHealthIndicator />
      </TestWrap>
    )

    fireEvent.click(screen.getByTestId('network-toggle'))

    // Starts as disconnected
    expect(screen.getByTestId('network')).toHaveTextContent(
      NETWORK_HEALTH_TEXT[NetworkHealthState.Disconnected]
    )
  })
})
