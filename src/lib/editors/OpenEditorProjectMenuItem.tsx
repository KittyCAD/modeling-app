import { ActionButton } from '@src/components/ActionButton'
import { OPEN_EDITOR_COMMAND } from '@src/lib/editors/commands'
import type { ProjectMenuItemProps } from '@src/lib/projectSession/next/projectMenu'

export function OpenEditorProjectMenuItem({
  app,
  session,
  className,
  close,
}: ProjectMenuItemProps) {
  return (
    <li className="contents">
      <ActionButton
        Element="button"
        tabIndex={0}
        className={className}
        onClick={() => {
          if (session.signal.aborted) return
          app.commands.send({
            type: 'Find and select command',
            data: {
              name: OPEN_EDITOR_COMMAND.name,
              groupId: OPEN_EDITOR_COMMAND.groupId,
            },
          })
          close()
        }}
      >
        Open editor
      </ActionButton>
    </li>
  )
}
