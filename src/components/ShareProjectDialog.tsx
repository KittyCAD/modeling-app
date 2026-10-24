import { Dialog, Transition } from '@headlessui/react'
import { ActionButton } from '@src/components/ActionButton'
import { Fragment, useEffect, useState } from 'react'
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
      <Transition
        appear
        as={Fragment}
        show={isOpen}
        enter="ease-out duration-100"
        enterFrom="opacity-0 translate-y-1 scale-[0.98]"
        enterTo="opacity-100 translate-y-0 scale-100"
        leave="ease-in duration-75"
        leaveFrom="opacity-100 translate-y-0 scale-100"
        leaveTo="opacity-0 translate-y-1 scale-[0.98]"
      >
        <Dialog.Panel className="fixed bottom-4 right-4 top-16 z-50 flex w-[30rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded border border-chalkboard-30/80 bg-chalkboard-10/95 text-sm text-chalkboard-100 shadow-2xl backdrop-blur-sm dark:border-chalkboard-80/60 dark:bg-chalkboard-90/95 dark:text-chalkboard-10">
          <div className="shrink-0 border-b border-chalkboard-20/70 bg-chalkboard-20/70 px-4 py-4 dark:border-chalkboard-80/70 dark:bg-chalkboard-80/70">
            <Dialog.Title
              as="h2"
              className="text-base font-medium leading-none"
            >
              Share project
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-xs leading-5 text-chalkboard-70 dark:text-chalkboard-30">
              Sign-in is required. People with access will see the latest
              version.
            </Dialog.Description>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-4">
            <div>
              <label
                className="text-xs font-medium uppercase tracking-[0.14em] text-chalkboard-60 dark:text-chalkboard-40"
                htmlFor="project-share-link"
              >
                Project link
              </label>
              <input
                id="project-share-link"
                type="url"
                readOnly
                value={url}
                onFocus={(event) => event.currentTarget.select()}
                className="mt-2 w-full rounded border border-chalkboard-20/80 bg-chalkboard-10/90 px-2.5 py-2 text-sm text-chalkboard-100 focus:outline-none focus-visible:outline-appForeground dark:border-chalkboard-80/70 dark:bg-chalkboard-90/80 dark:text-chalkboard-10"
              />
            </div>
            <div className="mt-auto flex justify-end gap-2">
              <ActionButton
                Element="button"
                tabIndex={0}
                type="button"
                className="h-8 !rounded-md"
                onClick={() => onResolve()}
              >
                Done
              </ActionButton>
              <ActionButton
                Element="button"
                tabIndex={0}
                type="button"
                iconStart={{
                  icon: 'clipboard',
                  bgClassName: '!bg-transparent',
                }}
                className="h-8 !rounded-md"
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
          </div>
        </Dialog.Panel>
      </Transition>
    </Dialog>
  )
}

export const showShareProjectDialog = create<
  ShareProjectDialogProps,
  undefined
>(ShareProjectDialog)
