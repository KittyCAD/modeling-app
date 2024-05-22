import { fireEvent, render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import ProjectSidebarMenu from './ProjectSidebarMenu'
import { SettingsAuthProviderJest } from './SettingsAuthProvider'
import { APP_NAME } from 'lib/constants'
import { CommandBarProvider } from './CommandBar/CommandBarProvider'
import { Project } from 'wasm-lib/kcl/bindings/Project'

const now = new Date()
const projectWellFormed = {
  name: 'Simple Box',
  path: '/some/path/Simple Box',
  children: [
    {
      name: 'main.kcl',
      path: '/some/path/Simple Box/main.kcl',
      children: [],
    },
  ],
  metadata: {
    created: now.toISOString(),
    modified: now.toISOString(),
    size: 32,
    accessed: null,
    type: null,
    permission: null,
  },
  kcl_file_count: 1,
  directory_count: 0,
  default_file: '/some/path/Simple Box/main.kcl',
} satisfies Project

describe('ProjectSidebarMenu tests', () => {
  test('Renders the project name', () => {
    render(
      <BrowserRouter>
        <CommandBarProvider>
          <SettingsAuthProviderJest>
            <ProjectSidebarMenu project={projectWellFormed} enableMenu={true} />
          </SettingsAuthProviderJest>
        </CommandBarProvider>
      </BrowserRouter>
    )

    fireEvent.click(screen.getByTestId('project-sidebar-toggle'))

    expect(screen.getByTestId('projectName')).toHaveTextContent(
      projectWellFormed.name
    )
    expect(screen.getByTestId('createdAt')).toHaveTextContent(
      `Created ${now.toLocaleDateString()}`
    )
  })

  test('Renders app name if given no project', () => {
    render(
      <BrowserRouter>
        <CommandBarProvider>
          <SettingsAuthProviderJest>
            <ProjectSidebarMenu enableMenu={true} />
          </SettingsAuthProviderJest>
        </CommandBarProvider>
      </BrowserRouter>
    )

    fireEvent.click(screen.getByTestId('project-sidebar-toggle'))

    expect(screen.getByTestId('projectName')).toHaveTextContent(APP_NAME)
  })

  test('Disables popover menu by default', () => {
    render(
      <BrowserRouter>
        <CommandBarProvider>
          <SettingsAuthProviderJest>
            <ProjectSidebarMenu project={projectWellFormed} />
          </SettingsAuthProviderJest>
        </CommandBarProvider>
      </BrowserRouter>
    )

    expect(screen.getByTestId('project-name')).toHaveTextContent(
      projectWellFormed.name
    )
  })
})
