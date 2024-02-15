import { fireEvent, render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import ProjectSidebarMenu from './ProjectSidebarMenu'
import { type ProjectWithEntryPointMetadata } from 'lib/types'
import { SettingsAuthStateProvider } from './SettingsAuthStateProvider'
import CommandBarProvider from './CommandBar/CommandBar'
import { APP_NAME } from 'lib/constants'

const now = new Date()
const projectWellFormed = {
  name: 'Simple Box',
  path: '/some/path/Simple Box',
  children: [
    {
      name: 'main.kcl',
      path: '/some/path/Simple Box/main.kcl',
    },
  ],
  entrypointMetadata: {
    accessedAt: now,
    blksize: 32,
    blocks: 32,
    createdAt: now,
    dev: 1,
    gid: 1,
    ino: 1,
    isDir: false,
    isFile: true,
    isSymlink: false,
    mode: 1,
    modifiedAt: now,
    nlink: 1,
    permissions: { readonly: false, mode: 1 },
    rdev: 1,
    size: 32,
    uid: 1,
  },
} satisfies ProjectWithEntryPointMetadata

describe('ProjectSidebarMenu tests', () => {
  test('Renders the project name', () => {
    render(
      <BrowserRouter>
        <CommandBarProvider>
          <SettingsAuthStateProvider>
            <ProjectSidebarMenu project={projectWellFormed} />
          </SettingsAuthStateProvider>
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
          <SettingsAuthStateProvider>
            <ProjectSidebarMenu />
          </SettingsAuthStateProvider>
        </CommandBarProvider>
      </BrowserRouter>
    )

    fireEvent.click(screen.getByTestId('project-sidebar-toggle'))

    expect(screen.getByTestId('projectName')).toHaveTextContent(APP_NAME)
  })

  test('Renders as a link if set to do so', () => {
    render(
      <BrowserRouter>
        <CommandBarProvider>
          <SettingsAuthStateProvider>
            <ProjectSidebarMenu
              project={projectWellFormed}
              renderAsLink={true}
            />
          </SettingsAuthStateProvider>
        </CommandBarProvider>
      </BrowserRouter>
    )

    expect(screen.getByTestId('project-sidebar-link')).toBeInTheDocument()
    expect(screen.getByTestId('project-sidebar-link-name')).toHaveTextContent(
      projectWellFormed.name
    )
  })
})
