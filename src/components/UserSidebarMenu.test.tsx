import { fireEvent, render, screen } from '@testing-library/react'
import UserSidebarMenu from './UserSidebarMenu'
import { BrowserRouter } from 'react-router-dom'
import { Models } from '@kittycad/lib'
import { GlobalStateProvider } from './GlobalStateProvider'
import CommandBarProvider from './CommandBar'

type User = Models['User_type']

describe('UserSidebarMenu tests', () => {
  test("Renders user's name and email if available", () => {
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
    }

    render(
      <TestWrap>
        <UserSidebarMenu user={userWellFormed} />
      </TestWrap>
    )

    fireEvent.click(screen.getByTestId('user-sidebar-toggle'))

    expect(screen.getByTestId('username')).toHaveTextContent(
      userWellFormed.name || ''
    )
    expect(screen.getByTestId('email')).toHaveTextContent(userWellFormed.email)
  })

  test("Renders just the user's email if no name is available", () => {
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
    }

    render(
      <TestWrap>
        <UserSidebarMenu user={userNoName} />
      </TestWrap>
    )

    fireEvent.click(screen.getByTestId('user-sidebar-toggle'))

    expect(screen.getByTestId('username')).toHaveTextContent(userNoName.email)
  })

  test('Renders a menu button if no user avatar is available', () => {
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
    }

    render(
      <TestWrap>
        <UserSidebarMenu user={userNoAvatar} />
      </TestWrap>
    )

    expect(screen.getByTestId('user-sidebar-toggle')).toHaveTextContent('Menu')
  })
})

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
