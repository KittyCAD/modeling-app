import { useSignals } from '@preact/signals-react/runtime'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  analyticsToggleService,
  createExampleHost,
  notesPanelFacet,
  searchService,
  toolbarFacet,
  workspaceToggleService,
} from './examples/app'
import type { ExtensionHost } from './host'

function Toolbar({ host }: { host: ExtensionHost }) {
  useSignals()
  const items = host.signal(toolbarFacet).value

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

function SearchQuery({ host }: { host: ExtensionHost }) {
  useSignals()
  const search = host.get(searchService)

  return (
    <div>
      <span data-testid="query">{search.query.value || 'empty'}</span>
      <button onClick={() => search.setQuery('react')}>Set Query</button>
    </div>
  )
}

function WorkspaceToggle({ host }: { host: ExtensionHost }) {
  useSignals()
  const workspaceToggle = host.get(workspaceToggleService)

  return (
    <div>
      <span data-testid="workspace-active">
        {workspaceToggle.active.value ? 'active' : 'inactive'}
      </span>
      <button onClick={() => workspaceToggle.toggle()}>Toggle Workspace</button>
    </div>
  )
}

function AnalyticsToggle({ host }: { host: ExtensionHost }) {
  useSignals()
  const analyticsToggle = host.get(analyticsToggleService)

  return (
    <div>
      <span data-testid="analytics-active">
        {analyticsToggle.active.value ? 'active' : 'inactive'}
      </span>
      <button onClick={() => analyticsToggle.toggle()}>Toggle Analytics</button>
    </div>
  )
}

function NotesPanel({ host }: { host: ExtensionHost }) {
  useSignals()
  const items = host.signal(notesPanelFacet).value

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
  it('renders toolbar items from facet signals', () => {
    const host = createExampleHost()

    render(<Toolbar host={host} />)

    expect(screen.getByText('Workspace: Personal')).toBeInTheDocument()
    expect(screen.getByText('Enable Team Workspace')).toBeInTheDocument()
    expect(screen.getByText('Open Search')).toBeInTheDocument()
    expect(screen.getByText('Search Idle')).toBeInTheDocument()
  })

  it('updates React UI when service-backed signals change', async () => {
    const host = createExampleHost()

    render(
      <>
        <Toolbar host={host} />
        <SearchQuery host={host} />
      </>
    )

    fireEvent.click(screen.getByText('Set Query'))

    expect(screen.getByTestId('query')).toHaveTextContent('react')
    expect(screen.getByText('Searching: react')).toBeInTheDocument()
  })

  it('updates when a facet contribution triggers service state changes', async () => {
    const host = createExampleHost()

    render(<Toolbar host={host} />)

    fireEvent.click(screen.getByText('Open Search'))

    expect(screen.getByText('Close Search')).toBeInTheDocument()
  })

  it('reconfigures a workspace compartment without resetting unrelated state', async () => {
    const host = createExampleHost()

    render(
      <>
        <Toolbar host={host} />
        <SearchQuery host={host} />
        <WorkspaceToggle host={host} />
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
    const host = createExampleHost({ includeAnalyticsProvider: false })

    render(
      <>
        <Toolbar host={host} />
        <AnalyticsToggle host={host} />
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

  it('lets one plugin extend another plugin facet when the upstream plugin is present', () => {
    const host = createExampleHost()

    render(<NotesPanel host={host} />)

    expect(
      screen.getByText('Welcome note from the Notes plugin')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Notes Helper: Suggested summary')
    ).toBeInTheDocument()
  })

  it('hides the downstream plugin facet contribution when the upstream plugin is absent', () => {
    const host = createExampleHost({
      includeNotesPlugin: false,
      includeNotesHelperPlugin: true,
    })

    render(<NotesPanel host={host} />)

    expect(screen.getByTestId('notes-empty')).toBeInTheDocument()
  })
})
