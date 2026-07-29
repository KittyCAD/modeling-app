import { useId, useState } from 'react'

import { CodeDiffView } from '@src/components/CodeDiffView'
import { CustomIcon } from '@src/components/CustomIcon'
import type { CommandReviewValidationDetails } from '@src/lib/commandTypes'
import type { ResolvedTheme } from '@src/lib/theme'

export function CodemodReviewDiff({
  details,
  resolvedTheme,
}: {
  details: CommandReviewValidationDetails
  resolvedTheme: ResolvedTheme
}) {
  const [expanded, setExpanded] = useState(false)
  const contentId = useId()

  return (
    <div className="mx-4 mb-3 overflow-hidden rounded border border-chalkboard-20 dark:border-chalkboard-70">
      <button
        type="button"
        aria-label="Codemod"
        aria-controls={contentId}
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="m-0 flex w-full items-center gap-2 border-0 bg-chalkboard-20/40 px-3 py-2 text-left text-sm hover:bg-chalkboard-20 focus:bg-chalkboard-20 dark:bg-chalkboard-90 dark:hover:bg-chalkboard-80 dark:focus:bg-chalkboard-80"
      >
        <CustomIcon
          name="caretDown"
          className={`h-4 w-4 shrink-0 transition-transform ${
            expanded ? '' : '-rotate-90'
          }`}
        />
        <span className="font-medium">Codemod</span>
      </button>
      {expanded && (
        <div
          id={contentId}
          className="border-t border-chalkboard-20 bg-chalkboard-10 p-3 dark:border-chalkboard-70 dark:bg-chalkboard-100"
        >
          <CodeDiffView
            beforeText={details.currentCode}
            afterText={details.proposedCode}
            beforeLabel="Current file"
            afterLabel="Codemod"
            language="kcl"
            resolvedTheme={resolvedTheme}
            testId="cmd-bar-codemod-diff"
          />
        </div>
      )}
    </div>
  )
}
