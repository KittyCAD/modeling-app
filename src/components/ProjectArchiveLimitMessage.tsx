import { Popover } from '@headlessui/react'
import type { ProjectArchiveLimitError } from '@src/lib/cloudProjects/runtime/archiveContents'

export function ProjectArchiveLimitMessage({
  error,
  align = 'left',
}: {
  error: ProjectArchiveLimitError
  align?: 'left' | 'right'
}) {
  return (
    <Popover as="span" className="relative min-w-0">
      <Popover.Button className="whitespace-nowrap rounded-sm underline focus-visible:outline-appForeground">
        Project exceeds {error.limitLabel}
      </Popover.Button>
      <Popover.Panel
        as="span"
        className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} top-full z-30 mt-2 w-72 rounded border b-4 bg-2 p-3 text-sm text-1 shadow-lg`}
      >
        <span className="block">{error.message}</span>
        <a
          href="https://community.zoo.dev/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Contact support
        </a>
      </Popover.Panel>
    </Popover>
  )
}
