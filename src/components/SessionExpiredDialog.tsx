import { Dialog } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import { useApp } from '@src/lib/boot'
import { SESSION_EXPIRED_SIGN_IN_ROUTE_STATE_KEY } from '@src/lib/constants'
import { PATHS } from '@src/lib/paths'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import type { AuthRegistryService } from '@src/registry/contracts/auth'
import { generateSignInUrl } from '@src/routes/utils'
import { useNavigate } from 'react-router-dom'

type SessionExpiredDialogHostContentProps = {
  auth: AuthRegistryService
}

export function SessionExpiredDialogHost() {
  const { auth } = useApp()

  return <SessionExpiredDialogHostContent auth={auth} />
}

export function SessionExpiredDialogHostContent({
  auth,
}: SessionExpiredDialogHostContentProps) {
  useSignals()
  const navigate = useNavigate()
  const authState = auth.useAuthState()
  const open =
    Boolean(auth.sessionExpiredNotice.value) &&
    authState.matches('sessionExpired')

  if (!open) {
    return null
  }

  function signInAgain() {
    auth.clearSessionExpiredNotice()
    auth.send({ type: 'Acknowledge session expired' })

    if (window.electron) {
      void navigate(PATHS.SIGN_IN, {
        state: {
          [SESSION_EXPIRED_SIGN_IN_ROUTE_STATE_KEY]: true,
        },
      })
      return
    }

    window.location.href = generateSignInUrl()
  }

  return (
    <Dialog
      open={true}
      onClose={() => {}}
      className="fixed inset-0 z-50 overflow-y-auto p-4"
    >
      <Dialog.Overlay className="fixed inset-0 bg-chalkboard-10/80 dark:bg-chalkboard-110/40" />
      <div className="relative flex min-h-full items-center justify-center">
        <Dialog.Panel
          className="relative flex w-[min(92vw,28rem)] flex-col rounded border border-warn-70 bg-chalkboard-10 shadow-lg dark:border-warn-80 dark:bg-chalkboard-100"
          data-testid="session-expired-dialog"
        >
          <div className="flex items-start gap-3 border-b border-chalkboard-20 p-4 dark:border-chalkboard-70">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-warn-10 text-warn-90 dark:bg-warn-80/30 dark:text-warn-10">
              <CustomIcon name="lockClosed" className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <Dialog.Title as="h2" className="text-xl font-bold">
                Session expired
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-sm text-chalkboard-70 dark:text-chalkboard-30">
                You have been logged out. Sign in again to reconnect cloud sync
                and the modeling stream.
              </Dialog.Description>
              <p className="mt-2 text-sm text-chalkboard-70 dark:text-chalkboard-30">
                Your account may be blocked if you've seen this multiple times.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 p-4">
            <ActionButton
              Element="externalLink"
              to={withSiteBaseURL('/account')}
              tabIndex={0}
              iconStart={{ icon: 'link' }}
              className="py-1"
              rel="noreferrer"
            >
              Check your account standing
            </ActionButton>
            <ActionButton
              Element="button"
              type="button"
              tabIndex={0}
              onClick={signInAgain}
              iconStart={{ icon: 'lockClosed' }}
              className="border-warn-70 bg-warn-10/30 py-1 dark:bg-warn-80/20"
              data-testid="session-expired-sign-in-button"
            >
              Sign in again
            </ActionButton>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  )
}
