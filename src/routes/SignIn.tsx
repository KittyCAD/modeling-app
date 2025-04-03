import type { CSSProperties } from 'react'
import { useCallback, useState } from 'react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'

import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import { Logo } from '@src/components/Logo'
import { VITE_KC_API_BASE_URL, VITE_KC_SITE_BASE_URL } from '@src/env'
import { APP_NAME } from '@src/lib/constants'
import { isDesktop } from '@src/lib/isDesktop'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { PATHS } from '@src/lib/paths'
import { Themes, getSystemTheme } from '@src/lib/theme'
import { reportRejection } from '@src/lib/trap'
import { toSync } from '@src/lib/utils'
import { authActor, useSettings } from '@src/machines/appMachine'
import { APP_VERSION, IS_NIGHTLY } from '@src/routes/utils'

const subtleBorder =
  'border border-solid border-chalkboard-30 dark:border-chalkboard-80'
const cardArea = `${subtleBorder} rounded-lg px-6 py-3 text-chalkboard-70 dark:text-chalkboard-30`

const SignIn = () => {
  // Only create the native file menus on desktop
  if (isDesktop()) {
    window.electron.createFallbackMenu().catch(reportRejection)
    // Disable these since they cannot be accessed within the sign in page.
    window.electron.disableMenu('Help.Reset onboarding').catch(reportRejection)
    window.electron.disableMenu('Help.Show all commands').catch(reportRejection)
  }

  const [userCode, setUserCode] = useState('')
  const {
    app: { theme },
  } = useSettings()
  const signInUrl = `${VITE_KC_SITE_BASE_URL}${
    PATHS.SIGN_IN
  }?callbackUrl=${encodeURIComponent(
    typeof window !== 'undefined' && window.location.href.replace('signin', '')
  )}`
  const kclSampleUrl = `${VITE_KC_SITE_BASE_URL}/docs/kcl-samples/car-wheel-assembly`

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
    const userCodeToDisplay = await window.electron
      .startDeviceFlow(VITE_KC_API_BASE_URL)
      .catch(reportError)
    if (!userCodeToDisplay) {
      console.error('No user code received while trying to log in')
      toast.error('Error while trying to log in')
      return
    }
    setUserCode(userCodeToDisplay)

    // Now that we have the user code, we can kick off the final login step.
    const token = await window.electron.loginWithDeviceFlow().catch(reportError)
    if (!token) {
      console.error('No token received while trying to log in')
      toast.error('Error while trying to log in')
      return
    }
    authActor.send({ type: 'Log in', token })
  }

  return (
    <main
      className="bg-primary h-screen grid place-items-stretch m-0 p-2"
      style={
        isDesktop()
          ? ({
              '-webkit-app-region': 'drag',
            } as CSSProperties)
          : {}
      }
    >
      <div
        style={
          isDesktop()
            ? ({ '-webkit-app-region': 'no-drag' } as CSSProperties)
            : {}
        }
        className="body-bg py-5 px-12 rounded-lg grid place-items-center overflow-y-auto"
      >
        <div className="max-w-7xl grid gap-5 grid-cols-3 xl:grid-cols-4 xl:grid-rows-5">
          <div className="col-span-2 xl:col-span-3 xl:row-span-3 max-w-3xl mr-8 mb-8">
            <div className="flex items-baseline mb-8">
              <Logo className="text-primary h-10 lg:h-12 xl:h-16 relative translate-y-1 mr-4 lg:mr-6 xl:mr-8" />
              <h1 className="text-3xl lg:text-4xl xl:text-5xl">{APP_NAME}</h1>
              <span className="px-3 py-1 text-base rounded-full bg-primary/10 text-primary self-start">
                {
                  ? 'nightly' : ''} v{APP_VERSION}
              </span>
            </div>
            <p className="my-4 text-lg xl:text-xl">
              Thank you for using our CAD application. It is built on a novel
              geometry engine and crafted to help you create robust parametric
              designs. It represents your models as code, making it easy to
              collaborate with ML tools like Zoo Text-To-CAD to design parts and
              libraries fast.
            </p>
            {isDesktop() ? (
              <div className="flex flex-col gap-2">
                {!userCode ? (
                  <button
                    onClick={toSync(signInDesktop, reportRejection)}
                    className={
                      'm-0 mt-8 w-fit flex gap-4 items-center px-3 py-1 ' +
                      '!border-transparent !text-lg !text-chalkboard-10 !bg-primary hover:hue-rotate-15'
                    }
                    data-testid="sign-in-button"
                  >
                    Sign in to get started
                    <CustomIcon name="arrowRight" className="w-6 h-6" />
                  </button>
                ) : (
                  <>
                    <p className="text-xs">
                      You should see the following code in your browser
                    </p>
                    <p className="text-lg font-bold inline-flex gap-1">
                      {userCode.split('').map((char, i) => (
                        <span
                          key={i}
                          className={
                            'text-xl font-bold p-1 ' +
                            (char === '-' ? '' : 'border-2 border-solid')
                          }
                        >
                          {char}
                        </span>
                      ))}
                    </p>
                  </>
                )}
              </div>
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
              <h2 className="text-xl xl:text-2xl">Built in the open</h2>
              <p className="text-xs my-4">
                Open-source and open discussions. Check our public code base and
                join our Discord.
              </p>
              <div className="flex gap-4 flex-wrap items-center">
                <ActionButton
                  Element="externalLink"
                  to="https://github.com/KittyCAD/modeling-app"
                  iconStart={{ icon: 'code', bgClassName: '!bg-transparent' }}
                  className="!bg-primary !text-chalkboard-10 !border-transarent"
                >
                  <span className="py-2 lg:py-0">Read our source code</span>
                </ActionButton>
                <ActionButton
                  Element="externalLink"
                  to="https://discord.gg/JQEpHR7Nt2"
                  iconStart={{
                    icon: 'keyboard',
                    bgClassName: '!bg-transparent',
                  }}
                  className="!bg-primary !text-chalkboard-10 !border-transarent"
                >
                  <span className="py-2 lg:py-0">Join our community</span>
                </ActionButton>
              </div>
            </div>
            <div className={cardArea}>
              <h2 className="text-xl xl:text-2xl">Ready for the future</h2>
              <p className="text-xs my-4">
                Modern software ideas being brought together to create a
                familiar modeling experience with new superpowers.
              </p>
              <div className="flex gap-4 flex-wrap items-center">
                <ActionButton
                  Element="externalLink"
                  to="https://zoo.dev/docs/kcl-samples/a-parametric-bearing-pillow-block"
                  iconStart={{
                    icon: 'settings',
                    bgClassName: '!bg-transparent',
                  }}
                  className="!bg-primary !text-chalkboard-10 !border-transarent"
                >
                  <span className="py-2 lg:py-0">
                    Parametric design with KCL
                  </span>
                </ActionButton>
                <ActionButton
                  Element="externalLink"
                  to="https://zoo.dev/docs/tutorials/text-to-cad"
                  iconStart={{
                    icon: 'sparkles',
                    bgClassName: '!bg-transparent',
                  }}
                  className="!bg-primary !text-chalkboard-10 !border-transarent"
                >
                  <span className="py-2 lg:py-0">AI-unlocked CAD</span>
                </ActionButton>
              </div>
            </div>
            <div className={cardArea + ' col-span-2'}>
              <h2 className="text-xl xl:text-2xl">
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
                  iconStart={{ icon: 'sketch', bgClassName: '!bg-transparent' }}
                  className="!bg-primary !text-chalkboard-10 !border-transarent"
                >
                  <span className="py-2 lg:py-0">KittyCAD Design API</span>
                </ActionButton>
                <ActionButton
                  Element="externalLink"
                  to="https://zoo.dev/machine-learning-api"
                  iconStart={{
                    icon: 'elephant',
                    bgClassName: '!bg-transparent',
                  }}
                  className="!bg-primary !text-chalkboard-10 !border-transarent"
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
