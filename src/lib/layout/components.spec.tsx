import { LayoutRootNode, usePaneIsActive } from '@src/lib/layout/components'
import type { ActionLibrary, AreaLibrary, Layout } from '@src/lib/layout/types'
import { LayoutType } from '@src/lib/layout/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

  it('keeps opted-in pane components mounted while closed', () => {
    const mountedIdentities: number[] = []
    const mountedWhileConnected: boolean[] = []
    const unmounted = vi.fn()

    function PersistentPane() {
      const contentRef = useRef<HTMLDivElement>(null)
      const isPaneActive = usePaneIsActive()
      const [identity] = useState(() => {
        const nextIdentity = mountedIdentities.length + 1
        mountedIdentities.push(nextIdentity)
        return nextIdentity
      })
      useEffect(() => () => unmounted(identity), [identity])
      useLayoutEffect(() => {
        mountedWhileConnected.push(contentRef.current?.isConnected === true)
      }, [])

      return (
        <div ref={contentRef} data-testid="persistent-pane-content">
          {identity}:{isPaneActive ? 'active' : 'closed'}
        </div>
      )
    }

    const layout: Layout = {
      id: 'right-toolbar',
      label: 'Right toolbar',
      type: LayoutType.Panes,
      side: 'inline-end',
      activeIndices: [1],
      sizes: [100],
      splitOrientation: 'block',
      children: [
        {
          areaType: 'persistent-area',
          icon: 'sparkles',
          id: 'persistent-pane',
          label: 'Persistent pane',
          type: LayoutType.Simple,
        },
        {
          areaType: 'regular-area',
          icon: 'code',
          id: 'regular-pane',
          label: 'Regular pane',
          type: LayoutType.Simple,
        },
      ],
    }
    const areaLibrary: AreaLibrary = {
      'persistent-area': {
        Component: PersistentPane,
        hide: () => false,
        keepMountedWhenClosed: true,
      },
      'regular-area': {
        Component: () => <div data-testid="regular-pane-content" />,
        hide: () => false,
      },
    }

    function LayoutHarness() {
      const [currentLayout, setCurrentLayout] = useState(layout)
      const [keepMountedPaneScope, setKeepMountedPaneScope] =
        useState('project-a')
      return (
        <>
          <button
            type="button"
            data-testid="change-keep-mounted-pane-scope"
            onClick={() =>
              setKeepMountedPaneScope((scope) =>
                scope === 'project-a' ? 'project-b' : 'project-c'
              )
            }
          >
            Change project
          </button>
          <LayoutRootNode
            layout={currentLayout}
            getLayout={() => currentLayout}
            setLayout={setCurrentLayout}
            areaLibrary={areaLibrary}
            showDebugPanel={false}
            notifications={[]}
            artifactGraph={new Map()}
            keepMountedPaneScope={keepMountedPaneScope}
          />
        </>
      )
    }

    render(<LayoutHarness />)

    expect(screen.queryByTestId('persistent-pane-content')).toBeNull()
    expect(screen.getByTestId('regular-pane-content')).toBeVisible()

    fireEvent.click(screen.getByTestId('persistent-pane-pane-button'))

    const initialContent = screen.getByTestId('persistent-pane-content')
    expect(initialContent).toBeVisible()
    expect(initialContent).toHaveTextContent('1:active')
    expect(mountedIdentities).toEqual([1])
    expect(mountedWhileConnected).toEqual([true])

    fireEvent.click(screen.getByTestId('persistent-pane-pane-button'))

    const hiddenContent = screen.getByTestId('persistent-pane-content')
    expect(hiddenContent).not.toBeVisible()
    expect(hiddenContent).toHaveTextContent('1:closed')
    expect(
      hiddenContent.closest('[data-keep-mounted-pane-host]')
    ).toHaveAttribute('inert')
    expect(
      document.querySelector(
        '[data-keep-mounted-pane-target="persistent-pane"]'
      )
    ).toBeNull()
    expect(screen.getByTestId('regular-pane-content')).toBeVisible()
    expect(mountedIdentities).toEqual([1])
    expect(unmounted).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('persistent-pane-pane-button'))

    const reopenedContent = screen.getByTestId('persistent-pane-content')
    expect(reopenedContent).toBeVisible()
    expect(reopenedContent).toHaveTextContent('1:active')
    expect(mountedIdentities).toEqual([1])
    expect(unmounted).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('change-keep-mounted-pane-scope'))

    expect(screen.getByTestId('persistent-pane-content')).toHaveTextContent(
      '2:active'
    )
    expect(mountedIdentities).toEqual([1, 2])
    expect(unmounted).toHaveBeenCalledExactlyOnceWith(1)

    fireEvent.click(screen.getByTestId('persistent-pane-pane-button'))
    fireEvent.click(screen.getByTestId('change-keep-mounted-pane-scope'))

    expect(screen.queryByTestId('persistent-pane-content')).toBeNull()
    expect(unmounted.mock.calls).toEqual([[1], [2]])

    fireEvent.click(screen.getByTestId('persistent-pane-pane-button'))

    expect(screen.getByTestId('persistent-pane-content')).toHaveTextContent(
      '3:active'
    )
    expect(mountedIdentities).toEqual([1, 2, 3])
    expect(mountedWhileConnected).toEqual([true, true, true])
  })
})
