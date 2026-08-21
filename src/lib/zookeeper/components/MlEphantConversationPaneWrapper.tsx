import { Menu } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { HeaderMenu } from '@src/components/layout/Panel/HeaderMenu'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useApp, useSingletons } from '@src/lib/boot'
import { browserSaveFile } from '@src/lib/browserSaveFile'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import { MlEphantConversationPane } from '@src/lib/zookeeper/components/MlEphantConversationPane'
import {
  type MlCopilotModeId,
  MlEphantConversationToMarkdown,
} from '@src/lib/zookeeper/mlEphantManagerMachine'
import { zookeeperService } from '@src/lib/zookeeper/registry/contract'
import { IS_STAGING_OR_DEBUG } from '@src/routes/utils'
import { useEffect } from 'react'

export function MlEphantConversationPaneWrapper(props: AreaTypeComponentProps) {
  return <MlEphantConversationPaneInner {...props} />
}

function MlEphantConversationPaneInner(props: AreaTypeComponentProps) {
  useSignals()
  const app = useApp()
  const { auth, settings } = app
  const { kclManager: fallbackKclManager } = useSingletons()
  const settingsValues = settings.useSettings()
  const user = auth.useUser()
  const {
    context: contextModeling,
    send: sendModeling,
    theProject,
  } = useModelingContext()
  const zookeeper = app.registry.get(zookeeperService)
  const openedProject = app.projectSession.openedProject.value
  const executingEditor = openedProject?.executingEditor.value
  const kclManager = executingEditor ?? fallbackKclManager
  const loaderFile = openedProject?.executingFileEntry.value
  const project = openedProject?.projectIORefSignal.value ?? theProject.current

  useEffect(() => {
    if (!IS_STAGING_OR_DEBUG) {
      return
    }

    app.debug.mlEphantManagerActor = zookeeper.actor

    return () => {
      if (app.debug.mlEphantManagerActor === zookeeper.actor) {
        delete app.debug.mlEphantManagerActor
      }
    }
  }, [app.debug, zookeeper.actor])

  // During the makethon, this was set to the following:
  // !isPlaywright() &&
  // !location.pathname.includes(String(PATHS.ONBOARDING)) &&
  // !billingContext.isOrg
  const showMakeathonAnnouncement = false

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
        Menu={MlEphantConversationMenu}
      />
      <MlEphantConversationPane
        mlEphantManagerActor={zookeeper.actor}
        clearChat={zookeeper.clearChat}
        reconnect={zookeeper.reconnect}
        kclManager={kclManager}
        contextModeling={contextModeling}
        sendModeling={sendModeling}
        theProject={project}
        loaderFile={loaderFile}
        settings={settingsValues}
        user={user}
        showMakeathonAnnouncement={showMakeathonAnnouncement}
        onMlCopilotModeChange={(mode: MlCopilotModeId | undefined) => {
          settings.actor.send({
            type: 'set.app.zookeeperMode',
            data: { level: 'project', value: mode },
          })
        }}
      />
    </LayoutPanel>
  )
}

export const MlEphantConversationMenu = () => {
  const app = useApp()
  const mlEphantManagerActor = app.registry.get(zookeeperService).actor

  return (
    <HeaderMenu>
      <Menu.Item>
        <button
          type="button"
          onClick={() => {
            const context = mlEphantManagerActor.getSnapshot().context
            const md = MlEphantConversationToMarkdown(context.conversation)
            const blob = new Blob([new TextEncoder().encode(md)], {
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
}
