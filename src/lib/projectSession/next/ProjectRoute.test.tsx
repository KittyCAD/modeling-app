import { signal } from '@preact/signals-core'
import type { Project } from '@src/lib/projectData'
import type { OpenProjectSession } from '@src/lib/projectSession/next/contract'
import { ProjectRoute } from '@src/lib/projectSession/next/ProjectRoute'
import { ProjectView } from '@src/lib/projectSession/next/ProjectView'
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const registry = vi.hoisted(() => ({ get: vi.fn() }))
// No singleton/editor capability is available to this route.
vi.mock('@src/lib/boot', () => ({ useApp: () => ({ registry }) }))

function createSession(
  title: string,
  children: Project['contents']['children'] = []
): OpenProjectSession {
  return {
    signal: new AbortController().signal,
    project: signal({
      contents: { name: title, path: `/projects/${title}`, children },
      metadata: { title, readWriteAccess: false },
    }),
    files: { read: vi.fn(), write: vi.fn() },
  }
}

describe('project screen', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  it('shows the captured project without accessing file or editor services', () => {
    const session = createSession('Bracket', [
      { name: 'main.kcl', path: '/projects/Bracket/main.kcl', children: null },
      { name: 'parts', path: '/projects/Bracket/parts', children: [] },
    ])
    render(
      <MemoryRouter>
        <ProjectView session={session} />
      </MemoryRouter>
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'Bracket' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Project files' })
    ).toHaveTextContent('main.kcl')
    expect(screen.getByText('parts/')).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toHaveTextContent(
      '/projects/Bracket'
    )
    expect(screen.getByText('Read-only')).toBeInTheDocument()
    expect(
      screen.getByText('No editor is executing for this project.')
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute(
      'href',
      '/home'
    )
    expect(session.files.read).not.toHaveBeenCalled()
    expect(session.files.write).not.toHaveBeenCalled()
    expect(registry.get).not.toHaveBeenCalled()
  })

  it('shows an empty folder and follows the project session selection', () => {
    const first = createSession('First')
    const second = createSession('Second')
    const currentSession = signal<OpenProjectSession | undefined>(first)
    registry.get.mockReturnValue({ currentSession })
    render(
      <MemoryRouter>
        <ProjectRoute />
      </MemoryRouter>
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'First' })
    ).toBeInTheDocument()
    expect(screen.getByText('No files in this project.')).toBeInTheDocument()
    act(() => {
      currentSession.value = second
    })
    expect(
      screen.getByRole('heading', { level: 1, name: 'Second' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { level: 1, name: 'First' })
    ).not.toBeInTheDocument()
  })
})
