import { ActionButton } from '../components/ActionButton'
import { isTauri } from '../lib/isTauri'
import { invoke } from '@tauri-apps/api/tauri'
import { VITE_KC_SITE_BASE_URL, VITE_KC_API_BASE_URL } from '../env'
import { Themes, getSystemTheme } from '../lib/theme'
import { paths } from '../Router'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'
import { APP_NAME } from 'lib/constants'

const SignIn = () => {
  const {
    auth: { send },
    settings: {
      state: {
        context: { theme },
      },
    },
  } = useGlobalStateContext()

  const appliedTheme = theme === Themes.System ? getSystemTheme() : theme
  const signInTauri = async () => {
    // We want to invoke our command to login via device auth.
    try {
      const token: string = await invoke('login', {
        host: VITE_KC_API_BASE_URL,
      })
      send({ type: 'Log in', token })
    } catch (error) {
      console.error('login button', error)
    }
  }

  return (
    <main className="body-bg h-full min-h-screen m-0 p-0 pt-24">
      <div className="max-w-2xl mx-auto">
        <div>
          <img
            src={`/kittycad-logomark${
              appliedTheme === Themes.Dark ? '-light' : ''
            }.svg`}
            alt="KittyCAD"
            className="w-48 inline-block"
          />
          <span className="text-3xl leading-none w-auto inline-block align-middle ml-2">
            Modeling App
          </span>
        </div>
        <h1 className="font-bold text-2xl mt-12 mb-6">
          Sign in to get started with the {APP_NAME}
        </h1>
        <p className="py-4">
          ZMA is an open-source CAD application for creating accurate 3D models
          for use in manufacturing. It is built on top of KittyCAD, the design API from Zoo.
          Zoo is the first software infrastructure company built
          specifically for the needs of the manufacturing industry. With ZMA we
          are showing how the KittyCAD API from Zoo can be used to build entirely new
          kinds of software for manufacturing.
        </p>
        <p className="py-4">
          ZMA is currently in development. If you would like to be notified
          when ZMA is ready for production, please sign up for our mailing list
          at <a href="https://zoo.dev">zoo.dev</a>.
        </p>
        {isTauri() ? (
          <ActionButton
            Element="button"
            onClick={signInTauri}
            icon={{ icon: 'arrowRight' }}
            className="w-fit mt-4"
            data-testid="sign-in-button"
          >
            Sign in
          </ActionButton>
        ) : (
          <ActionButton
            Element="link"
            to={`${VITE_KC_SITE_BASE_URL}${
              paths.SIGN_IN
            }?callbackUrl=${encodeURIComponent(
              typeof window !== 'undefined' &&
                window.location.href.replace('signin', '')
            )}`}
            icon={{ icon: 'arrowRight' }}
            className="w-fit mt-4"
          >
            Sign in
          </ActionButton>
        )}
      </div>
    </main>
  )
}

export default SignIn
