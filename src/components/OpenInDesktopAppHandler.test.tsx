import { fireEvent, render, screen } from '@testing-library/react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

import { OpenInDesktopAppHandler } from './OpenInDesktopAppHandler'

/**
 * The behavior under test requires a router,
 * so we wrap the component in a minimal router setup.
 */
function TestingMinimalRouterWrapper({
  children,
  location,
}: {
  location?: string
  children: React.ReactNode
}) {
  return (
    <Routes location={location}>
      <Route
        path="/"
        element={<OpenInDesktopAppHandler>{children}</OpenInDesktopAppHandler>}
      />
    </Routes>
  )
}

describe('OpenInDesktopAppHandler tests', () => {
  test(`does not render the modal if no query param is present`, () => {
    render(
      <BrowserRouter>
        <TestingMinimalRouterWrapper>
          <p>Dummy app contents</p>
        </TestingMinimalRouterWrapper>
      </BrowserRouter>
    )

    const dummyAppContents = screen.getByText('Dummy app contents')
    const modalContents = screen.queryByText('Open in desktop app')

    expect(dummyAppContents).toBeInTheDocument()
    expect(modalContents).not.toBeInTheDocument()
  })

  test(`renders the modal if the query param is present`, () => {
    render(
      <BrowserRouter>
        <TestingMinimalRouterWrapper location="/?ask-open-desktop">
          <p>Dummy app contents</p>
        </TestingMinimalRouterWrapper>
      </BrowserRouter>
    )

    let dummyAppContents = screen.queryByText('Dummy app contents')
    let modalButton = screen.queryByText('Continue to web app')

    // Starts as disconnected
    expect(dummyAppContents).not.toBeInTheDocument()
    expect(modalButton).not.toBeFalsy()
    expect(modalButton).toBeInTheDocument()
    fireEvent.click(modalButton as Element)

    // I don't like that you have to re-query the screen here
    dummyAppContents = screen.queryByText('Dummy app contents')
    modalButton = screen.queryByText('Continue to web app')

    expect(dummyAppContents).toBeInTheDocument()
    expect(modalButton).not.toBeInTheDocument()
  })
})
