import {
  billingActor,
  codeManager,
  kclManager,
  mlEphantManagerActor,
  systemIOActor,
  useSettings,
  useUser,
} from '@src/lib/singletons'
import { MlEphantConversationPane } from '@src/components/layout/areas/MlEphantConversationPane'
import { MlEphantConversationPane2 } from '@src/components/layout/areas/MlEphantConversationPane2'
import { useModelingContext } from '@src/hooks/useModelingContext'
import type { IndexLoaderData } from '@src/lib/types'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { MLEphantConversationPaneMenu } from '@src/components/MlEphantConversation'
import { MLEphantConversationPaneMenu2 } from '@src/components/MlEphantConversation2'
import { useLoaderData } from 'react-router-dom'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import { MlEphantManagerReactContext } from '@src/machines/mlEphantManagerMachine2'
import { IS_STAGING_OR_DEBUG } from '@src/routes/utils'

export function MlEphantConversationPaneWrapper(props: AreaTypeComponentProps) {
  const settings = useSettings()
  const user = useUser()
  const { context: contextModeling, theProject } = useModelingContext()
  const { file: loaderFile } = useLoaderData() as IndexLoaderData
  const mlEphantManagerActor2 = MlEphantManagerReactContext.useActorRef()

  return (
    <LayoutPanel
      title={props.layout.label}
      id={`${props.layout.id}-pane`}
      className="border-none"
    >
      {IS_STAGING_OR_DEBUG && settings.meta.disableCopilot.current === false ? (
        <>
          <LayoutPanelHeader
            id={props.layout.id}
            icon="sparkles"
            title="Text-to-CAD"
            Menu={MLEphantConversationPaneMenu2}
            onClose={props.onClose}
          />
          <MlEphantConversationPane2
            {...{
              mlEphantManagerActor: mlEphantManagerActor2,
              billingActor,
              systemIOActor,
              kclManager,
              codeManager,
              contextModeling,
              theProject: theProject.current,
              loaderFile,
              settings,
              user,
            }}
          />
        </>
      ) : (
        <>
          <LayoutPanelHeader
            id={props.layout.id}
            icon="sparkles"
            title="Text-to-CAD"
            Menu={MLEphantConversationPaneMenu}
            onClose={props.onClose}
          />
          <MlEphantConversationPane
            {...{
              mlEphantManagerActor,
              billingActor,
              systemIOActor,
              kclManager,
              codeManager,
              contextModeling,
              theProject: theProject.current,
              loaderFile,
              settings,
              user,
            }}
          />
        </>
      )}
    </LayoutPanel>
  )
}
