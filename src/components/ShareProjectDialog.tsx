import { Dialog } from '@headlessui/react'
import { ActionButton } from '@src/components/ActionButton'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { create, type InstanceProps } from 'react-modal-promise'

type ShareProjectDialogProps = InstanceProps<undefined> & { url: string }

function ShareProjectDialog({
  isOpen,
  onResolve,
  url,
}: ShareProjectDialogProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onResolve()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [isOpen, onResolve])

  return (
    <Dialog open={isOpen} onClose={() => onResolve()} className="relative z-50">
      <div className="fixed inset-0 grid bg-chalkboard-110/80 place-content-center p-4">
        <Dialog.Panel className="w-full max-w-xl rounded border border-chalkboard-40 bg-chalkboard-10 p-6 dark:border-chalkboard-70 dark:bg-chalkboard-100">
          <Dialog.Title as="h2" className="mb-2 text-xl font-bold">
            Share project
          </Dialog.Title>
          <Dialog.Description className="mb-4 text-sm">
            Sign-in is required. People with access will see the latest version.
          </Dialog.Description>
          <label className="mb-1 block text-sm" htmlFor="project-share-link">
            Project link
          </label>
          <input
            id="project-share-link"
            type="url"
            readOnly
            value={url}
            onFocus={(event) => event.currentTarget.select()}
            className="w-full rounded border border-chalkboard-40 bg-transparent p-2 text-sm dark:border-chalkboard-70"
          />
          <div className="mt-4 flex justify-end gap-2">
            <ActionButton
              Element="button"
              tabIndex={0}
              className="py-2"
              onClick={() => onResolve()}
            >
              Done
            </ActionButton>
            <ActionButton
              Element="button"
              tabIndex={0}
              iconStart={{ icon: 'clipboard' }}
              className="py-2"
              onClick={() => {
                void navigator.clipboard.writeText(url).then(
                  () => setCopied(true),
                  () =>
                    toast.error(
                      'Could not copy the link. Select it and copy manually.'
                    )
                )
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </ActionButton>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  )
}

export const showShareProjectDialog = create<
  ShareProjectDialogProps,
  undefined
>(ShareProjectDialog)
