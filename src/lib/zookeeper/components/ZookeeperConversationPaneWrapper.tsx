import { Menu } from '@headlessui/react'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { HeaderMenu } from '@src/components/layout/Panel/HeaderMenu'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useApp } from '@src/lib/boot'
import { browserSaveFile } from '@src/lib/browserSaveFile'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import { ZookeeperConversationPane } from '@src/lib/zookeeper/components/ZookeeperConversationPane'
import type { ZookeeperSessionController } from '@src/lib/zookeeper/registry/controller'

export function ZookeeperConversationPaneWrapper(
  props: Pick<AreaTypeComponentProps, 'layout' | 'onClose'> & {
    controller: ZookeeperSessionController
  }
) {
  const { auth, settings } = useApp()
  const settingsValues = settings.useSettings()
  const user = auth.useUser()
  const { context: contextModeling } = useModelingContext()
  const { controller } = props

  return (
    <LayoutPanel
      title={props.layout.label}
      id={`${props.layout.id}-pane`}
      className="border-none"
    >
      <LayoutPanelHeader
        id={props.layout.id}
        icon="sparkles"
        title="Zookeeper"
        onClose={props.onClose}
        Menu={<ZookeeperConversationMenu controller={controller} />}
      />
      <ZookeeperConversationPane
        controller={controller}
        selectionRanges={contextModeling.selectionRanges}
        zookeeperMode={settingsValues.app.zookeeperMode}
        userAvatarSrc={user?.image}
        onMlCopilotModeChange={(mode) => {
          settings.actor.send({
            type: 'set.app.zookeeperMode',
            data: { level: 'project', value: mode },
          })
        }}
      />
    </LayoutPanel>
  )
}

const ZookeeperConversationMenu = ({
  controller,
}: {
  controller: ZookeeperSessionController
}) => (
  <HeaderMenu>
    <Menu.Item>
      <button
        type="button"
        onClick={() => {
          const conversationExport = controller.getConversationExport()
          const blob = new Blob(
            [new TextEncoder().encode(conversationExport.markdown)],
            {
              type: 'text/markdown',
            }
          )
          void browserSaveFile(blob, conversationExport.fileName, '')
        }}
        className="menuButton"
      >
        <span>Export conversation</span>
      </button>
    </Menu.Item>
  </HeaderMenu>
)
