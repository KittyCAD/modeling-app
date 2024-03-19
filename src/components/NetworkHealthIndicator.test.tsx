import { fireEvent, render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { SettingsAuthProviderJest } from './SettingsAuthProvider'
import { CommandBarProvider } from './CommandBar/CommandBarProvider'
import {
  NETWORK_HEALTH_TEXT,
  NetworkHealthIndicator,
  NetworkHealthState,
} from './NetworkHealthIndicator'

function TestWrap({ children }: { children: React.ReactNode }) {
  // wrap in router and xState context
  return (
    <BrowserRouter>
      <CommandBarProvider>
        <SettingsAuthProviderJest>{children}</SettingsAuthProviderJest>
      </CommandBarProvider>
    </BrowserRouter>
  )
}

describe('NetworkHealthIndicator tests', () => {
  test('Renders the network indicator', () => {
    render(
      <TestWrap>
        <NetworkHealthIndicator />
      </TestWrap>
    )

    fireEvent.click(screen.getByTestId('network-toggle'))

    expect(screen.getByTestId('network')).toHaveTextContent(
      NETWORK_HEALTH_TEXT[NetworkHealthState.Issue]
    )
  })

  test('Responds to network changes', () => {
    render(
      <TestWrap>
        <NetworkHealthIndicator />
      </TestWrap>
    )

    fireEvent.offline(window)
    fireEvent.click(screen.getByTestId('network-toggle'))

    expect(screen.getByTestId('network')).toHaveTextContent(
      NETWORK_HEALTH_TEXT[NetworkHealthState.Disconnected]
    )
  })
})
