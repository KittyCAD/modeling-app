import { ActionButton } from '../components/ActionButton'
import { isDesktop } from '../lib/isDesktop'
import { VITE_KC_SITE_BASE_URL, VITE_KC_API_BASE_URL } from '../env'
import { Themes, getSystemTheme } from '../lib/theme'
import { PATHS } from 'lib/paths'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { APP_NAME } from 'lib/constants'
import { CSSProperties, useCallback } from 'react'
import { Logo } from 'components/Logo'
import { CustomIcon } from 'components/CustomIcon'
import { Link } from 'react-router-dom'
import { APP_VERSION } from './Settings'
import { openExternalBrowserIfDesktop } from 'lib/openWindow'
import { toSync } from 'lib/utils'
import { reportRejection } from 'lib/trap'

const subtleBorder =
  'border border-solid border-chalkboard-30 dark:border-chalkboard-80'
const cardArea = `${subtleBorder} rounded-lg px-6 py-3 text-chalkboard-70 dark:text-chalkboard-30`

const SignIn = () => {
  const {
    auth: { send },
    settings: {
      state: {
        context: {
          app: { theme },
        },
      },
    },
  } = useSettingsAuthContext()
  const signInUrl = `${VITE_KC_SITE_BASE_URL}${
    PATHS.SIGN_IN
  }?callbackUrl=${encodeURIComponent(
    typeof window !== 'undefined' && window.location.href.replace('signin', '')
  )}`
  const kclSampleUrl = `${VITE_KC_SITE_BASE_URL}/docs/kcl-samples/car-wheel`

  const getThemeText = useCallback(
    (shouldContrast = true) =>
      theme.current === Themes.Light ||
      (theme.current === Themes.System && getSystemTheme() === Themes.Light)
        ? shouldContrast
          ? '-dark'
          : ''
        : shouldContrast
        ? ''
        : '-dark',
    [theme.current]
  )

  const signInDesktop = async () => {
    // We want to invoke our command to login via device auth.
    try {
      const token: string = await window.electron.login(VITE_KC_API_BASE_URL)
      send({ type: 'Log in', token })
    } catch (error) {
      console.error('Error with login button', error)
    }
  }

  return (
    <main className="bg-primary h-screen grid place-items-stretch m-0 p-2">
      <div
        style={
          {
            height: 'calc(100vh - 16px)',
            '--circle-x': '14%',
            '--circle-y': '12%',
            '--circle-size-mid': '15%',
            '--circle-size-end': '200%',
            '--circle-timing': 'cubic-bezier(0.25, 1, 0.4, 0.9)',
          } as CSSProperties
        }
        className="in-circle-hesitate body-bg py-5 px-12 rounded-lg grid place-items-center overflow-y-auto"
      >
        <div className="max-w-7xl grid gap-5 grid-cols-3 xl:grid-cols-4 xl:grid-rows-5">
          <div className="col-span-2 xl:col-span-3 xl:row-span-3 max-w-3xl mr-8 mb-8">
            <div className="flex items-baseline mb-8">
              <Logo className="text-primary h-10 lg:h-12 xl:h-16 relative translate-y-1 mr-4 lg:mr-6 xl:mr-8" />
              <h1 className="text-3xl lg:text-4xl xl:text-5xl">{APP_NAME}</h1>
              <span className="px-3 py-1 text-base rounded-full bg-primary/10 text-primary self-start">
                alpha v{APP_VERSION}
              </span>
            </div>
            <p className="my-4 text-lg xl:text-xl">
              Thank you for using our hardware design application. It is built
              on a novel CAD engine and crafted to help you create parametric,
              version-controlled, and accurate parts ready for manufacturing.
            </p>
            <p className="my-4 text-lg xl:text-xl">
              As alpha software, Zoo Modeling App is still in heavy development.
              We encourage feedback and feature requests that align with{' '}
              <a
                href="https://github.com/KittyCAD/modeling-app/issues/729"
                target="_blank"
                rel="noreferrer"
              >
                our roadmap to v1.0
              </a>
              .
            </p>
            {isDesktop() ? (
              <button
                onClick={toSync(signInDesktop, reportRejection)}
                className={
                  'm-0 mt-8 flex gap-4 items-center px-3 py-1 ' +
                  '!border-transparent !text-lg !text-chalkboard-10 !bg-primary hover:hue-rotate-15'
                }
                data-testid="sign-in-button"
              >
                Sign in to get started
                <CustomIcon name="arrowRight" className="w-6 h-6" />
              </button>
            ) : (
              <Link
                onClick={openExternalBrowserIfDesktop(signInUrl)}
                to={signInUrl}
                className={
                  'w-fit m-0 mt-8 flex gap-4 items-center px-3 py-1 ' +
                  '!border-transparent !text-lg !text-chalkboard-10 !bg-primary hover:hue-rotate-15'
                }
                data-testid="sign-in-button"
              >
                Sign in to get started
                <CustomIcon name="arrowRight" className="w-6 h-6" />
              </Link>
            )}
          </div>
          <Link
            className={`group relative xl:h-full xl:row-span-full col-start--1 xl:col-start-4 rounded-lg overflow-hidden grid place-items-center ${subtleBorder}`}
            to={kclSampleUrl}
            onClick={openExternalBrowserIfDesktop(kclSampleUrl)}
            target="_blank"
            rel="noreferrer noopener"
          >
            <video
              autoPlay
              loop
              muted
              playsInline
              className="h-full object-cover object-center"
            >
              <source
                src={`${isDesktop() ? '.' : ''}/wheel-loop${getThemeText(
                  false
                )}.mp4`}
                type="video/mp4"
              />
            </video>
            <div
              className={
                'absolute bottom-0 left-0 right-0 transition translate-y-4 opacity-0 ' +
                'group-hover:translate-y-0 group-hover:opacity-100 ' +
                'm-0 mt-8 flex gap-4 items-center px-3 py-1 ' +
                '!border-transparent !text-lg !text-chalkboard-10 !bg-primary hover:hue-rotate-15'
              }
              data-testid="sign-in-button"
            >
              View this sample
              <CustomIcon name="arrowRight" className="w-6 h-6" />
            </div>
          </Link>
          <div className="self-end h-min col-span-3 xl:row-span-2 grid grid-cols-2 gap-5">
            <div className={cardArea}>
              <h2 className="text-xl">Built in the open</h2>
              <p className="text-xs my-4">
                Open-source and open discussions. Check our public code base and
                join our Discord.
              </p>
              <div className="flex gap-4 flex-wrap items-center">
                <ActionButton
                  Element="externalLink"
                  to="https://github.com/KittyCAD/modeling-app"
                  iconStart={{ icon: 'code' }}
                  className="border-chalkboard-30 dark:border-chalkboard-80"
                >
                  <span className="py-2 lg:py-0">Read our source code</span>
                </ActionButton>
                <ActionButton
                  Element="externalLink"
                  to="https://discord.gg/JQEpHR7Nt2"
                  iconStart={{ icon: 'keyboard' }}
                  className="border-chalkboard-30 dark:border-chalkboard-80"
                >
                  <span className="py-2 lg:py-0">Join our community</span>
                </ActionButton>
              </div>
            </div>
            <div className={cardArea}>
              <h2 className="text-xl">Ready for the future</h2>
              <p className="text-xs my-4">
                Modern software ideas being brought together to create a
                familiar modeling experience with new superpowers.
              </p>
              <div className="flex gap-4 flex-wrap items-center">
                <ActionButton
                  Element="externalLink"
                  to="https://zoo.dev/docs/kcl-samples/ball-bearing"
                  iconStart={{ icon: 'settings' }}
                  className="border-chalkboard-30 dark:border-chalkboard-80"
                >
                  <span className="py-2 lg:py-0">
                    Parametric design with KCL
                  </span>
                </ActionButton>
                <ActionButton
                  Element="externalLink"
                  to="https://zoo.dev/docs/tutorials/text-to-cad"
                  iconStart={{ icon: 'sparkles' }}
                  className="border-chalkboard-30 dark:border-chalkboard-80"
                >
                  <span className="py-2 lg:py-0">AI-unlocked CAD</span>
                </ActionButton>
              </div>
            </div>
            <div className={cardArea + ' col-span-2'}>
              <h2 className="text-xl">
                Built on the first infrastructure for hardware design
              </h2>
              <p className="text-xs my-4">
                You can make your own niche hardware design tools with our
                design and machine learning interfaces. We're building Modeling
                App in the same way.
              </p>
              <div className="flex gap-4 flex-wrap items-center">
                <ActionButton
                  Element="externalLink"
                  to="https://zoo.dev/design-api"
                  iconStart={{ icon: 'sketch' }}
                  className="border-chalkboard-30 dark:border-chalkboard-80"
                >
                  <span className="py-2 lg:py-0">KittyCAD Design API</span>
                </ActionButton>
                <ActionButton
                  Element="externalLink"
                  to="https://zoo.dev/machine-learning-api"
                  iconStart={{ icon: 'elephant' }}
                  className="border-chalkboard-30 dark:border-chalkboard-80"
                >
                  <span className="py-2 lg:py-0">
                    ML-ephant Machine Learning API
                  </span>
                </ActionButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

export default SignIn
