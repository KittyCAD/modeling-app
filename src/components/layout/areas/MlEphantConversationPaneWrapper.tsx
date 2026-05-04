import { browserSaveFile } from '@src/lib/browserSaveFile'
import { Menu } from '@headlessui/react'
// Yea, feels bad, but literally every other pane is doing this.
// TODO: Don't use CSS module for this? More generic module?
import styles from './KclEditorMenu.module.css'
import { useApp, useSingletons } from '@src/lib/boot'
import { MlEphantConversationPane } from '@src/components/layout/areas/MlEphantConversationPane'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { HeaderMenu } from '@src/components/layout/Panel/HeaderMenu'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import { isPlaywright } from '@src/lib/isPlaywright'
import { PATHS } from '@src/lib/paths'
import {
  MlEphantConversationToMarkdown,
  MlEphantManagerReactContext,
} from '@src/machines/mlEphantManagerMachine'
import { BillingTransition } from '@src/machines/billingMachine'
import { useSignals } from '@preact/signals-react/runtime'
import { useLocation } from 'react-router-dom'

export function MlEphantConversationPaneWrapper(props: AreaTypeComponentProps) {
  useSignals()
  const { auth, billing, settings, project, systemIOActor } = useApp()
  const { kclManager } = useSingletons()
  const settingsValues = settings.useSettings()
  const user = auth.useUser()
  const token = auth.useToken()
  const billingContext = billing.useContext()
  const location = useLocation()
  const {
    context: contextModeling,
    send: sendModeling,
    theProject,
  } = useModelingContext()
  const loaderFile = project?.executingFileEntry.value
  const mlEphantManagerActor = MlEphantManagerReactContext.useActorRef()

  const sendBillingUpdate = () => {
    billing.send({
      type: BillingTransition.Update,
      apiToken: token,
    })
  }

  const showMakeathonAnnouncement =
    !isPlaywright() &&
    !location.pathname.includes(String(PATHS.ONBOARDING)) &&
    !billingContext.isOrg

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
        {...{
          mlEphantManagerActor: mlEphantManagerActor,
          systemIOActor,
          kclManager,
          contextModeling,
          sendModeling,
          sendBillingUpdate,
          theProject: theProject.current,
          loaderFile,
          settings: settingsValues,
          user,
          showMakeathonAnnouncement,
          onMlCopilotModeChange: (mode) => {
            settings.actor.send({
              type: 'set.app.zookeeperMode',
              data: { level: 'project', value: mode },
            })
          },
        }}
      />
    </LayoutPanel>
  )
}

export const MlEphantConversationMenu = () => {
  const mlEphantManagerActor = MlEphantManagerReactContext.useActorRef()

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
          className={styles.button}
        >
          <span>Export conversation</span>
        </button>
      </Menu.Item>
    </HeaderMenu>
  )
}
