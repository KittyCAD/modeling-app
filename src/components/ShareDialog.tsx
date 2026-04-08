import { Dialog, Transition } from '@headlessui/react'
import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import { Fragment, useEffect, useState } from 'react'

export interface ShareDialogSubmitArgs {
  isRestrictedToOrg: boolean
  password?: string
}

type ShareDialogProps = {
  isOpen: boolean
  onClose: () => void
  onSubmit: (args: ShareDialogSubmitArgs) => Promise<boolean>
  allowOrgRestrict: boolean
  allowPassword: boolean
  disabled?: boolean
}

export function ShareDialog({
  isOpen,
  onClose,
  onSubmit,
  allowOrgRestrict,
  allowPassword,
  disabled = false,
}: ShareDialogProps) {
  const [isRestrictedToOrg, setIsRestrictedToOrg] = useState(false)
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (isOpen) {
      return
    }

    setIsRestrictedToOrg(false)
    setPassword('')
    setIsSubmitting(false)
  }, [isOpen])

  const copyDisabled = disabled || isSubmitting

  async function handleSubmit() {
    if (copyDisabled) {
      return
    }

    setIsSubmitting(true)
    try {
      const copied = await onSubmit({
        isRestrictedToOrg,
        password: password.trim() || undefined,
      })
      if (copied) {
        onClose()
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog
        as="div"
        className="fixed inset-0 z-40 overflow-y-auto p-4 pt-[14vh]"
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
          <Dialog.Overlay className="fixed inset-0 bg-chalkboard-110/45 backdrop-blur-[2px]" />
        </Transition.Child>

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
              <div className="flex items-center justify-between border-b border-chalkboard-20 px-5 py-4 dark:border-chalkboard-80">
                <div>
                  <Dialog.Title className="text-base font-medium">
                    Share this file
                  </Dialog.Title>
                  <p className="mt-1 text-sm text-chalkboard-70 dark:text-chalkboard-40">
                    Create a shareable link that opens a copy in Zoo.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <ActionButton
                    Element="button"
                    type="button"
                    iconStart={{ icon: 'link' }}
                    disabled={copyDisabled}
                    onClick={() => {
                      void handleSubmit()
                    }}
                  >
                    {isSubmitting ? 'Copying...' : 'Copy link'}
                  </ActionButton>
                  <button
                    type="button"
                    className="rounded p-1 text-chalkboard-70 hover:bg-chalkboard-20 hover:text-chalkboard-100 dark:text-chalkboard-40 dark:hover:bg-chalkboard-80 dark:hover:text-chalkboard-10"
                    onClick={onClose}
                    disabled={isSubmitting}
                    aria-label="Close share dialog"
                  >
                    <CustomIcon name="close" className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <form
                className="px-5 py-5"
                onSubmit={(event) => {
                  event.preventDefault()
                  void handleSubmit()
                }}
              >
                <div className="rounded-xl border border-chalkboard-20 bg-chalkboard-10/60 p-4 dark:border-chalkboard-80 dark:bg-chalkboard-90">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-chalkboard-60 dark:text-chalkboard-50">
                    Who has access
                  </p>

                  <div className="mt-4 space-y-3">
                    <div className="flex items-start gap-3 rounded-lg border border-chalkboard-20 px-3 py-3 dark:border-chalkboard-80">
                      <CustomIcon
                        name="link"
                        className="mt-0.5 h-5 w-5 text-chalkboard-70 dark:text-chalkboard-40"
                      />
                      <div className="flex-1">
                        <p className="text-sm font-medium">
                          Anyone with the link
                        </p>
                        <p className="mt-1 text-xs text-chalkboard-70 dark:text-chalkboard-40">
                          They can open a copy of this file in Zoo.
                        </p>
                      </div>
                      <span className="text-sm text-chalkboard-70 dark:text-chalkboard-40">
                        can view
                      </span>
                    </div>

                    <label
                      className={`flex items-start gap-3 rounded-lg border px-3 py-3 ${
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
                        className="mt-1 form-checkbox"
                      />
                      <div className="flex-1">
                        <p className="text-sm font-medium">Org. only access</p>
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

                    <div
                      className={`rounded-lg border px-3 py-3 ${
                        allowPassword
                          ? 'border-chalkboard-20 dark:border-chalkboard-80'
                          : 'border-chalkboard-20/70 opacity-60 dark:border-chalkboard-80/70'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <CustomIcon
                          name="lockClosed"
                          className="mt-0.5 h-5 w-5 text-chalkboard-70 dark:text-chalkboard-40"
                        />
                        <div className="flex-1">
                          <label
                            htmlFor="share-password"
                            className="text-sm font-medium"
                          >
                            Password protection
                          </label>
                          <p className="mt-1 text-xs text-chalkboard-70 dark:text-chalkboard-40">
                            Optional password required to open the link.
                          </p>
                          <input
                            id="share-password"
                            type="text"
                            disabled={!allowPassword}
                            value={password}
                            onChange={(event) =>
                              setPassword(event.target.value)
                            }
                            autoCapitalize="off"
                            autoComplete="off"
                            autoCorrect="off"
                            spellCheck="false"
                            placeholder="Set a password"
                            className="mt-3 w-full rounded-md border border-chalkboard-30 bg-transparent px-3 py-2 text-sm outline-none ring-0 placeholder:text-chalkboard-60 focus:border-primary dark:border-chalkboard-70 dark:placeholder:text-chalkboard-50"
                          />
                          {!allowPassword && (
                            <p className="mt-2 text-xs text-chalkboard-60 dark:text-chalkboard-50">
                              Requires a paid plan.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {disabled && (
                  <p className="mt-4 text-sm text-chalkboard-70 dark:text-chalkboard-40">
                    Share links are not currently supported for multi-file
                    assemblies.
                  </p>
                )}
              </form>
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  )
}
