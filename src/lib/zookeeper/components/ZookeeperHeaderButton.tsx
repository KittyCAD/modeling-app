import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import usePlatform from '@src/hooks/usePlatform'
import { hotkeyDisplay } from '@src/lib/hotkeys'
import { isMobile } from '@src/lib/isMobile'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'
import { LayoutType } from '@src/lib/layout/types'
import {
  findLayoutParentNode,
  togglePaneLayoutNode,
} from '@src/lib/layout/utils'
import { zookeeperPromptRunningSignal } from '@src/lib/zookeeper/zookeeperPromptState'
import type { AppHeaderItemProps } from '@src/registry/contracts/appHeader'
import { layoutService } from '@src/registry/contracts/layout'
import { useHotkeys } from 'react-hotkeys-hook'

export function ZookeeperHeaderButton({ app }: AppHeaderItemProps) {
  useSignals()
  const platform = usePlatform()
  const layout = app.registry.optional(layoutService)
  const rootLayout = layout?.signal.value
  const pane = rootLayout
    ? findLayoutParentNode({
        rootLayout,
        targetNodeId: DefaultLayoutPaneID.Zookeeper,
      })
    : undefined
  const isVisible =
    !isMobile() && !!app.projectSignal.value && pane?.type === LayoutType.Panes
  const isOpen =
    pane?.type === LayoutType.Panes &&
    pane.activeIndices.some(
      (index) => pane.children[index]?.id === DefaultLayoutPaneID.Zookeeper
    )
  const isRunning = !isOpen && zookeeperPromptRunningSignal.value
  const toggle = () => {
    if (!layout) return
    layout.set(
      togglePaneLayoutNode({
        rootLayout: structuredClone(layout.get()),
        targetNodeId: DefaultLayoutPaneID.Zookeeper,
        shouldExpand: !isOpen,
      })
    )
  }
  useHotkeys('Ctrl + T', toggle, { scopes: ['modeling'], enabled: isVisible })

  if (!isVisible) return null

  return (
    <div className="relative inline-flex" data-onboarding-id="ttc-pane-button">
      <button
        type="button"
        id="ttc"
        data-testid="ttc-pane-button"
        aria-label="Zookeeper"
        aria-pressed={isOpen}
        onClick={toggle}
        className="group/avatar m-0 grid place-items-center border-0 p-0 rounded bg-transparent hover:bg-transparent hover:brightness-95 focus-visible:outline-appForeground"
      >
        <span
          className={`avatar bg-ml-green ${isOpen ? 'ring-1 ring-inset ring-chalkboard-100/40' : ''}`}
        >
          {isRunning ? (
            <CustomIcon
              name="loading"
              className="w-6 h-6 animate-spin text-chalkboard-100"
              aria-hidden
            />
          ) : (
            <span className="bg-img-mel w-6 h-6" aria-hidden />
          )}
        </span>
      </button>
      <Tooltip
        position="bottom-right"
        hoverOnly
        contentClassName="text-xs flex items-center gap-4 whitespace-nowrap"
      >
        <span>{isOpen ? 'Hide Zookeeper' : 'Show Zookeeper'}</span>
        <kbd className="hotkey text-xs">
          {hotkeyDisplay('Ctrl + T', platform)}
        </kbd>
      </Tooltip>
    </div>
  )
}
