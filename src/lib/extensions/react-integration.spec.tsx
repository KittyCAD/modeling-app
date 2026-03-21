import { useSignals } from '@preact/signals-react/runtime'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  baseExtension,
  searchExtension,
  searchService,
  searchStatusExtension,
  toolbarFacet,
} from './examples/app'
import { ExtensionHost } from './host'

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

describe('React integration', () => {
  it('renders toolbar items from facet signals', () => {
    const host = new ExtensionHost()
    host.configure([baseExtension, searchExtension, searchStatusExtension])

    render(<Toolbar host={host} />)

    expect(screen.getByText('Open Search')).toBeInTheDocument()
    expect(screen.getByText('Search Idle')).toBeInTheDocument()
  })

  it('updates React UI when service-backed signals change', async () => {
    const host = new ExtensionHost()
    host.configure([baseExtension, searchExtension, searchStatusExtension])

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
    const host = new ExtensionHost()
    host.configure([baseExtension, searchExtension, searchStatusExtension])

    render(<Toolbar host={host} />)

    fireEvent.click(screen.getByText('Open Search'))

    expect(screen.getByText('Close Search')).toBeInTheDocument()
  })
})
