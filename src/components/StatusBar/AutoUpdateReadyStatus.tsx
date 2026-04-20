import { Dialog } from '@headlessui/react'
import { ActionIcon } from '@src/components/ActionIcon'
import { ActionButton } from '@src/components/ActionButton'
import { MarkdownText } from '@src/components/MarkdownText'
import { defaultStatusBarItemClassNames } from '@src/components/StatusBar/StatusBar'
import type { AutoUpdateReady } from '@src/lib/autoUpdate'
import { useState } from 'react'

export function AutoUpdateReadyStatus({
  onRestart,
  update,
}: {
  onRestart: () => void
  update: AutoUpdateReady
}) {
  const [showReleaseNotes, setShowReleaseNotes] = useState(false)
  const releaseNotes = update.releaseNotes?.trim() ?? ''
  const hasReleaseNotes = releaseNotes.length > 0
  const containsBreakingChanges = releaseNotes
    .toLowerCase()
    .includes('breaking')

  return (
    <>
      <div className="flex items-stretch">
        <ActionButton
          Element="button"
          className={`${defaultStatusBarItemClassNames} !text-primary dark:!text-primary hover:!text-primary dark:hover:!text-primary`}
          data-testid="auto-update-ready-status"
          onClick={onRestart}
        >
          Restart to update
          <span className="sr-only">{` to v${update.version}`}</span>
        </ActionButton>
        {hasReleaseNotes && (
          <>
            <div className="w-[1px] self-stretch bg-chalkboard-30 dark:bg-chalkboard-80" />
            <ActionButton
              Element="button"
              className={`${defaultStatusBarItemClassNames} !px-1.5 !text-primary dark:!text-primary hover:!text-primary dark:hover:!text-primary`}
              data-testid="auto-update-release-notes-button"
              title={`Release notes for v${update.version}`}
              aria-label={`Show release notes for v${update.version}`}
              onClick={() => {
                setShowReleaseNotes(true)
              }}
            >
              <ActionIcon
                icon="questionMark"
                size="sm"
                iconClassName="text-primary dark:text-primary"
                bgClassName="!bg-transparent"
              />
            </ActionButton>
          </>
        )}
      </div>
      {hasReleaseNotes && (
        <Dialog
          open={showReleaseNotes}
          onClose={() => {
            setShowReleaseNotes(false)
          }}
          className="relative z-50"
        >
          <div className="fixed inset-0 bg-chalkboard-110/30 dark:bg-chalkboard-110/50" />
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <Dialog.Panel
              className="w-full max-w-3xl max-h-[80vh] overflow-hidden rounded bg-chalkboard-10 dark:bg-chalkboard-100 border border-chalkboard-30 dark:border-chalkboard-70 shadow-lg"
              data-testid="auto-update-release-notes-modal"
            >
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-chalkboard-30 dark:border-chalkboard-70">
                <Dialog.Title as="h2" className="text-sm font-semibold">
                  {`Release notes for v${update.version}`}
                </Dialog.Title>
                <button
                  type="button"
                  className="m-0 px-2 py-1 text-xs rounded border border-chalkboard-30 dark:border-chalkboard-70"
                  onClick={() => {
                    setShowReleaseNotes(false)
                  }}
                  aria-label="Close release notes"
                >
                  Close
                </button>
              </div>
              {containsBreakingChanges && (
                <p className="px-4 py-2 text-xs text-destroy-70 dark:text-destroy-50 border-b border-chalkboard-30 dark:border-chalkboard-70">
                  Contains breaking changes.
                </p>
              )}
              <div className="max-h-[60vh] overflow-y-auto p-4">
                <MarkdownText
                  text={releaseNotes}
                  className="block text-xs leading-relaxed"
                />
              </div>
            </Dialog.Panel>
          </div>
        </Dialog>
      )}
    </>
  )
}
