import { LayoutRootNode } from '@src/lib/layout/components'
import { featureTreePaneConfig } from '@src/lib/layout/configs/default'
import { LayoutType } from '@src/lib/layout/types'
import type { ActionLibrary, Layout } from '@src/lib/layout/types'
import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@src/hooks/usePlatform', () => ({ default: () => 'linux' }))

function usePluginActionDisabled() {
  const [disabledReason] = useState<string | undefined>(undefined)
  return disabledReason
}

describe('LayoutRootNode', () => {
  it('updates the split-pane tooltip when its registry shortcut changes or is unbound', () => {
    const layout: Layout = {
      id: 'left-toolbar',
      label: 'Left toolbar',
      type: LayoutType.Panes,
      side: 'inline-start',
      activeIndices: [],
      sizes: [],
      splitOrientation: 'block',
      children: [featureTreePaneConfig],
    }
    const props = {
      layout,
      getLayout: () => layout,
      setLayout: vi.fn(),
      showDebugPanel: false,
      notifications: [],
      artifactGraph: new Map(),
    }
    const { rerender } = render(
      <LayoutRootNode
        {...props}
        paneShortcuts={{ [featureTreePaneConfig.id]: ['shift+t'] }}
      />
    )

    expect(screen.getByText('Shift+T')).toBeInTheDocument()

    rerender(
      <LayoutRootNode
        {...props}
        paneShortcuts={{ [featureTreePaneConfig.id]: ['ctrl+k', 't'] }}
      />
    )
    expect(screen.queryByText('Shift+T')).not.toBeInTheDocument()
    expect(screen.getByText('Ctrl+K T')).toBeInTheDocument()

    rerender(
      <LayoutRootNode
        {...props}
        paneShortcuts={{ [featureTreePaneConfig.id]: [] }}
      />
    )
    expect(screen.queryByText('Ctrl+K T')).not.toBeInTheDocument()
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent(
      /^Feature Tree$/
    )
  })

  it('rerenders toolbar actions when the action library changes', () => {
    const layout: Layout = {
      id: 'left-toolbar',
      label: 'Left toolbar',
      type: LayoutType.Panes,
      side: 'inline-start',
      activeIndices: [],
      sizes: [],
      splitOrientation: 'block',
      children: [],
      actions: [
        {
          id: 'plugin-action',
          label: 'Plugin action',
          icon: 'printer3d',
          actionType: 'plugin.action',
        },
      ],
    }
    const activeActionLibrary: ActionLibrary = {
      'plugin.action': {
        execute: vi.fn(),
        useDisabled: usePluginActionDisabled,
        useHidden: () => false,
      },
    }
    const artifactGraph = new Map()
    const notifications: boolean[] = []
    const setLayout = vi.fn()

    const { rerender } = render(
      <LayoutRootNode
        layout={layout}
        getLayout={() => layout}
        setLayout={setLayout}
        actionLibrary={activeActionLibrary}
        showDebugPanel={false}
        notifications={notifications}
        artifactGraph={artifactGraph}
      />
    )

    expect(screen.getByTestId('plugin-action-pane-button')).toBeVisible()

    rerender(
      <LayoutRootNode
        layout={layout}
        getLayout={() => layout}
        setLayout={setLayout}
        actionLibrary={{}}
        showDebugPanel={false}
        notifications={notifications}
        artifactGraph={artifactGraph}
      />
    )

    expect(screen.queryByTestId('plugin-action-pane-button')).toBeNull()
  })
})
