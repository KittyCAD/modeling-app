import { Dialog, Transition } from '@headlessui/react'
import { CustomIcon } from '@src/components/CustomIcon'
import type { CurrentProjectPublicationDetails } from '@src/lib/share'
import { Fragment, useEffect, useState } from 'react'

export interface ShareDialogSubmitArgs {
  isRestrictedToOrg: boolean
}

type ShareDialogProps = {
  isOpen: boolean
  onClose: () => void
  onCopyLink: (args: ShareDialogSubmitArgs) => Promise<boolean>
  onPublish: () => Promise<boolean>
  allowOrgRestrict: boolean
  shareDisabled?: boolean
  publicationDetails?: CurrentProjectPublicationDetails | null
  isLoadingPublicationDetails?: boolean
}

export function ShareDialog({
  isOpen,
  onClose,
  onCopyLink,
  onPublish,
  allowOrgRestrict,
  shareDisabled = false,
  publicationDetails = null,
  isLoadingPublicationDetails = false,
}: ShareDialogProps) {
  const [isRestrictedToOrg, setIsRestrictedToOrg] = useState(false)
  const [activeAction, setActiveAction] = useState<'copy' | 'publish' | null>(
    null
  )

  useEffect(() => {
    if (isOpen) {
      return
    }

    setIsRestrictedToOrg(false)
    setActiveAction(null)
  }, [isOpen])

  const isSubmitting = activeAction !== null
  const copyDisabled = shareDisabled || isSubmitting
  const publishDisabled = isSubmitting
  const publishButtonLabel = getPublishButtonLabel(
    publicationDetails?.publicationStatus
  )
  const publishPrompt = getPublishPrompt({
    publicationDetails,
    isLoadingPublicationDetails,
  })

  async function handleCopyLink() {
    if (copyDisabled) {
      return
    }

    setActiveAction('copy')
    try {
      const copied = await onCopyLink({
        isRestrictedToOrg,
      })
      if (copied) {
        onClose()
      }
    } finally {
      setActiveAction(null)
    }
  }

  async function handlePublish() {
    if (publishDisabled) {
      return
    }

    setActiveAction('publish')
    try {
      const published = await onPublish()
      if (published) {
        onClose()
      }
    } finally {
      setActiveAction(null)
    }
  }

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-40"
        onClose={() => {
          if (!isSubmitting) {
            onClose()
          }
        }}
      >
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <Dialog.Overlay className="fixed inset-0 bg-chalkboard-10/70 dark:bg-chalkboard-110/50" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto p-4 pt-[14vh]">
          <div className="flex min-h-full items-start justify-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 translate-y-3 scale-[0.98]"
              enterTo="opacity-100 translate-y-0 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 translate-y-0 scale-100"
              leaveTo="opacity-0 translate-y-2 scale-[0.98]"
            >
              <Dialog.Panel className="w-full max-w-2xl overflow-hidden rounded-xl border border-chalkboard-30 bg-chalkboard-10 text-chalkboard-100 shadow-2xl dark:border-chalkboard-70 dark:bg-chalkboard-100 dark:text-chalkboard-10">
                <div className="flex items-start justify-between border-b border-chalkboard-20 px-5 py-4 dark:border-chalkboard-80">
                  <div className="max-w-[30rem] pr-4">
                    <Dialog.Title className="text-base font-medium">
                      Share this project
                    </Dialog.Title>
                    <p className="mt-1 text-sm text-chalkboard-70 dark:text-chalkboard-40">
                      Copy a shareable link or submit this project for public
                      review.
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 self-start">
                    <button
                      type="button"
                      disabled={copyDisabled}
                      className="inline-flex h-8 items-center gap-2 whitespace-nowrap rounded border border-chalkboard-30 px-3 text-xs font-medium text-chalkboard-100 hover:bg-chalkboard-20 disabled:cursor-not-allowed disabled:text-chalkboard-60 dark:border-chalkboard-70 dark:text-chalkboard-10 dark:hover:bg-chalkboard-80 dark:disabled:text-chalkboard-50"
                      onClick={() => {
                        void handleCopyLink()
                      }}
                    >
                      <CustomIcon
                        name="link"
                        className="h-4 w-4 text-chalkboard-70 dark:text-chalkboard-40"
                      />
                      {activeAction === 'copy' ? 'Copying...' : 'Copy link'}
                    </button>
                    <button
                      type="button"
                      className="rounded p-1.5 text-chalkboard-70 hover:bg-chalkboard-20 hover:text-chalkboard-100 dark:text-chalkboard-40 dark:hover:bg-chalkboard-80 dark:hover:text-chalkboard-10"
                      onClick={onClose}
                      disabled={isSubmitting}
                      aria-label="Close share dialog"
                    >
                      <CustomIcon name="close" className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <form
                  className="space-y-4 px-5 py-5"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void handleCopyLink()
                  }}
                >
                  <section className="rounded-xl border border-chalkboard-20 bg-chalkboard-10/60 p-4 dark:border-chalkboard-80 dark:bg-chalkboard-90">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-chalkboard-60 dark:text-chalkboard-50">
                      Who has access
                    </p>

                    <div className="mt-4 space-y-3">
                      <div className="flex items-center gap-3 rounded-lg border border-chalkboard-20 px-4 py-3 dark:border-chalkboard-80">
                        <CustomIcon
                          name="link"
                          className="h-5 w-5 text-chalkboard-70 dark:text-chalkboard-40"
                        />
                        <div className="flex-1">
                          <p className="text-sm font-medium">
                            Anyone with the link
                          </p>
                          <p className="mt-1 text-xs text-chalkboard-70 dark:text-chalkboard-40">
                            They can open a copy of this project in Zoo.
                          </p>
                        </div>
                        <span className="shrink-0 text-sm text-chalkboard-70 dark:text-chalkboard-40">
                          can view
                        </span>
                      </div>

                      <label
                        className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${
                          allowOrgRestrict
                            ? 'cursor-pointer border-chalkboard-20 dark:border-chalkboard-80'
                            : 'cursor-not-allowed border-chalkboard-20/70 opacity-60 dark:border-chalkboard-80/70'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isRestrictedToOrg}
                          disabled={!allowOrgRestrict}
                          onChange={() =>
                            setIsRestrictedToOrg((current) => !current)
                          }
                          className="mt-1 h-4 w-4 form-checkbox"
                        />
                        <div className="flex-1">
                          <p className="text-sm font-medium">
                            Org. only access
                          </p>
                          <p className="mt-1 text-xs text-chalkboard-70 dark:text-chalkboard-40">
                            Restrict this link to members of your organization.
                          </p>
                          {!allowOrgRestrict && (
                            <p className="mt-2 text-xs text-chalkboard-60 dark:text-chalkboard-50">
                              Requires an organization plan.
                            </p>
                          )}
                        </div>
                      </label>
                    </div>
                  </section>

                  {shareDisabled && (
                    <p className="text-sm text-chalkboard-70 dark:text-chalkboard-40">
                      Share links are not currently supported for multi-file
                      assemblies, but you can still publish this project for
                      review.
                    </p>
                  )}

                  <section className="rounded-xl border border-chalkboard-20 bg-chalkboard-10/60 p-4 dark:border-chalkboard-80 dark:bg-chalkboard-90">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-chalkboard-60 dark:text-chalkboard-50">
                          Publish to Aquarium
                        </p>
                        <p className="mt-2 text-sm text-chalkboard-70 dark:text-chalkboard-40">
                          {publishPrompt}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={publishDisabled}
                        className="inline-flex h-8 items-center justify-center whitespace-nowrap rounded border border-chalkboard-30 px-3 text-xs font-medium text-chalkboard-100 hover:bg-chalkboard-20 disabled:cursor-not-allowed disabled:text-chalkboard-60 dark:border-chalkboard-70 dark:text-chalkboard-10 dark:hover:bg-chalkboard-80 dark:disabled:text-chalkboard-50"
                        onClick={() => {
                          void handlePublish()
                        }}
                      >
                        {activeAction === 'publish'
                          ? 'Publishing...'
                          : publishButtonLabel}
                      </button>
                    </div>
                  </section>
                </form>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}

