import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import { useApp } from '@src/lib/boot'

type NoExecutingFileEmptyStateProps = {
  className?: string
}

export function NoExecutingFileEmptyState({
  className = '',
}: NoExecutingFileEmptyStateProps) {
  const { commands } = useApp()

  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center gap-3 p-4 text-center ${className}`}
    >
      <CustomIcon
        name="file"
        className="h-6 w-6 text-chalkboard-70 dark:text-chalkboard-40"
      />
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-chalkboard-100 dark:text-chalkboard-10">
          No executing file
        </h2>
        <p className="max-w-72 text-xs text-chalkboard-70 dark:text-chalkboard-40">
          Select a KCL file to edit and run.
        </p>
      </div>
      <ActionButton
        Element="button"
        className="h-7"
        onClick={() => {
          commands.send({
            type: 'Find and select command',
            data: {
              name: 'set-executing-file',
              groupId: 'projects',
            },
          })
        }}
      >
        Set executing file
      </ActionButton>
    </div>
  )
}
