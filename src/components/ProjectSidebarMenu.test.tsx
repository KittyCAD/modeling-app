import { fireEvent, render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import ProjectSidebarMenu from './ProjectSidebarMenu'
import { ProjectWithEntryPointMetadata } from '../Router'
import { GlobalStateProvider } from './GlobalStateProvider'
import CommandBarProvider from './CommandBar'

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
  entrypoint_metadata: {
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
          <GlobalStateProvider>
            <ProjectSidebarMenu project={projectWellFormed} />
          </GlobalStateProvider>
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
          <GlobalStateProvider>
            <ProjectSidebarMenu />
          </GlobalStateProvider>
        </CommandBarProvider>
      </BrowserRouter>
    )

    fireEvent.click(screen.getByTestId('project-sidebar-toggle'))

    expect(screen.getByTestId('projectName')).toHaveTextContent(
      'KittyCAD Modeling App'
    )
  })

  test('Renders as a link if set to do so', () => {
    render(
      <BrowserRouter>
        <CommandBarProvider>
          <GlobalStateProvider>
            <ProjectSidebarMenu
              project={projectWellFormed}
              renderAsLink={true}
            />
          </GlobalStateProvider>
        </CommandBarProvider>
      </BrowserRouter>
    )

    expect(screen.getByTestId('project-sidebar-link')).toBeInTheDocument()
    expect(screen.getByTestId('project-sidebar-link-name')).toHaveTextContent(
      projectWellFormed.name
    )
  })
})
