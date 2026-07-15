import { Registry } from '@kittycad/registry'
import ProjectSidebarMenu from '@src/components/ProjectSidebarMenu'
import type { App } from '@src/lib/app'
import type { Project } from '@src/lib/project'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createActor, createMachine } from 'xstate'
import projectExplorerExtension from '.'

const originalElectron = window.electron

afterEach(() => {
  window.electron = originalElectron
  vi.restoreAllMocks()
})

const now = Date.now()
const projectWellFormed = {
  name: '550e8400-e29b-41d4-a716-446655440000',
  title: 'Simple Box',
  path: '/some/path/550e8400-e29b-41d4-a716-446655440000',
  children: [
    {
      name: 'main.kcl',
      path: '/some/path/550e8400-e29b-41d4-a716-446655440000/main.kcl',
      children: [],
    },
  ],
  readAccess: true,
  readWriteAccess: true,
  metadata: {
    created: now,
    modified: now,
    size: 32,
    accessed: null,
    type: null,
    permission: null,
  },
  kcl_file_count: 1,
  directory_count: 0,
  default_file: '/some/path/550e8400-e29b-41d4-a716-446655440000/main.kcl',
} satisfies Project

function renderWithRouter(children: ReactNode) {
  return render(<BrowserRouter>{children}</BrowserRouter>)
}

function createProjectMenuApp(canWriteProjectDirectory = true) {
  const registry = new Registry()
  registry.configure([projectExplorerExtension])
  const commandsActor = createActor(
    createMachine({
      context: {
        commands: [
          {
            name: 'Duplicate project',
            groupId: 'projects',
          },
        ],
      },
    })
  ).start()
  const systemIOActor = createActor(
    createMachine({
      context: {
        canReadWriteProjectDirectory: {
          value: canWriteProjectDirectory,
          error: undefined,
        },
      },
    })
  ).start()

  return {
    app: {
      machineManager: {
        machines: [],
      },
      commands: {
        actor: commandsActor,
        send: vi.fn(),
      },
      systemIOActor,
      settings: {
        actor: {},
        useSettings: () => ({
          app: {
            machineApi: {
              current: false,
            },
          },
        }),
      },
      registry,
    } as unknown as App,
    dispose: () => {
      commandsActor.stop()
      systemIOActor.stop()
      registry[Symbol.dispose]()
    },
  }
}

describe('project explorer project menu', () => {
  test('opens the duplicate project command for the current project', async () => {
    const { app, dispose } = createProjectMenuApp()

    try {
      renderWithRouter(
        <ProjectSidebarMenu app={app} enableMenu project={projectWellFormed} />
      )

      fireEvent.click(screen.getByTestId('project-sidebar-toggle'))
      const duplicateButton = (
        await screen.findByTestId('project-sidebar-duplicate-project')
      ).closest('button')

      expect(duplicateButton).toHaveAttribute('tabindex', '0')
      if (!duplicateButton) {
        return
      }
      fireEvent.click(duplicateButton)

      expect(app.commands.send).toHaveBeenCalledWith({
        type: 'Find and select command',
        data: {
          groupId: 'projects',
          name: 'Duplicate project',
          argDefaultValues: {
            name: projectWellFormed.name,
            newName: projectWellFormed.title,
          },
        },
      })
    } finally {
      dispose()
    }
  })

  test('allows a readable read-only project to be duplicated', async () => {
    const { app, dispose } = createProjectMenuApp()
    const readOnlyProject = {
      ...projectWellFormed,
      readAccess: true,
      readWriteAccess: false,
    }

    try {
      renderWithRouter(
        <ProjectSidebarMenu app={app} enableMenu project={readOnlyProject} />
      )

      fireEvent.click(screen.getByTestId('project-sidebar-toggle'))
      const duplicateButton = (
        await screen.findByTestId('project-sidebar-duplicate-project')
      ).closest('button')

      expect(duplicateButton).toBeEnabled()
      if (!duplicateButton) {
        return
      }
      fireEvent.click(duplicateButton)
      expect(app.commands.send).toHaveBeenCalledWith({
        type: 'Find and select command',
        data: {
          groupId: 'projects',
          name: 'Duplicate project',
          argDefaultValues: {
            name: readOnlyProject.name,
            newName: readOnlyProject.title,
          },
        },
      })
    } finally {
      dispose()
    }
  })

  test.each([
    {
      description: 'the source is unreadable',
      project: {
        ...projectWellFormed,
        readAccess: false,
        readWriteAccess: false,
      },
      canWriteProjectDirectory: true,
    },
    {
      description: 'the destination directory is not writable',
      project: projectWellFormed,
      canWriteProjectDirectory: false,
    },
  ])(
    'disables duplication when $description',
    async ({ project, canWriteProjectDirectory }) => {
      const { app, dispose } = createProjectMenuApp(canWriteProjectDirectory)

      try {
        renderWithRouter(
          <ProjectSidebarMenu app={app} enableMenu project={project} />
        )

        fireEvent.click(screen.getByTestId('project-sidebar-toggle'))
        const duplicateButton = (
          await screen.findByTestId('project-sidebar-duplicate-project')
        ).closest('button')

        expect(duplicateButton).toBeDisabled()
      } finally {
        dispose()
      }
    }
  )

  test('reveals the current project from the contributed menu item on desktop', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Electron')
    const showInFolder = vi.fn()
    window.electron = {
      showInFolder,
      platform: 'darwin',
      os: {
        isMac: false,
      },
    } as unknown as Window['electron']
    const { app, dispose } = createProjectMenuApp()

    try {
      renderWithRouter(
        <ProjectSidebarMenu app={app} enableMenu project={projectWellFormed} />
      )

      fireEvent.click(screen.getByTestId('project-sidebar-toggle'))
      fireEvent.click(
        await screen.findByTestId('project-sidebar-reveal-in-file-explorer')
      )

      expect(showInFolder).toHaveBeenCalledWith(projectWellFormed.path)
    } finally {
      dispose()
    }
  })
})
