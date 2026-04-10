import { Popover, Transition } from '@headlessui/react'
import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import type { CurrentProjectPublicationDetails } from '@src/lib/share'
import { Fragment, useEffect, useState } from 'react'

export interface ShareDialogSubmitArgs {
  isRestrictedToOrg: boolean
}

type ShareDialogProps = {
  onClose: () => void
  onCopyLink: (args: ShareDialogSubmitArgs) => Promise<boolean>
  onPublish: () => Promise<boolean>
  allowOrgRestrict: boolean
  shareDisabled?: boolean
  publicationDetails?: CurrentProjectPublicationDetails | null
  isLoadingPublicationDetails?: boolean
}

export function ShareDialog({
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
    setIsRestrictedToOrg(false)
    setActiveAction(null)
  }, [])

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
    <Transition
      appear
      as={Fragment}
      show={true}
      enter="ease-out duration-100"
      enterFrom="opacity-0 translate-y-1 scale-[0.98]"
      enterTo="opacity-100 translate-y-0 scale-100"
      leave="ease-in duration-75"
      leaveFrom="opacity-100 translate-y-0 scale-100"
      leaveTo="opacity-0 translate-y-1 scale-[0.98]"
    >
      <Popover.Panel
        focus={true}
        className="absolute right-0 top-full z-20 mt-1 w-[26rem] flex flex-col gap-1 align-stretch rounded-lg bg-chalkboard-10 dark:bg-chalkboard-90 shadow-lg border border-solid border-chalkboard-20/50 dark:border-chalkboard-80/50 text-sm text-chalkboard-100 dark:text-chalkboard-10"
      >
        <div className="flex flex-col p-2 mb-1 rounded-t-sm bg-chalkboard-20 text-chalkboard-100 dark:bg-chalkboard-80 dark:text-chalkboard-10">
          <div className="flex flex-row justify-between items-start gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-sans font-normal">Share project</h2>
              <p className="mt-1 text-xs text-chalkboard-70 dark:text-chalkboard-30">
                Copy a shareable link or publish this project for review.
              </p>
            </div>
            <ActionButton
              Element="button"
              type="button"
              disabled={copyDisabled}
              iconStart={{
                icon: 'link',
                bgClassName: '!bg-transparent',
                size: 'sm',
              }}
              className="ml-2 py-0.5 pr-2 whitespace-nowrap shrink-0"
              onClick={() => {
                void handleCopyLink()
              }}
            >
              {activeAction === 'copy' ? 'Copying...' : 'Copy link'}
            </ActionButton>
          </div>
        </div>

        <form
          className="flex flex-col gap-0.5"
          onSubmit={(event) => {
            event.preventDefault()
            void handleCopyLink()
          }}
        >
          <div className="flex flex-col px-2 py-2 gap-1">
            <p className="text-xs font-sans font-normal text-chalkboard-60 dark:text-chalkboard-40">
              Who has access
            </p>

            <div className="flex flex-row items-center gap-2">
              <CustomIcon
                name="link"
                className="h-4 w-4 text-chalkboard-60 dark:text-chalkboard-40"
              />
              <p className="flex-1 text-chalkboard-100 dark:text-chalkboard-10">
                Anyone with the link
              </p>
              <p className="text-chalkboard-60 dark:text-chalkboard-40">
                can view
              </p>
            </div>
            <p className="pl-6 text-xs text-chalkboard-60 dark:text-chalkboard-40">
              They can open a copy of this project in Zoo.
            </p>
          </div>

          <div className="flex flex-col px-2 py-2 gap-2 border-t border-chalkboard-20/50 dark:border-chalkboard-80/50">
            <label
              className={`flex items-start gap-2 ${
                allowOrgRestrict ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
              }`}
            >
              <input
                type="checkbox"
                checked={isRestrictedToOrg}
                disabled={!allowOrgRestrict}
                onChange={() => setIsRestrictedToOrg((current) => !current)}
                className="mt-0.5 h-4 w-4 form-checkbox"
              />
              <div className="flex-1">
                <p className="text-chalkboard-100 dark:text-chalkboard-10">
                  Org. only access
                </p>
                <p className="mt-1 text-xs text-chalkboard-60 dark:text-chalkboard-40">
                  Restrict this link to members of your organization.
                </p>
                {!allowOrgRestrict && (
                  <p className="mt-1 text-xs text-chalkboard-60 dark:text-chalkboard-40">
                    Requires an organization plan.
                  </p>
                )}
              </div>
            </label>
            {shareDisabled && (
              <p className="text-xs text-chalkboard-60 dark:text-chalkboard-40">
                Share links are not currently supported for multi-file assemblies.
              </p>
            )}
          </div>

          <div className="flex flex-col px-2 py-2 gap-2 border-t border-chalkboard-20/50 dark:border-chalkboard-80/50">
            <p className="text-chalkboard-100 dark:text-chalkboard-10">
              Publish to Aquarium
            </p>
            <p className="text-xs text-chalkboard-60 dark:text-chalkboard-40">
              {publishPrompt}
            </p>
            <div className="flex justify-end">
              <ActionButton
                Element="button"
                type="button"
                disabled={publishDisabled}
                className="py-0.5 whitespace-nowrap"
                onClick={() => {
                  void handlePublish()
                }}
              >
                {activeAction === 'publish'
                  ? 'Publishing...'
                  : publishButtonLabel}
              </ActionButton>
            </div>
          </div>
        </form>
      </Popover.Panel>
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
