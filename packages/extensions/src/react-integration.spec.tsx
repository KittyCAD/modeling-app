import { useSignals } from '@preact/signals-react/runtime'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  analyticsToggleService,
  createExampleContainer,
  notesPanelSignal,
  searchService,
  toolbarSignal,
  workspaceToggleService,
} from './examples/app'
import type { ExtensionContainer } from './container'

function Toolbar({ container }: { container: ExtensionContainer }) {
  useSignals()
  const items = container.signal(toolbarSignal).value

  return (
    <div>
      {items.map((item) => (
        <button key={item.id} onClick={item.run}>
          {item.label}
        </button>
      ))}
    </div>
  )
}

function SearchQuery({ container }: { container: ExtensionContainer }) {
  useSignals()
  const search = container.get(searchService)

  return (
    <div>
      <span data-testid="query">{search.query.value || 'empty'}</span>
      <button onClick={() => search.setQuery('react')}>Set Query</button>
    </div>
  )
}

function WorkspaceToggle({ container }: { container: ExtensionContainer }) {
  useSignals()
  const workspaceToggle = container.get(workspaceToggleService)

  return (
    <div>
      <span data-testid="workspace-active">
        {workspaceToggle.active.value ? 'active' : 'inactive'}
      </span>
      <button onClick={() => workspaceToggle.toggle()}>Toggle Workspace</button>
    </div>
  )
}

function AnalyticsToggle({
  container,
}: {
  container: ExtensionContainer
}) {
  useSignals()
  const analyticsToggle = container.get(analyticsToggleService)

  return (
    <div>
      <span data-testid="analytics-active">
        {analyticsToggle.active.value ? 'active' : 'inactive'}
      </span>
      <button onClick={() => analyticsToggle.toggle()}>Toggle Analytics</button>
    </div>
  )
}

function NotesPanel({ container }: { container: ExtensionContainer }) {
  useSignals()
  const items = container.signal(notesPanelSignal).value

  return (
    <div>
      {items.length === 0 ? (
        <span data-testid="notes-empty">No notes</span>
      ) : (
        items.map((item) => <div key={item.id}>{item.label}</div>)
      )}
    </div>
  )
}

describe('React integration', () => {
  it('renders toolbar items from extension signals', () => {
    const container = createExampleContainer()

    render(<Toolbar container={container} />)

    expect(screen.getByText('Workspace: Personal')).toBeInTheDocument()
    expect(screen.getByText('Enable Team Workspace')).toBeInTheDocument()
    expect(screen.getByText('Open Search')).toBeInTheDocument()
    expect(screen.getByText('Search Idle')).toBeInTheDocument()
  })

  it('updates React UI when service-backed signals change', async () => {
    const container = createExampleContainer()

    render(
      <>
        <Toolbar container={container} />
        <SearchQuery container={container} />
      </>
    )

    fireEvent.click(screen.getByText('Set Query'))

    expect(screen.getByTestId('query')).toHaveTextContent('react')
    expect(screen.getByText('Searching: react')).toBeInTheDocument()
  })

  it('updates when a signal contribution triggers service state changes', async () => {
    const container = createExampleContainer()

    render(<Toolbar container={container} />)

    fireEvent.click(screen.getByText('Open Search'))

    expect(screen.getByText('Close Search')).toBeInTheDocument()
  })

  it('reconfigures a workspace slot without resetting unrelated state', async () => {
    const container = createExampleContainer()

    render(
      <>
        <Toolbar container={container} />
        <SearchQuery container={container} />
        <WorkspaceToggle container={container} />
      </>
    )

    fireEvent.click(screen.getByText('Open Search'))
    expect(screen.getByText('Close Search')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Toggle Workspace'))

    expect(await screen.findByText('Workspace: Team')).toBeInTheDocument()
    expect(screen.getByText('Disable Team Workspace')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-active')).toHaveTextContent('active')
    expect(screen.getByText('Close Search')).toBeInTheDocument()
  })

  it('gracefully limits a runtime extension when an optional upstream service is unavailable', async () => {
    const container = createExampleContainer({
      includeAnalyticsProvider: false,
    })

    render(
      <>
        <Toolbar container={container} />
        <AnalyticsToggle container={container} />
      </>
    )

    expect(screen.getByText('Analytics Unavailable')).toBeInTheDocument()
    expect(screen.getByTestId('analytics-active')).toHaveTextContent('inactive')

    fireEvent.click(screen.getByText('Toggle Analytics'))

    expect(await screen.findByText('Analytics Events: 0')).toBeInTheDocument()
    expect(screen.getByText('Track Analytics Event (0)')).toBeInTheDocument()
    expect(screen.getByTestId('analytics-active')).toHaveTextContent('active')

    fireEvent.click(screen.getByText('Track Analytics Event (0)'))

    expect(await screen.findByText('Analytics Events: 1')).toBeInTheDocument()
  })

  it('lets one plugin extend another plugin signal when the upstream plugin is present', () => {
    const container = createExampleContainer()

    render(<NotesPanel container={container} />)

    expect(
      screen.getByText('Welcome note from the Notes plugin')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Notes Helper: Suggested summary')
    ).toBeInTheDocument()
  })

  it('hides the downstream plugin signal contribution when the upstream plugin is absent', () => {
    const container = createExampleContainer({
      includeNotesPlugin: false,
      includeNotesHelperPlugin: true,
    })

    render(<NotesPanel container={container} />)

    expect(screen.getByTestId('notes-empty')).toBeInTheDocument()
  })
})
