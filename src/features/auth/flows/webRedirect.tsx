import { computed } from '@preact/signals'
import { Button } from '@kittycad/ui-kit'
import { useService } from '@src/app/context'
import { type SignInFlow, authService } from '@src/contracts/auth'

function siteBaseUrl(): string {
  return (
    (import.meta.env?.VITE_KC_SITE_BASE_URL as string | undefined) ??
    'https://zoo.dev'
  )
}

/**
 * Where the Zoo site should send the user back to.
 *
 * The current URL, so signing in from a deep link returns to that link rather
 * than to the home screen.
 */
function callbackUrl(): string {
  return window.location.href
}

function WebRedirectButton() {
  const auth = useService(authService)

  const start = () => {
    const url = new URL('/signin', siteBaseUrl())
    url.searchParams.set('callbackUrl', callbackUrl())
    // A full navigation, not a popup: the site sets a cookie for its own
    // origin, and returning here is what makes it readable.
    window.location.assign(url.toString())
  }

  return (
    <div class="zds-signin__flow">
      <p class="zds-signin__flow-description">
        You will be returned here once you have signed in.
      </p>
      <div class="zds-signin__row">
        <Button
          variant="primary"
          icon="arrowUpRight"
          label="Sign in with Zoo"
          onClick={start}
        />
        <Button
          label="I have already signed in"
          onClick={() => {
            // The cookie is set on this origin by now, so re-verifying picks it
            // up without another round trip.
            void auth.refresh()
          }}
        />
      </div>
    </div>
  )
}

/**
 * The browser sign-in flow.
 *
 * Web only: a redirect away and back is how the site's session cookie becomes
 * readable here, and there is nowhere to redirect *to* in a desktop window.
 */
export function createWebRedirectFlow(isWeb: () => boolean): SignInFlow {
  return {
    id: 'auth.webRedirect',
    order: 0,
    title: 'Sign in with Zoo',
    description: 'Use your Zoo account in the browser.',
    available: computed(() => isWeb()),
    render: () => <WebRedirectButton />,
  }
}
