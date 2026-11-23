import { CommandHelpView } from '@src/components/ModelingDialog/CommandHelpView'
import { modelingStdLibCommandDocsLink } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { Command } from '@src/lib/commandTypes'

export function CommandHelp({
  command,
}: {
  command: Pick<Command, 'name' | 'description'>
}) {
  return (
    <CommandHelpView
      description={command.description}
      docs={modelingStdLibCommandDocsLink(command.name)}
    />
  )
}
