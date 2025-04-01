import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import UserSidebarMenu from './UserSidebarMenu'
import {
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
} from 'react-router-dom'
import { Models } from '@kittycad/lib'

type User = Models['User_type']

describe('UserSidebarMenu tests', () => {
  test("Renders user's name and email if available", async () => {
    const userWellFormed: User = {
      id: '8675309',
      name: 'Test User',
      email: 'kittycad.sidebar.test@example.com',
      image: 'https://placekitten.com/200/200',
      created_at: 'yesteryear',
      updated_at: 'today',
      company: 'Test Company',
      discord: 'Test User#1234',
      github: 'testuser',
      phone: '555-555-5555',
      first_name: 'Test',
      last_name: 'User',
      can_train_on_data: false,
      is_service_account: false,
    }

    render(
      <TestWrap>
        <UserSidebarMenu user={userWellFormed} />
      </TestWrap>
    )

    fireEvent.click(screen.getByTestId('user-sidebar-toggle'))

    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent(
        userWellFormed.name || ''
      )
    })
    await waitFor(() => {
      expect(screen.getByTestId('email')).toHaveTextContent(
        userWellFormed.email
      )
    })
  })

  test("Renders just the user's email if no name is available", async () => {
    const userNoName: User = {
      id: '8675309',
      email: 'kittycad.sidebar.test@example.com',
      image: 'https://placekitten.com/200/200',
      created_at: 'yesteryear',
      updated_at: 'today',
      company: 'Test Company',
      discord: 'Test User#1234',
      github: 'testuser',
      phone: '555-555-5555',
      first_name: '',
      last_name: '',
      name: '',
      can_train_on_data: false,
      is_service_account: false,
    }

    render(
      <TestWrap>
        <UserSidebarMenu user={userNoName} />
      </TestWrap>
    )

    fireEvent.click(screen.getByTestId('user-sidebar-toggle'))

    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent(userNoName.email)
    })
  })

  test('Renders a menu button if no user avatar is available', async () => {
    const userNoAvatar: User = {
      id: '8675309',
      name: 'Test User',
      email: 'kittycad.sidebar.test@example.com',
      created_at: 'yesteryear',
      updated_at: 'today',
      company: 'Test Company',
      discord: 'Test User#1234',
      github: 'testuser',
      phone: '555-555-5555',
      first_name: 'Test',
      last_name: 'User',
      image: '',
      can_train_on_data: false,
      is_service_account: false,
    }

    render(
      <TestWrap>
        <UserSidebarMenu user={userNoAvatar} />
      </TestWrap>
    )

    await waitFor(() => {
      expect(screen.getByTestId('user-sidebar-toggle')).toHaveTextContent(
        'User menu'
      )
    })
  })
})

function TestWrap({ children }: { children: React.ReactNode }) {
  // wrap in router and xState context
  // We have to use a memory router in the testing environment,
  // and we have to use the createMemoryRouter function instead of <MemoryRouter /> as of react-router v6.4:
  // https://reactrouter.com/en/6.16.0/routers/picking-a-router#using-v64-data-apis
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route path="/file/:id" element={<>{children}</>} />
    ),
    {
      initialEntries: ['/file/new'],
      initialIndex: 0,
    }
  )
  return <RouterProvider router={router} />
}
