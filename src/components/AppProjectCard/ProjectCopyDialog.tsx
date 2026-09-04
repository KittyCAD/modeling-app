import { Dialog } from '@headlessui/react'
import { ActionButton } from '@src/components/ActionButton'
import { platform } from '@src/lib/utils'
import { useEffect, useState } from 'react'

const CLEAR_ALL_VALUE = '__clear_all__'

export function ProjectCopyDialog({
  projectPaths,
  initialKeepProjectPath,
  onConfirm,
  onDismiss,
}: {
  projectPaths: readonly string[]
  initialKeepProjectPath: string
  onConfirm: (keepProjectPath: string | undefined) => void
  onDismiss: () => void
}) {
  const [keepProjectPath, setKeepProjectPath] = useState<string | undefined>(
    initialKeepProjectPath
  )

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onDismiss()
      }
    }

    window.addEventListener('keydown', onWindowKeyDown)
    return () => window.removeEventListener('keydown', onWindowKeyDown)
  }, [onDismiss])

  const cancelButton = (
    <ActionButton
      key="cancel"
      Element="button"
      type="button"
      tabIndex={0}
      className="py-2"
      onClick={onDismiss}
    >
      Cancel
    </ActionButton>
  )
  const confirmButton = (
    <ActionButton
      key="confirm"
      Element="button"
      type="button"
      tabIndex={0}
      iconStart={{
        icon: 'split',
        size: 'sm',
        className: 'px-2',
        bgClassName: '!bg-transparent dark:!bg-transparent',
      }}
      className="bg-primary py-2 !pr-3 text-white hover:bg-primary/90 dark:bg-primary dark:text-white dark:hover:bg-primary/90"
      onClick={() => onConfirm(keepProjectPath)}
      data-testid="separate-project-copies-confirmation"
    >
      Separate copies
    </ActionButton>
  )
  const orderedButtons =
    platform() === 'windows'
      ? [confirmButton, cancelButton]
      : [cancelButton, confirmButton]

  return (
    <Dialog open={true} onClose={onDismiss} className="relative z-50">
      <div className="fixed inset-0 grid bg-chalkboard-110/80 place-content-center">
        <Dialog.Panel className="w-full max-w-2xl rounded border border-chalkboard-40 bg-chalkboard-10 p-4 dark:border-chalkboard-70 dark:bg-chalkboard-100">
          <Dialog.Title as="h2" className="mb-2 text-2xl font-bold">
            Separate Project Copies
          </Dialog.Title>
          <Dialog.Description className="mb-4">
            Choose which project keeps the shared Zookeeper history. The other
            copies will start with no history.
          </Dialog.Description>

          <fieldset className="mb-4 flex max-h-72 flex-col gap-2 overflow-y-auto text-sm">
            <legend className="mb-2 font-medium">Keep history with</legend>
            {projectPaths.map((projectPath) => (
              <label
                key={projectPath}
                className="flex items-start gap-2 rounded border border-chalkboard-30 p-2 dark:border-chalkboard-80"
              >
                <input
                  type="radio"
                  name="project-copy-history"
                  className="mt-1"
                  checked={keepProjectPath === projectPath}
                  onChange={() => setKeepProjectPath(projectPath)}
                />
                <span className="break-all">{projectPath}</span>
              </label>
            ))}
            <label className="flex items-start gap-2 rounded border border-chalkboard-30 p-2 dark:border-chalkboard-80">
              <input
                type="radio"
                name="project-copy-history"
                className="mt-1"
                value={CLEAR_ALL_VALUE}
                checked={keepProjectPath === undefined}
                onChange={() => setKeepProjectPath(undefined)}
              />
              <span>Clear history from every copy</span>
            </label>
          </fieldset>

          <div className="flex justify-end gap-2">{orderedButtons}</div>
        </Dialog.Panel>
      </div>
    </Dialog>
  )
}
