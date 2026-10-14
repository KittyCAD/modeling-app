import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import { isDesktop } from '@src/lib/isDesktop'
import {
  getCloudProjectPath,
  PROJECT_ACTION_COMMANDS,
} from '@src/lib/projectSharing'
import type { AppHeaderItemProps } from '@src/registry/contracts/appHeader'

export function ShareProjectButton({ app }: AppHeaderItemProps) {
  useSignals()
  const project = app.projectSignal.value?.projectIORefSignal.value
  if (isDesktop() || !project || !getCloudProjectPath(project)) return null

  return (
    <button
      type="button"
      className="relative inline-flex min-w-max items-center gap-1 border py-0 pl-0.5 pr-2 transition-colors border-chalkboard-30 bg-chalkboard-10/80 text-chalkboard-100 hover:border-chalkboard-40 hover:bg-chalkboard-10 dark:border-chalkboard-70 dark:bg-chalkboard-100/50 dark:text-chalkboard-10 dark:hover:border-chalkboard-60 dark:hover:bg-chalkboard-100 focus-visible:outline-appForeground active:border-primary"
      data-testid="share-project-button"
      onClick={() =>
        app.commands.send({
          type: 'Find and select command',
          data: PROJECT_ACTION_COMMANDS.share,
        })
      }
    >
      <CustomIcon name="share" className="h-5 w-5" aria-hidden="true" />
      <span className="flex-1">Share</span>
    </button>
  )
}
