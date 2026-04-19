import { Popover, Transition } from '@headlessui/react'
import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import { Fragment, useEffect, useState } from 'react'

export interface ShareDialogSubmitArgs {
  isRestrictedToOrg: boolean
  password: string
}

type ShareDialogProps = {
  onClose: () => void
  onCopyLink: (args: ShareDialogSubmitArgs) => Promise<boolean>
  allowOrgRestrict: boolean
  allowPassword: boolean
  shareDisabled?: boolean
}

export function ShareDialog({
  onClose,
  onCopyLink,
  allowOrgRestrict,
  allowPassword,
  shareDisabled = false,
}: ShareDialogProps) {
  const [isRestrictedToOrg, setIsRestrictedToOrg] = useState(false)
  const [password, setPassword] = useState('')
  const [activeAction, setActiveAction] = useState<'copy' | null>(null)

  useEffect(() => {
    setIsRestrictedToOrg(false)
    setPassword('')
    setActiveAction(null)
  }, [])

  const isSubmitting = activeAction !== null
  const copyDisabled = shareDisabled || isSubmitting

  async function handleCopyLink() {
    if (copyDisabled) {
      return
    }

    setActiveAction('copy')
    try {
      const copied = await onCopyLink({
        isRestrictedToOrg,
        password,
      })
      if (copied) {
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
        className="absolute right-0 top-full z-20 mt-3 flex w-[26rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden border border-chalkboard-30/80 bg-chalkboard-10/95 rounded text-sm text-chalkboard-100 shadow-2xl backdrop-blur-sm dark:border-chalkboard-80/60 dark:bg-chalkboard-90/95 dark:text-chalkboard-10"
      >
        <div className="border-b border-chalkboard-20/70 bg-chalkboard-20/70 px-4 py-4 text-chalkboard-100 dark:border-chalkboard-80/70 dark:bg-chalkboard-80/70 dark:text-chalkboard-10">
          <div className="flex flex-row items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-medium leading-none">
                Share project
              </h2>
              <p className="mt-2 text-xs leading-5 text-chalkboard-70 dark:text-chalkboard-30">
                Copy a shareable link for the current file.
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
              className="shrink-0 whitespace-nowrap py-0.5 px-2"
              onClick={() => {
                void handleCopyLink()
              }}
            >
              {activeAction === 'copy' ? 'Copying...' : 'Copy link'}
            </ActionButton>
          </div>
        </div>

        <form
          className="flex flex-col gap-4 px-4 py-4"
          onSubmit={(event) => {
            event.preventDefault()
            void handleCopyLink()
          }}
        >
          <section className="flex flex-col gap-3">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-chalkboard-60 dark:text-chalkboard-40">
              Who has access
            </p>

            <div className="rounded-xl border border-chalkboard-20/80 bg-chalkboard-10/70 px-3 py-3 dark:border-chalkboard-80/70 dark:bg-chalkboard-100/40">
              <div className="flex flex-row items-start gap-2">
                <CustomIcon
                  name="link"
                  className="mt-0.5 h-4 w-4 text-chalkboard-60 dark:text-chalkboard-40"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                    <p className="text-chalkboard-100 dark:text-chalkboard-10">
                      Anyone with the link
                    </p>
                    <p className="shrink-0 text-chalkboard-60 dark:text-chalkboard-40">
                      can view
                    </p>
                  </div>
                  <p className="pt-1 text-xs leading-5 text-chalkboard-60 dark:text-chalkboard-40">
                    They can open a copy of this file in Zoo.
                  </p>
                </div>
              </div>
            </div>

            <label
              aria-label="Organization only access"
              className={`rounded-xl border border-chalkboard-20/80 px-3 py-3 dark:border-chalkboard-80/70 ${
                allowOrgRestrict
                  ? 'cursor-pointer bg-chalkboard-10/70 dark:bg-chalkboard-100/40'
                  : 'cursor-not-allowed opacity-60'
              }`}
            >
              <div className="flex items-start gap-3">
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
                  <p className="mt-1 text-xs leading-5 text-chalkboard-60 dark:text-chalkboard-40">
                    Restrict this link to members of your organization.
                  </p>
                  {!allowOrgRestrict && (
                    <p className="mt-1 text-xs leading-5 text-chalkboard-60 dark:text-chalkboard-40">
                      Requires an organization plan.
                    </p>
                  )}
                </div>
              </div>
            </label>

            <div
              className={`rounded-xl border border-chalkboard-20/80 px-3 py-3 dark:border-chalkboard-80/70 ${
                allowPassword
                  ? 'bg-chalkboard-10/70 dark:bg-chalkboard-100/40'
                  : 'opacity-60'
              }`}
            >
              <label
                htmlFor="share-link-password"
                className="block text-chalkboard-100 dark:text-chalkboard-10"
              >
                Password
              </label>
              <input
                id="share-link-password"
                type="text"
                value={password}
                disabled={!allowPassword}
                onChange={(event) => setPassword(event.target.value)}
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
                placeholder="Set a password"
                className={`mt-2 w-full rounded border border-chalkboard-20/80 bg-chalkboard-10/90 px-2.5 py-2 text-sm text-chalkboard-100 placeholder:text-chalkboard-60 focus:outline-none focus-visible:outline-appForeground dark:border-chalkboard-80/70 dark:bg-chalkboard-90/80 dark:text-chalkboard-10 dark:placeholder:text-chalkboard-40 ${
                  allowPassword ? '' : 'cursor-not-allowed'
                }`}
              />
              {!allowPassword && (
                <p className="mt-2 text-xs leading-5 text-chalkboard-60 dark:text-chalkboard-40">
                  Requires a paid plan.
                </p>
              )}
            </div>
            {shareDisabled && (
              <p className="text-xs leading-5 text-chalkboard-60 dark:text-chalkboard-40">
                Share links are not currently supported for multi-file
                assemblies.
              </p>
            )}
          </section>
        </form>
      </Popover.Panel>
    </Transition>
  )
}
