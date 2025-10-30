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
import { useModelingContext } from '@src/hooks/useModelingContext'
import type { IndexLoaderData } from '@src/lib/types'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { MLEphantConversationPaneMenu } from '@src/components/MlEphantConversation'
import { useLoaderData } from 'react-router-dom'
import type { AreaTypeComponentProps } from '@src/lib/layout'

export function MlEphantConversationPaneWrapper(props: AreaTypeComponentProps) {
  const settings = useSettings()
  const user = useUser()
  const { context: contextModeling, theProject } = useModelingContext()
  const { file: loaderFile } = useLoaderData() as IndexLoaderData

  return (
    <LayoutPanel
      title={props.layout.label}
      id={`${props.layout.id}-pane`}
      className="border-none"
    >
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
    </LayoutPanel>
  )
}
