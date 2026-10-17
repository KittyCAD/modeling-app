import { Popover, Portal } from '@headlessui/react'
import { useId } from 'react'
import { CustomIcon } from '@src/components/CustomIcon'
import { MarkdownText } from '@src/components/MarkdownText'
import Tooltip from '@src/components/Tooltip'

export function ArgumentHelp({
  label,
  text,
}: {
  label: string
  text?: string
}) {
  const anchorName = `--argument-help-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  if (!text) return null

  return (
    <Popover className="flex" onMouseDown={(event) => event.stopPropagation()}>
      <Popover.Button
        aria-label={`Help for ${label}`}
        className="m-0 rounded-sm border-0 bg-transparent p-0 text-chalkboard-70 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-appForeground ui-open:bg-primary ui-open:text-chalkboard-10 dark:text-chalkboard-40 dark:ui-open:text-chalkboard-10"
        style={{ anchorName }}
      >
        <CustomIcon name="questionMark" className="h-4 w-4" />
        <Tooltip position="bottom-right" wrapperClassName="ui-open:hidden">
          Help for {label}
        </Tooltip>
      </Popover.Button>
      <Portal>
        <Popover.Panel
          className="pointer-events-auto fixed z-50 m-0 w-64 max-w-[calc(100vw-1rem)] max-h-[calc(100vh-1rem)] overflow-y-auto rounded border border-chalkboard-30 bg-chalkboard-10 p-3 text-xs text-chalkboard-70 shadow-lg dark:border-chalkboard-70 dark:bg-chalkboard-100 dark:text-chalkboard-40"
          style={{
            positionAnchor: anchorName,
            top: 'anchor(bottom)',
            right: 'anchor(right)',
            marginTop: 4,
            positionTryFallbacks:
              'flip-block, flip-inline, flip-block flip-inline',
          }}
        >
          <MarkdownText text={text} className="text-xs" />
        </Popover.Panel>
      </Portal>
    </Popover>
  )
}
