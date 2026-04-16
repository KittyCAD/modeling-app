import { Popover, Transition } from '@headlessui/react'
import { ActionButton } from '@src/components/ActionButton'
import { withAPIBaseURL } from '@src/lib/withBaseURL'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import type {
  CurrentProjectPublicationDetails,
  ProjectPublishSubmission,
} from '@src/lib/share'
import type { ProjectCategoryResponse } from '@kittycad/lib'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'

type PublishDialogProps = {
  onClose: () => void
  onSubmit: (args: ProjectPublishSubmission) => Promise<boolean>
  initialTitle?: string
  publishDisabled?: boolean
  publishRequiresUsername?: boolean
  accountUrl: string
  publicationDetails?: CurrentProjectPublicationDetails | null
  isLoadingPublicationDetails?: boolean
}

const AQUARIUM_TERMS_URL = 'https://zoo.dev/aquarium-terms-of-use'

export function PublishDialog({
  onClose,
  onSubmit,
  initialTitle = '',
  publishDisabled = false,
  publishRequiresUsername = false,
  accountUrl,
  publicationDetails = null,
  isLoadingPublicationDetails = false,
}: PublishDialogProps) {
  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState('')
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([])
  const [hasEditedTitle, setHasEditedTitle] = useState(false)
  const [hasEditedDescription, setHasEditedDescription] = useState(false)
  const [hasEditedCategories, setHasEditedCategories] = useState(false)
  const [hasTriedSubmit, setHasTriedSubmit] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [categories, setCategories] = useState<ProjectCategoryResponse[]>([])
  const [isLoadingCategories, setIsLoadingCategories] = useState(true)
  const [categoriesError, setCategoriesError] = useState<string | null>(null)

  useEffect(() => {
    if (!publicationDetails) {
      return
    }

    if (!hasEditedTitle) {
      setTitle(publicationDetails.title || initialTitle)
    }
    if (!hasEditedDescription) {
      setDescription(publicationDetails.description || '')
    }
    if (!hasEditedCategories) {
      setSelectedCategoryIds(publicationDetails.categoryIds)
    }
  }, [
    hasEditedCategories,
    hasEditedDescription,
    hasEditedTitle,
    initialTitle,
    publicationDetails,
  ])

  const loadCategories = useCallback(async (signal?: AbortSignal) => {
    setIsLoadingCategories(true)
    setCategoriesError(null)

    try {
      const response = await fetch(withAPIBaseURL('/projects/categories'), {
        signal,
      })

      if (!response.ok) {
        setCategories([])
        setCategoriesError(await getResponseErrorMessage(response))
        return
      }

      const nextCategories =
        (await response.json()) as ProjectCategoryResponse[]
      setCategories(
        [...nextCategories].sort((a, b) => a.sort_order - b.sort_order)
      )
    } catch (error) {
      if (signal?.aborted) {
        return
      }

      setCategories([])
      setCategoriesError(
        error instanceof Error
          ? error.message
          : 'Failed to load Aquarium categories.'
      )
    } finally {
      if (!signal?.aborted) {
        setIsLoadingCategories(false)
      }
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void loadCategories(controller.signal)

    return () => {
      controller.abort()
    }
  }, [loadCategories])

  const titleIsValid = title.trim().length > 0
  const descriptionIsValid = description.trim().length > 0
  const lastSubmittedText = useMemo(
    () => getLastSubmittedText(publicationDetails),
    [publicationDetails]
  )

  async function handleSubmit() {
    setHasTriedSubmit(true)

    if (
      !titleIsValid ||
      !descriptionIsValid ||
      isSubmitting ||
      publishDisabled
    ) {
      return
    }

    setIsSubmitting(true)
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        categoryIds: selectedCategoryIds,
      })
    } finally {
      setIsSubmitting(false)
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
      <Popover.Panel className="absolute right-0 top-full z-20 mt-3 flex w-[30rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded border border-chalkboard-30/80 bg-chalkboard-10/95 text-sm text-chalkboard-100 shadow-2xl backdrop-blur-sm dark:border-chalkboard-80/60 dark:bg-chalkboard-90/95 dark:text-chalkboard-10">
        <div className="border-b border-chalkboard-20/70 bg-chalkboard-20/70 px-4 py-4 text-chalkboard-100 dark:border-chalkboard-80/70 dark:bg-chalkboard-80/70 dark:text-chalkboard-10">
          <div className="min-w-0">
            <h2 className="text-base font-medium leading-none">
              Publish project
            </h2>
            <p className="mt-2 text-xs leading-5 text-chalkboard-70 dark:text-chalkboard-30">
              Submit this project for review in the Aquarium.
            </p>
          </div>
        </div>

        <form
          className="flex flex-col gap-4 px-4 py-4"
          onSubmit={(event) => {
            event.preventDefault()
            void handleSubmit()
          }}
        >
          <section className="flex flex-col gap-3">
            <div>
              <label
                htmlFor="publish-project-title"
                className="text-xs font-medium uppercase tracking-[0.14em] text-chalkboard-60 dark:text-chalkboard-40"
              >
                Title*
              </label>
              <input
                id="publish-project-title"
                type="text"
                required
                value={title}
                onChange={(event) => {
                  setHasEditedTitle(true)
                  setTitle(event.target.value)
                }}
                placeholder="My awesome CAD project"
                aria-invalid={hasTriedSubmit && !titleIsValid}
                className={`mt-2 w-full rounded border bg-chalkboard-10/90 px-2.5 py-2 text-sm text-chalkboard-100 placeholder:text-chalkboard-60 focus:outline-none focus-visible:outline-appForeground dark:bg-chalkboard-90/80 dark:text-chalkboard-10 dark:placeholder:text-chalkboard-40 ${
                  hasTriedSubmit && !titleIsValid
                    ? 'border-destroy-60'
                    : 'border-chalkboard-20/80 dark:border-chalkboard-80/70'
                }`}
              />
              {hasTriedSubmit && !titleIsValid && (
                <p className="mt-2 text-xs leading-5 text-destroy-60 dark:text-destroy-40">
                  A title is required.
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="publish-project-description"
                className="text-xs font-medium uppercase tracking-[0.14em] text-chalkboard-60 dark:text-chalkboard-40"
              >
                Description*
              </label>
              <textarea
                id="publish-project-description"
                required
                rows={4}
                value={description}
                onChange={(event) => {
                  setHasEditedDescription(true)
                  setDescription(event.target.value)
                }}
                placeholder="Tell people about what you made..."
                aria-invalid={hasTriedSubmit && !descriptionIsValid}
                className={`mt-2 w-full resize-none rounded border bg-chalkboard-10/90 px-2.5 py-2 text-sm text-chalkboard-100 placeholder:text-chalkboard-60 focus:outline-none focus-visible:outline-appForeground dark:bg-chalkboard-90/80 dark:text-chalkboard-10 dark:placeholder:text-chalkboard-40 ${
                  hasTriedSubmit && !descriptionIsValid
                    ? 'border-destroy-60'
                    : 'border-chalkboard-20/80 dark:border-chalkboard-80/70'
                }`}
              />
              {hasTriedSubmit && !descriptionIsValid && (
                <p className="mt-2 text-xs leading-5 text-destroy-60 dark:text-destroy-40">
                  A description is required.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-chalkboard-60 dark:text-chalkboard-40">
                Categories
              </p>

              <div className="max-h-72 overflow-y-auto rounded-xl border border-chalkboard-20/80 bg-chalkboard-10/70 p-2 dark:border-chalkboard-80/70 dark:bg-chalkboard-100/40">
                {isLoadingCategories ? (
                  <div className="px-2 py-6 text-xs leading-5 text-chalkboard-60 dark:text-chalkboard-40">
                    Loading Aquarium categories...
                  </div>
                ) : categoriesError ? (
                  <div className="flex flex-col gap-3 px-2 py-3 text-xs leading-5 text-chalkboard-60 dark:text-chalkboard-40">
                    <p>{categoriesError}</p>
                    <div>
                      <ActionButton
                        Element="button"
                        type="button"
                        className="py-0.5"
                        onClick={() => {
                          void loadCategories()
                        }}
                      >
                        Retry
                      </ActionButton>
                    </div>
                  </div>
                ) : categories.length === 0 ? (
                  <div className="px-2 py-6 text-xs leading-5 text-chalkboard-60 dark:text-chalkboard-40">
                    No Aquarium categories are currently available.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {categories.map((category) => {
                      const isSelected = selectedCategoryIds.includes(
                        category.id
                      )

                      return (
                        <button
                          key={category.id}
                          type="button"
                          role="checkbox"
                          aria-checked={isSelected}
                          className={`flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors focus-visible:outline-appForeground ${
                            isSelected
                              ? 'border-chalkboard-30/80 bg-chalkboard-10/90 dark:border-chalkboard-60/80 dark:bg-chalkboard-90/80'
                              : 'border-chalkboard-20/80 bg-chalkboard-10/40 hover:border-chalkboard-30/80 dark:border-chalkboard-80/70 dark:bg-chalkboard-100/20 dark:hover:border-chalkboard-70'
                          }`}
                          onClick={() => {
                            setHasEditedCategories(true)
                            setSelectedCategoryIds((current) =>
                              isSelected
                                ? current.filter(
                                    (value) => value !== category.id
                                  )
                                : [...current, category.id]
                            )
                          }}
                        >
                          <div
                            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border ${
                              isSelected
                                ? 'border-chalkboard-30 bg-chalkboard-100 text-chalkboard-10 dark:border-chalkboard-30 dark:bg-chalkboard-10 dark:text-chalkboard-100'
                                : 'border-chalkboard-30 bg-transparent text-transparent dark:border-chalkboard-70'
                            }`}
                          >
                            <CheckIcon />
                          </div>
                          <div className="min-w-0">
                            <p className="text-base font-medium leading-5 text-chalkboard-100 dark:text-chalkboard-10">
                              {category.display_name}
                            </p>
                            <p className="mt-1 text-sm leading-5 text-chalkboard-60 dark:text-chalkboard-40">
                              {category.description}
                            </p>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="border-t border-chalkboard-20/70 pt-4 dark:border-chalkboard-80/70">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-xs leading-5 text-chalkboard-60 dark:text-chalkboard-40">
                  {lastSubmittedText ? (
                    lastSubmittedText
                  ) : isLoadingPublicationDetails ? (
                    'Checking current Aquarium submission status...'
                  ) : (
                    <>
                      By submitting, you agree to our{' '}
                      <a
                        href={AQUARIUM_TERMS_URL}
                        target="_blank"
                        rel="noreferrer"
                        onClick={openExternalBrowserIfDesktop(
                          AQUARIUM_TERMS_URL
                        )}
                        className="underline underline-offset-2 hover:text-chalkboard-100 dark:hover:text-chalkboard-10"
                      >
                        Aquarium terms &amp; conditions
                      </a>
                      .
                    </>
                  )}
                </p>
                {publishRequiresUsername && (
                  <p className="mt-2 text-xs leading-5 text-destroy-60 dark:text-destroy-40">
                    Set a username in your{' '}
                    <a
                      href={accountUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={openExternalBrowserIfDesktop(accountUrl)}
                      className="underline underline-offset-2"
                    >
                      account settings
                    </a>{' '}
                    before publishing to Aquarium.
                  </p>
                )}
              </div>
              <ActionButton
                Element="button"
                type="submit"
                disabled={isSubmitting || publishDisabled}
                className="shrink-0 self-end whitespace-nowrap py-0.5 sm:self-auto"
              >
                {isSubmitting
                  ? 'Submitting...'
                  : getSubmitButtonLabel(publicationDetails)}
              </ActionButton>
            </div>
          </section>
        </form>
      </Popover.Panel>
    </Transition>
  )
}

function getSubmitButtonLabel(
  publicationDetails: CurrentProjectPublicationDetails | null
) {
  return publicationDetails &&
    publicationDetails.publicationStatus !== 'draft' &&
    publicationDetails.publicationStatus !== undefined
    ? 'Update submission'
    : 'Submit for review'
}

function getLastSubmittedText(
  publicationDetails: CurrentProjectPublicationDetails | null
) {
  if (!publicationDetails || publicationDetails.publicationStatus === 'draft') {
    return null
  }

  const lastSubmittedAt =
    publicationDetails.submittedAt || publicationDetails.updatedAt

  return `This project was last submitted for review on ${formatDate(lastSubmittedAt)}.`
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

async function getResponseErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as { message?: string }
    if (body.message) {
      return body.message
    }
  } catch {}

  try {
    const text = await response.text()
    if (text) {
      return text
    }
  } catch {}

  return 'Failed to load Aquarium categories.'
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path
        d="M3 8.5L6.25 11.75L13 4.75"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
