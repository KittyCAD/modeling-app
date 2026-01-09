import { browserSaveFile } from '@src/lib/browserSaveFile'
import { Menu } from '@headlessui/react'
import { ActionIcon } from '@src/components/ActionIcon'
// Yea, feels bad, but literally every other pane is doing this.
// TODO: Don't use CSS module for this? More generic module?
import styles from './KclEditorMenu.module.css'
import {
  billingActor,
  kclManager,
  systemIOActor,
  useSettings,
  useToken,
  useUser,
} from '@src/lib/singletons'
import { MlEphantConversationPane } from '@src/components/layout/areas/MlEphantConversationPane'
import { useModelingContext } from '@src/hooks/useModelingContext'
import type { IndexLoaderData } from '@src/lib/types'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { useLoaderData } from 'react-router-dom'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import {
  MlEphantConversationToMarkdown,
  MlEphantManagerReactContext,
} from '@src/machines/mlEphantManagerMachine'
import { BillingTransition } from '@src/machines/billingMachine'

export function MlEphantConversationPaneWrapper(props: AreaTypeComponentProps) {
  const settings = useSettings()
  const user = useUser()
  const token = useToken()
  const {
    context: contextModeling,
    send: sendModeling,
    theProject,
  } = useModelingContext()
  const { file: loaderFile } = useLoaderData<IndexLoaderData>()
  const mlEphantManagerActor = MlEphantManagerReactContext.useActorRef()

  const sendBillingUpdate = () => {
    billingActor.send({
      type: BillingTransition.Update,
      apiToken: token,
    })
  }

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
          settings,
          user,
        }}
      />
    </LayoutPanel>
  )
}

export const MlEphantConversationMenu = ({
  children,
}: React.PropsWithChildren) => {
  const mlEphantManagerActor = MlEphantManagerReactContext.useActorRef()

  return (
    <Menu>
      <div
        className="relative"
        role="button"
        tabIndex={0}
        onClick={(e) => {
          const target = e.target as HTMLElement
          if (e.eventPhase === 3 && target.closest('a') === null) {
            e.stopPropagation()
            e.preventDefault()
          }
        }}
      >
        <Menu.Button className="!p-0 !bg-transparent hover:text-primary border-transparent dark:!border-transparent hover:!border-primary dark:hover:!border-chalkboard-70 ui-open:!border-primary dark:ui-open:!border-chalkboard-70 !outline-none">
          <ActionIcon
            icon="three-dots"
            className="p-1"
            size="sm"
            bgClassName="bg-transparent dark:bg-transparent"
            iconClassName={'!text-chalkboard-90 dark:!text-chalkboard-40'}
          />
        </Menu.Button>
        <Menu.Items className="absolute right-0 left-auto w-72 flex flex-col gap-1 divide-y divide-chalkboard-20 dark:divide-chalkboard-70 align-stretch px-0 py-1 bg-chalkboard-10 dark:bg-chalkboard-100 rounded-sm shadow-lg border border-solid border-chalkboard-20/50 dark:border-chalkboard-80/50">
          <Menu.Item>
            <button
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
        </Menu.Items>
      </div>
    </Menu>
  )
}
