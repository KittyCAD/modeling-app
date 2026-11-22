import { ProjectNavigation } from '@src/components/ProjectNavigation'
import type { AppHeaderItemProps } from '@src/registry/contracts/appHeader'
import type { ReactNode } from 'react'

export function AppLogoHeaderItem({
  context,
  label,
  children,
}: Pick<AppHeaderItemProps, 'context'> & {
  label?: string
  children?: ReactNode
}) {
  return (
    <ProjectNavigation
      label={label}
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
    >
      {children}
    </ProjectNavigation>
  )
}
