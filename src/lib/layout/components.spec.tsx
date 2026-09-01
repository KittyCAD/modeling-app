import { CleanPaneHeader } from '@src/components/layout/Panel/CleanPaneHeader'
import { LayoutRootNode } from '@src/lib/layout/components'
import type { ActionLibrary, AreaLibrary, Layout } from '@src/lib/layout/types'
import { LayoutType } from '@src/lib/layout/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

function usePluginActionDisabled() {
  const [disabledReason] = useState<string | undefined>(undefined)
  return disabledReason
}

describe('LayoutRootNode', () => {
  it('replaces a simple area from its pane content selector', () => {
    const layout: Layout = {
      id: 'workspace-pane',
      label: 'Projects',
      type: LayoutType.Simple,
      areaType: 'projects',
    }
    const areaLibrary: AreaLibrary = {
      projects: {
        hide: () => false,
        Component: ({ layout: paneLayout }) => (
          <CleanPaneHeader title={paneLayout.label} />
        ),
      },
      chat: {
        hide: () => false,
        Component: ({ layout: paneLayout }) => (
          <CleanPaneHeader title={paneLayout.label} />
        ),
      },
    }
    const setLayout = vi.fn()

    render(
      <LayoutRootNode
        areaLibrary={areaLibrary}
        areaSelectorOptions={[
          { id: 'projects', label: 'Projects', areaType: 'projects' },
          { id: 'chat', label: 'Chat', areaType: 'chat' },
        ]}
        artifactGraph={new Map()}
        getLayout={() => layout}
        layout={layout}
        notifications={[]}
        setLayout={setLayout}
        showDebugPanel={false}
      />
    )

    fireEvent.click(screen.getByTestId('pane-content-selector-button'))
    fireEvent.click(screen.getByTestId('pane-content-option-chat'))

    expect(setLayout).toHaveBeenCalledWith({
      ...layout,
      areaType: 'chat',
      label: 'Chat',
    })
  })

  it('shows resize separators without grabbers when requested', () => {
    const layout: Layout = {
      id: 'ai-layout',
      label: 'AI layout',
      type: LayoutType.Splits,
      orientation: 'inline',
      sizes: [],
      children: [
        {
          id: 'projects',
          label: 'Projects',
          type: LayoutType.Simple,
          areaType: 'projects',
        },
        {
          id: 'chat',
          label: 'Chat',
          type: LayoutType.Simple,
          areaType: 'chat',
        },
      ],
    }

    const { container } = render(
      <LayoutRootNode
        layout={layout}
        getLayout={() => layout}
        setLayout={vi.fn()}
        hideResizeHandleGrabbers={true}
        showDebugPanel={false}
        notifications={[]}
        artifactGraph={new Map()}
      />
    )

    const resizeHandle = container.querySelector('#handle-projects')
    expect(resizeHandle).toHaveClass('bg-3')
    expect(
      screen.queryByTestId('resize-handle-grabber')
    ).not.toBeInTheDocument()
  })

  it('keeps resize behavior but makes its line transparent when requested', () => {
    const layout: Layout = {
      id: 'ai-layout',
      label: 'AI layout',
      type: LayoutType.Splits,
      orientation: 'inline',
      sizes: [],
      children: [
        {
          id: 'projects',
          label: 'Projects',
          type: LayoutType.Simple,
          areaType: 'projects',
        },
        {
          id: 'chat',
          label: 'Chat',
          type: LayoutType.Simple,
          areaType: 'chat',
        },
      ],
    }

    const { container } = render(
      <LayoutRootNode
        layout={layout}
        getLayout={() => layout}
        setLayout={vi.fn()}
        hideResizeHandleGrabbers={true}
        hideResizeHandleLines={true}
        showDebugPanel={false}
        notifications={[]}
        artifactGraph={new Map()}
      />
    )

    expect(container.querySelector('#handle-projects')).toHaveClass(
      'bg-transparent'
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
