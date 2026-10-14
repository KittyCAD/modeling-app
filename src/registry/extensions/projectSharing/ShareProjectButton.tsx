import { useSignals } from '@preact/signals-react/runtime'
import { ActionButton } from '@src/components/ActionButton'
import { isDesktop } from '@src/lib/isDesktop'
import {
  getCloudProjectPath,
  PROJECT_ACTION_COMMANDS,
} from '@src/lib/projectSharing'
import type { AppHeaderItemProps } from '@src/registry/contracts/appHeader'

export function ShareProjectButton({ app, className }: AppHeaderItemProps) {
  useSignals()
  const project = app.projectSignal.value?.projectIORefSignal.value
  if (isDesktop() || !project || !getCloudProjectPath(project)) return null

  return (
    <ActionButton
      Element="button"
      className={`${className} px-2`}
      tabIndex={0}
      iconStart={{ icon: 'share' }}
      data-testid="share-project-button"
      onClick={() =>
        app.commands.send({
          type: 'Find and select command',
          data: PROJECT_ACTION_COMMANDS.share,
        })
      }
    >
      Share
    </ActionButton>
  )
}
