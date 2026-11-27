import { useSignals } from '@preact/signals-react/runtime'
import { ActionButton } from '@src/components/ActionButton'
import { CREATE_CLOUD_LIBRARY_COMMAND } from '@src/lib/cloudProjects/commands'
import { selectCommand } from '@src/lib/commandUtils'
import {
  commandsFacet,
  commandSystemService,
} from '@src/registry/contracts/commands'
import type { Registry } from 'plankton'

export function CloudLibraryCreateButton({ registry }: { registry: Registry }) {
  useSignals()
  const commands = registry.optional(commandSystemService)
  const command = registry
    .observe(commandsFacet)
    .value.find(
      (command) =>
        command.groupId === 'projects' &&
        command.name === CREATE_CLOUD_LIBRARY_COMMAND
    )
  if (!commands || !command || command.disabled) return null

  return (
    <ActionButton
      Element="button"
      type="button"
      tabIndex={0}
      aria-label={CREATE_CLOUD_LIBRARY_COMMAND}
      className="text-xs border-primary/10"
      iconStart={{ icon: 'folderPlus', bgClassName: '!bg-transparent' }}
      onClick={() =>
        selectCommand(commands, {
          groupId: command.groupId,
          name: command.name,
        })
      }
    >
      {CREATE_CLOUD_LIBRARY_COMMAND}
    </ActionButton>
  )
}
