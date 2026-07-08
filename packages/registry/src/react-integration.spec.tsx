import { useSignals } from '@preact/signals-react/runtime'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  analyticsToggleService,
  createExampleRegistry,
  notesPanelValueSpec,
  searchService,
  toolbarValueSpec,
  workspaceToggleService,
} from './examples/app'
import type { Registry } from './registry'

function Toolbar({ registry }: { registry: Registry }) {
  useSignals()
  const items = registry.signal(toolbarValueSpec).value

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

function SearchQuery({ registry }: { registry: Registry }) {
  useSignals()
  const search = registry.get(searchService)

  return (
    <div>
      <span data-testid="query">{search.query.value || 'empty'}</span>
      <button onClick={() => search.setQuery('react')}>Set Query</button>
    </div>
  )
}

function WorkspaceToggle({ registry }: { registry: Registry }) {
  useSignals()
  const workspaceToggle = registry.get(workspaceToggleService)

  return (
    <div>
      <span data-testid="workspace-active">
        {workspaceToggle.active.value ? 'active' : 'inactive'}
      </span>
      <button onClick={() => workspaceToggle.toggle()}>Toggle Workspace</button>
    </div>
  )
}

function AnalyticsToggle({ registry }: { registry: Registry }) {
  useSignals()
  const analyticsToggle = registry.get(analyticsToggleService)

  return (
    <div>
      <span data-testid="analytics-active">
        {analyticsToggle.active.value ? 'active' : 'inactive'}
      </span>
      <button onClick={() => analyticsToggle.toggle()}>Toggle Analytics</button>
    </div>
  )
}

function NotesPanel({ registry }: { registry: Registry }) {
  useSignals()
  const items = registry.signal(notesPanelValueSpec).value

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
  it('renders toolbar items from registry value specs', () => {
    const registry = createExampleRegistry()

    render(<Toolbar registry={registry} />)

    expect(screen.getByText('Workspace: Personal')).toBeInTheDocument()
    expect(screen.getByText('Enable Team Workspace')).toBeInTheDocument()
    expect(screen.getByText('Open Search')).toBeInTheDocument()
    expect(screen.getByText('Search Idle')).toBeInTheDocument()
  })

  it('updates React UI when service-backed Preact signals change', async () => {
    const registry = createExampleRegistry()

    render(
      <>
        <Toolbar registry={registry} />
        <SearchQuery registry={registry} />
      </>
    )

    fireEvent.click(screen.getByText('Set Query'))

    expect(screen.getByTestId('query')).toHaveTextContent('react')
    expect(screen.getByText('Searching: react')).toBeInTheDocument()
  })

  it('updates when a signal contribution triggers service state changes', async () => {
    const registry = createExampleRegistry()

    render(<Toolbar registry={registry} />)

    fireEvent.click(screen.getByText('Open Search'))

    expect(screen.getByText('Close Search')).toBeInTheDocument()
  })

  it('reconfigures a workspace slot without resetting unrelated state', async () => {
    const registry = createExampleRegistry()

    render(
      <>
        <Toolbar registry={registry} />
        <SearchQuery registry={registry} />
        <WorkspaceToggle registry={registry} />
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

  it('gracefully limits a runtime registry item when an optional upstream service is unavailable', async () => {
    const registry = createExampleRegistry({
      includeAnalyticsProvider: false,
    })

    render(
      <>
        <Toolbar registry={registry} />
        <AnalyticsToggle registry={registry} />
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
    const registry = createExampleRegistry()

    render(<NotesPanel registry={registry} />)

    expect(
      screen.getByText('Welcome note from the Notes plugin')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Notes Helper: Suggested summary')
    ).toBeInTheDocument()
  })

  it('hides the downstream plugin signal contribution when the upstream plugin is absent', () => {
    const registry = createExampleRegistry({
      includeNotesPlugin: false,
      includeNotesHelperPlugin: true,
    })

    render(<NotesPanel registry={registry} />)

    expect(screen.getByTestId('notes-empty')).toBeInTheDocument()
  })
})
