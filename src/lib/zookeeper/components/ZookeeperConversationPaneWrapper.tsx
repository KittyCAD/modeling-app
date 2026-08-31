import { Menu } from '@headlessui/react'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { HeaderMenu } from '@src/components/layout/Panel/HeaderMenu'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useApp } from '@src/lib/boot'
import { browserSaveFile } from '@src/lib/browserSaveFile'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import type { Project } from '@src/lib/project'
import { ZookeeperConversationPane } from '@src/lib/zookeeper/components/ZookeeperConversationPane'
import type { ZookeeperSessionController } from '@src/lib/zookeeper/registry/controller'
import {
  ZookeeperConversationToMarkdown,
  type ZookeeperManagerActor,
} from '@src/lib/zookeeper/zookeeperManagerMachine'

export function ZookeeperConversationPaneWrapper(
  props: AreaTypeComponentProps & {
    controller: ZookeeperSessionController
    theProject: Project
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
        Menu={<ZookeeperConversationMenu actor={controller.actor} />}
      />
      <ZookeeperConversationPane
        controller={controller}
        contextModeling={contextModeling}
        settings={settingsValues}
        theProject={props.theProject}
        user={user}
        showMakeathonAnnouncement={false}
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
  actor,
}: {
  actor: ZookeeperManagerActor
}) => (
  <HeaderMenu>
    <Menu.Item>
      <button
        type="button"
        onClick={() => {
          const context = actor.getSnapshot().context
          const markdown = ZookeeperConversationToMarkdown(context.conversation)
          const blob = new Blob([new TextEncoder().encode(markdown)], {
            type: 'text/markdown',
          })
          void browserSaveFile(
            blob,
            `${context.conversationId ?? new Date().toISOString()}.md`,
            ''
          )
        }}
        className="menuButton"
      >
        <span>Export conversation</span>
      </button>
    </Menu.Item>
  </HeaderMenu>
)
