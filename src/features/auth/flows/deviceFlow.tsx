import { computed, useSignal } from '@preact/signals'
import { Button, Spinner } from '@kittycad/ui-kit'
import { useService } from '@src/app/context'
import { type SignInFlow, authService } from '@src/contracts/auth'

/**
 * Where the device endpoints live.
 *
 * The **API** host, not the marketing site: `/oauth2/device/auth` and
 * `/oauth2/device/token` are API routes. Pointing at the site host returns an
 * unhelpful HTTP error rather than anything that names the mistake.
 */
function deviceIssuerUrl(): string {
  return (
    (import.meta.env?.VITE_KC_API_BASE_URL as string | undefined) ??
    'https://api.zoo.dev'
  )
}

function DeviceFlowPanel() {
  const auth = useService(authService)
  const userCode = useSignal<string | null>(null)
  const waiting = useSignal(false)
  const failure = useSignal<string | null>(null)

  const start = async () => {
    const bridge = window.electron
    if (!bridge) return

    failure.value = null
    waiting.value = true

    try {
      const authorization = await bridge.startDeviceFlow(deviceIssuerUrl())
      userCode.value = authorization.userCode

      // Opens the browser and blocks until the user confirms, so the code stays
      // on screen for as long as it is needed.
      const token = await bridge.completeDeviceFlow()
      if (!token) {
        failure.value = 'Sign-in was not completed.'
        return
      }
      await auth.signIn(token, 'deviceFlow')
    } catch (caught) {
      failure.value =
        caught instanceof Error ? caught.message : 'Sign-in failed.'
    } finally {
      waiting.value = false
      userCode.value = null
    }
  }

  const cancel = () => {
    void window.electron?.cancelDeviceFlow()
    waiting.value = false
    userCode.value = null
  }

  if (waiting.value) {
    return (
      <div class="zds-signin__flow">
        {userCode.value ? (
          <>
            <p class="zds-signin__flow-description">
              Enter this code in the browser window that just opened.
            </p>
            {/* Mono and large: this is a code to be read aloud and typed. */}
            <p class="zds-signin__code">{userCode.value}</p>
          </>
        ) : (
          <p class="zds-signin__flow-description">Requesting a code…</p>
        )}
        <div class="zds-signin__row">
          <Spinner label="Waiting for confirmation" />
          <span class="zds-body-secondary">Waiting for confirmation</span>
          <Button label="Cancel" onClick={cancel} />
        </div>
      </div>
    )
  }

  return (
    <div class="zds-signin__flow">
      <p class="zds-signin__flow-description">
        A browser window will open with a code to confirm.
      </p>
      <div class="zds-signin__row">
        <Button
          variant="primary"
          icon="arrowUpRight"
          label="Sign in with Zoo"
          onClick={() => {
            void start()
          }}
        />
      </div>
      {failure.value ? (
        <p class="zds-signin__error" role="alert">
          {failure.value}
        </p>
      ) : null}
    </div>
  )
}

/**
 * The desktop sign-in flow.
 *
 * OAuth2 device authorization: the app asks for a code, the user confirms it in
 * a browser, and the app polls for the token. It exists because a desktop app
 * has nowhere to redirect back to and cannot keep a client secret.
 *
 * The token exchange happens in the main process. The renderer only ever sees
 * the code to display and the final token, which is what keeps a compromised
 * renderer from driving the flow itself.
 */
export function createDeviceFlow(isDesktop: () => boolean): SignInFlow {
  return {
    id: 'auth.deviceFlow',
    order: 0,
    title: 'Sign in with Zoo',
    description: 'Confirm this device in your browser.',
    available: computed(() => isDesktop()),
    render: () => <DeviceFlowPanel />,
  }
}
