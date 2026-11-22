import { ProjectNavigation } from '@src/components/ProjectNavigation'
import type { AppHeaderItemProps } from '@src/registry/contracts/appHeader'

export function AppLogoHeaderItem({
  context,
}: Pick<AppHeaderItemProps, 'context'>) {
  return (
    <ProjectNavigation
      onHomeNavigate={
        context.type === 'legacy-project'
          ? () => {
              context.onProjectClose(
                context.file ?? null,
                context.project?.path ?? null,
                false
              )
              context.onHomeNavigate()
            }
          : undefined
      }
    />
  )
}
