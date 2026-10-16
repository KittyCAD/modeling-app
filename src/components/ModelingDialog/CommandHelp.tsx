import { Popover, Portal } from '@headlessui/react'
import { useId } from 'react'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import { modelingStdLibCommandDocsLink } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { Command } from '@src/lib/commandTypes'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'

export function CommandHelp({
  command,
}: {
  command: Pick<Command, 'name' | 'description'>
}) {
  const anchorName = `--command-help-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const docs = modelingStdLibCommandDocsLink(command.name)
  if (!command.description && !docs) return null

  return (
    <Popover className="flex" onMouseDown={(event) => event.stopPropagation()}>
      <Popover.Button
        aria-label="Command help"
        className="m-0 rounded-sm border-0 bg-transparent p-0 text-chalkboard-70 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-appForeground ui-open:bg-primary ui-open:text-chalkboard-10 dark:text-chalkboard-40 dark:ui-open:text-chalkboard-10"
        style={{ anchorName }}
      >
        <CustomIcon name="questionMark" className="h-5 w-5" />
        <Tooltip position="bottom-right" wrapperClassName="ui-open:hidden">
          Help
        </Tooltip>
      </Popover.Button>
      <Portal>
        <Popover.Panel
          className="pointer-events-auto fixed z-50 m-0 flex w-64 max-w-[calc(100vw-1rem)] max-h-[calc(100vh-1rem)] flex-col gap-2 overflow-y-auto rounded border border-chalkboard-30 bg-chalkboard-10 p-3 text-xs text-chalkboard-70 shadow-lg dark:border-chalkboard-70 dark:bg-chalkboard-100 dark:text-chalkboard-40"
          style={{
            positionAnchor: anchorName,
            top: 'anchor(bottom)',
            right: 'anchor(right)',
            marginTop: 4,
            positionTryFallbacks:
              'flip-block, flip-inline, flip-block flip-inline',
          }}
        >
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
        </Popover.Panel>
      </Portal>
    </Popover>
  )
}
