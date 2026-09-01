import { ProjectSwitcherPane } from '@src/lib/aiFirstCad/ProjectSwitcherPane'
import { LayoutType } from '@src/lib/layout'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  commandsSend: vi.fn(),
  observedWidth: 500,
  projects: [] as Array<Record<string, unknown>>,
  systemIOSend: vi.fn(),
}))

vi.mock('@src/components/CustomIcon', () => ({
  CustomIcon: ({ name }: { name: string }) => (
    <span data-testid={`icon-${name}`} />
  ),
}))

vi.mock('@src/hooks/useProjectThumbnailUrl', () => ({
  useProjectThumbnailUrl: () => 'blob:project-thumbnail',
}))

vi.mock('@src/components/layout/Panel', () => ({
  LayoutPanel: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  LayoutPanelHeader: () => null,
}))

vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    commands: { send: mocks.commandsSend },
    project: undefined,
    systemIOActor: { send: mocks.systemIOSend },
  }),
  useSingletons: () => ({
    kclManager: { switchedFiles: false },
  }),
}))

vi.mock('@src/machines/systemIO/hooks', () => ({
  useFolders: () => mocks.projects,
}))

vi.mock('@xstate/react', () => ({
  useSelector: () => 'idle',
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

describe('ProjectSwitcherPane', () => {
  beforeEach(() => {
    mocks.commandsSend.mockClear()
    mocks.observedWidth = 500
    mocks.projects = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        private readonly callback: ResizeObserverCallback

        constructor(callback: ResizeObserverCallback) {
          this.callback = callback
        }

        disconnect() {}

        observe(target: Element) {
          this.callback(
            [
              {
                contentRect: { width: mocks.observedWidth },
                target,
              } as ResizeObserverEntry,
            ],
            this
          )
        }

        unobserve() {}
      }
    )
  })

  it('opens the existing create-project command', () => {
    render(
      <ProjectSwitcherPane
        areaConfig={{ hide: () => false }}
        layout={{
          areaType: 'aiProjectSwitcher',
          id: 'ai-projects',
          label: 'Projects',
          type: LayoutType.Simple,
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'New project' }))

    expect(screen.getByRole('heading', { name: 'Projects' })).toBeVisible()
    expect(mocks.commandsSend).toHaveBeenCalledWith({
      type: 'Find and select command',
      data: {
        groupId: 'projects',
        name: 'Create project',
      },
    })
  })

  it('shows the project search field only when requested', () => {
    render(
      <ProjectSwitcherPane
        areaConfig={{ hide: () => false }}
        layout={{
          areaType: 'aiProjectSwitcher',
          id: 'ai-projects',
          label: 'Projects',
          type: LayoutType.Simple,
        }}
      />
    )

    expect(
      screen.queryByRole('searchbox', { name: 'Search projects' })
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Search projects' }))

    expect(
      screen.getByRole('searchbox', { name: 'Search projects' })
    ).toHaveFocus()
  })

  it('shows Home project previews instead of folder icons in a wide pane', () => {
    mocks.projects = [
      {
        children: [],
        default_file: '/projects/demo/main.kcl',
        directory_count: 0,
        kcl_file_count: 1,
        metadata: { modified: 1 },
        name: 'demo',
        path: '/projects/demo',
        readWriteAccess: true,
      },
    ]

    render(
      <ProjectSwitcherPane
        areaConfig={{ hide: () => false }}
        layout={{
          areaType: 'aiProjectSwitcher',
          id: 'ai-projects',
          label: 'Projects',
          type: LayoutType.Simple,
        }}
      />
    )

    expect(screen.getByRole('img', { name: 'Preview of demo' })).toBeVisible()
    expect(screen.queryByTestId('icon-folder')).not.toBeInTheDocument()
  })

  it('keeps previews and wraps names in a narrow pane', () => {
    mocks.observedWidth = 260
    mocks.projects = [
      {
        children: [],
        default_file: '/projects/demo/main.kcl',
        directory_count: 0,
        kcl_file_count: 1,
        metadata: { modified: 1 },
        name: 'a-long-project-name-that-needs-wrapping',
        path: '/projects/demo',
        readWriteAccess: true,
      },
    ]

    render(
      <ProjectSwitcherPane
        areaConfig={{ hide: () => false }}
        layout={{
          areaType: 'aiProjectSwitcher',
          id: 'ai-projects',
          label: 'Projects',
          type: LayoutType.Simple,
        }}
      />
    )

    expect(
      screen.getByRole('img', {
        name: 'Preview of a-long-project-name-that-needs-wrapping',
      })
    ).toBeVisible()
    expect(
      screen.getByText('a-long-project-name-that-needs-wrapping')
    ).toHaveClass('line-clamp-3', 'break-words')
  })

  it('hides previews only when the pane is very narrow', () => {
    mocks.observedWidth = 220
    mocks.projects = [
      {
        children: [],
        default_file: '/projects/demo/main.kcl',
        directory_count: 0,
        kcl_file_count: 1,
        metadata: { modified: 1 },
        name: 'demo',
        path: '/projects/demo',
        readWriteAccess: true,
      },
    ]

    render(
      <ProjectSwitcherPane
        areaConfig={{ hide: () => false }}
        layout={{
          areaType: 'aiProjectSwitcher',
          id: 'ai-projects',
          label: 'Projects',
          type: LayoutType.Simple,
        }}
      />
    )

    expect(screen.queryByRole('img', { name: 'Preview of demo' })).toBeNull()
    expect(screen.getByText('demo')).toBeVisible()
  })
})
