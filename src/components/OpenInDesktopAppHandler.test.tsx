import { fireEvent, render, screen } from '@testing-library/react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { OpenInDesktopAppHandler } from './OpenInDesktopAppHandler'

function TestWrap({
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
        <TestWrap>
          <p>Dummy app contents</p>
        </TestWrap>
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
        <TestWrap location="/?askToOpenInDesktop">
          <p>Dummy app contents</p>
        </TestWrap>
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
