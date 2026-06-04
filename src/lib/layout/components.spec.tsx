import { LayoutRootNode } from '@src/lib/layout/components'
import { LayoutType } from '@src/lib/layout/types'
import type { ActionLibrary, Layout } from '@src/lib/layout/types'
import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

function usePluginActionDisabled() {
  const [disabledReason] = useState<string | undefined>(undefined)
  return disabledReason
}

describe('LayoutRootNode', () => {
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
