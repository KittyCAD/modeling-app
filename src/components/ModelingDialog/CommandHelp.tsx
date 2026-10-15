import { modelingStdLibCommandDocsLink } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { Command } from '@src/lib/commandTypes'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'

export function CommandHelp({
  command,
}: {
  command: Pick<Command, 'name' | 'description'>
}) {
  const docs = modelingStdLibCommandDocsLink(command.name)
  if (!command.description && !docs) return null

  return (
    <details className="text-chalkboard-70 dark:text-chalkboard-40">
      <summary className="cursor-pointer">Help</summary>
      <div className="flex flex-col gap-2 pt-2">
        {command.description && <p>{command.description}</p>}
        {docs && (
          <a
            href={docs.url}
            target="_blank"
            rel="noreferrer"
            onClick={openExternalBrowserIfDesktop(docs.url)}
            className="text-primary underline"
          >
            {docs.label}
          </a>
        )}
      </div>
    </details>
  )
}
