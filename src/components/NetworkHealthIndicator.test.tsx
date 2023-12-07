import { fireEvent, render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { GlobalStateProvider } from './GlobalStateProvider'
import CommandBarProvider from './CommandBar'
import {
  NETWORK_CONTENT,
  NetworkHealthIndicator,
} from './NetworkHealthIndicator'

function TestWrap({ children }: { children: React.ReactNode }) {
  // wrap in router and xState context
  return (
    <BrowserRouter>
      <CommandBarProvider>
        <GlobalStateProvider>{children}</GlobalStateProvider>
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

    expect(screen.getByTestId('network-good')).toHaveTextContent(
      NETWORK_CONTENT.good
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

    expect(screen.getByTestId('network-bad')).toHaveTextContent(
      NETWORK_CONTENT.bad
    )
  })
})
