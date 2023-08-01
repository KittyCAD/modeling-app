import { fireEvent, render, screen } from '@testing-library/react'
import { User } from '../useStore'
import UserSidebarMenu from './UserSidebarMenu'
import { BrowserRouter } from 'react-router-dom'

it("Renders user's name and email if available", () => {
  const userWellFormed: User = {
    id: '8675309',
    name: 'Test User',
    email: 'test@mctesterson.ai',
    image: 'https://placekitten.com/200/200',
    created_at: 'yesteryear',
    updated_at: 'today',
  }

  render(
    <BrowserRouter>
      <UserSidebarMenu user={userWellFormed} />
    </BrowserRouter>
  )

  fireEvent.click(screen.getByTestId('user-sidebar-toggle'))

  expect(screen.getByTestId('username')).toHaveTextContent(
    userWellFormed.name || ''
  )
  expect(screen.getByTestId('email')).toHaveTextContent(userWellFormed.email)
})

it("Renders just the user's email if no name is available", () => {
  const userNoName: User = {
    id: '8675309',
    email: 'test@mctesterson.ai',
    image: 'https://placekitten.com/200/200',
    created_at: 'yesteryear',
    updated_at: 'today',
  }

  render(
    <BrowserRouter>
      <UserSidebarMenu user={userNoName} />
    </BrowserRouter>
  )

  fireEvent.click(screen.getByTestId('user-sidebar-toggle'))

  expect(screen.getByTestId('username')).toHaveTextContent(userNoName.email)
})

it('Renders a menu button if no user avatar is available', () => {
  const userNoAvatar: User = {
    id: '8675309',
    name: 'Test User',
    email: 'test@mctesterson.ai',
    created_at: 'yesteryear',
    updated_at: 'today',
  }

  render(
    <BrowserRouter>
      <UserSidebarMenu user={userNoAvatar} />
    </BrowserRouter>
  )

  expect(screen.getByTestId('user-sidebar-toggle')).toHaveTextContent('Menu')
})
