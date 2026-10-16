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

export function ZookeeperHeaderButton({ app, className }: AppHeaderItemProps) {
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
        className={`${className} ${isOpen ? '!border-primary !bg-primary/10 !text-primary dark:!bg-primary/20 dark:!text-primary' : ''}`}
      >
        <CustomIcon
          name={isRunning ? 'loading' : 'sidebarRight'}
          className={`w-5 h-5 ${isRunning ? 'animate-spin' : ''}`}
          aria-hidden
        />
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