function getPublishButtonLabel(
  publicationStatus?: CurrentProjectPublicationDetails['publicationStatus']
) {
  switch (publicationStatus) {
    case 'published':
      return 'Update published version'
    case 'pending_review':
      return 'Update review submission'
    case 'rejected':
      return 'Resubmit for review'
    default:
      return 'Publish'
  }
}

function getPublishPrompt({
  publicationDetails,
  isLoadingPublicationDetails,
}: {
  publicationDetails: CurrentProjectPublicationDetails | null
  isLoadingPublicationDetails: boolean
}) {
  if (isLoadingPublicationDetails) {
    return 'Checking whether this project has already been published.'
  }

  if (!publicationDetails) {
    return 'Submit this project for review so it can be approved for public listing.'
  }

  switch (publicationDetails.publicationStatus) {
    case 'published': {
      const publishedOn = publicationDetails.publishedAt
        ? formatDate(publicationDetails.publishedAt)
        : null
      return publishedOn
        ? `This project was last published on ${publishedOn}. Publish again to update the public version.`
        : 'This project has already been published. Publish again to update the public version.'
    }
    case 'pending_review':
      return `This project was last submitted for review on ${formatDate(publicationDetails.updatedAt)}. Publish again to update the pending review version.`
    case 'rejected':
      return 'This project has been submitted before. Publish again to resubmit it for approval.'
    case 'deleted':
      return 'This project was previously published. Publish again to submit a new version for review.'
    default:
      return 'Submit this project for review so it can be approved for public listing.'
  }
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}
