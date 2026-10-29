import { fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { OpenInDesktopAppHandler } from '@src/components/OpenInDesktopAppHandler'
import { describe, expect, test } from 'vitest'

function renderHandoff(location: string) {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <OpenInDesktopAppHandler>
            <p>App contents</p>
          </OpenInDesktopAppHandler>
        ),
      },
    ],
    { initialEntries: [location] }
  )
  render(<RouterProvider router={router} />)
  return router
}

describe('OpenInDesktopAppHandler', () => {
  test('shows app contents without ASK', () => {
    renderHandoff('/home')
    expect(screen.getByText('App contents')).toBeInTheDocument()
    expect(screen.queryByText('Continue to web app')).not.toBeInTheDocument()
  })

  test.each(['', '=false', '=0'])('ASK%s shows the same chooser', (value) => {
    renderHandoff(`/home?ask-open-desktop${value}`)
    expect(screen.queryByText('App contents')).not.toBeInTheDocument()
    expect(screen.getByText('Continue to web app')).toBeInTheDocument()
  })

  test('Continue removes only ASK and retains the current route and fragment', async () => {
    const router = renderHandoff(
      '/home?ask-open-desktop=false&project-id=p&code=a%2Bb%3D&retained=x%26y#details'
    )
    fireEvent.click(screen.getByRole('button', { name: /Continue to web app/ }))
    await screen.findByText('App contents')
    expect(router.state.location).toMatchObject({
      pathname: '/home',
      search: '?project-id=p&code=a%2Bb%3D&retained=x%26y',
      hash: '#details',
    })
    expect(screen.queryByText('Continue to web app')).not.toBeInTheDocument()
  })
})
