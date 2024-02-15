import { fireEvent, render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { SettingsAuthStateProvider } from './SettingsAuthStateProvider'
import CommandBarProvider from './CommandBar/CommandBar'
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
        <SettingsAuthStateProvider>{children}</SettingsAuthStateProvider>
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
      NETWORK_HEALTH_TEXT[NetworkHealthState.Ok]
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
