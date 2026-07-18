import type { CSSProperties } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'

import type { IElectronAPI } from '@root/interface'
import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import { Logo } from '@src/components/Logo'
import { updateEnvironment } from '@src/env'
import env from '@src/env'
import { noAutofillInputProps } from '@src/lib/autofill'
import { useApp } from '@src/lib/boot'
import {
  ClientErrorCode,
  errorToMessage,
  reportClientError,
} from '@src/lib/clientErrors'
import { APP_NAME } from '@src/lib/constants'
import { readEnvironmentFile, writeEnvironmentFile } from '@src/lib/desktop'
import { isDesktop } from '@src/lib/isDesktop'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { mark } from '@src/lib/performance'
import { Themes, getSystemTheme } from '@src/lib/theme'
import { reportRejection } from '@src/lib/trap'
import { returnSelfOrGetHostNameFromURL, toSync } from '@src/lib/utils'
import { withAPIBaseURL, withSiteBaseURL } from '@src/lib/withBaseURL'
import { AdvancedSignInOptions } from '@src/routes/AdvancedSignInOptions'
import { APP_VERSION, generateSignInUrl } from '@src/routes/utils'

const subtleBorder =
  'border border-solid border-chalkboard-30 dark:border-chalkboard-80'
const cardArea = `${subtleBorder} rounded-lg px-6 py-3 text-chalkboard-70 dark:text-chalkboard-30`

let didReadFromDiskCacheForEnvironment = false

const SignIn = () => {
  const { auth, settings } = useApp()
  const [userCode, setUserCode] = useState('')
  const [verificationUri, setVerificationUri] = useState('')
  const signInAttemptRef = useRef(0)

  // Last saved environment
  // TODO: Reduce this logic
  const lastSelectedEnvironmentName = env().VITE_ZOO_BASE_DOMAIN || ''
  const [selectedEnvironment, setSelectedEnvironment] = useState(
    lastSelectedEnvironmentName
  )

  // See if the user added a real URL if they did, auto take the hostname!
  const setSelectedEnvironmentFormatter = (requestedEnvironment: string) => {
    const requestedEnvironmentFormatted =
      returnSelfOrGetHostNameFromURL(requestedEnvironment)
    setSelectedEnvironment(requestedEnvironmentFormatted)
  }

  const reportSignInClientError = ({
    code,
    error,
    message,
    dedupeKeyPrefix,
    extra,
    suppressWhenOffline,
  }: {
    code: ClientErrorCode
    error?: unknown
    message?: string
    dedupeKeyPrefix: string
    extra?: Record<string, unknown>
    suppressWhenOffline?: boolean
  }) => {
    const online =
      typeof navigator === 'undefined' ? undefined : navigator.onLine
    if (suppressWhenOffline && online === false) return

    const reportMessage = message ?? errorToMessage(error, 'Unknown auth error')

    void reportClientError({
      code,
      message: reportMessage,
      error,
      dedupeKey: `${dedupeKeyPrefix}:${selectedEnvironment}:${reportMessage}`,
      extra: {
        source: 'SignIn',
        selectedEnvironment,
        isDesktop: isDesktop(),
        ...extra,
        online,
      },
    })
  }

  const commitEnvironmentChange = (requestedEnvironment: string) => {
    const electron = window.electron
    if (!electron) return
    const requestedEnvironmentFormatted =
      returnSelfOrGetHostNameFromURL(requestedEnvironment)
    void (async () => {
      const persistedEnvironment = await readEnvironmentFile().catch(() => '')
      if (requestedEnvironmentFormatted === persistedEnvironment) {
        return
      }
      await writeEnvironmentFile(requestedEnvironmentFormatted).catch(
        reportRejection
      )
      window.location.reload()
    })()
  }

  useEffect(() => {
    const electron = window.electron
    if (!electron) {
      return
    }

    electron.createFallbackMenu().catch(reportRejection)
    // Disable these since they cannot be accessed within the sign in page.
    electron
      .disableMenu('Help.Replay onboarding tutorial')
      .catch(reportRejection)
    electron.disableMenu('Help.Show all commands').catch(reportRejection)
  }, [])

  useEffect(() => {
    if (!didReadFromDiskCacheForEnvironment) {
      didReadFromDiskCacheForEnvironment = true
      readEnvironmentFile()
        .then((environment) => {
          if (environment) {
            setSelectedEnvironmentFormatter(environment)
            return environment
          }
        })
        .then(() => {
          // Environment loaded from disk
        })
        .catch(reportRejection)
    }
  }, [])

  const {
    app: { theme },
  } = settings.useSettings()
  const signInUrl = generateSignInUrl()
  const kclSampleUrl = withSiteBaseURL('/docs/kcl-samples/car-wheel-assembly')

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    [theme.current]
  )

  const signInDesktop = async (electron: IElectronAPI) => {
    const signInAttempt = signInAttemptRef.current + 1
    signInAttemptRef.current = signInAttempt
    const requestedEnvironment = selectedEnvironment.trim()
    updateEnvironment(requestedEnvironment)
    mark('config/env', {
      name: 'config/env',
      startTime: performance.now(),
      entryType: 'mark',
      detail: {
        env: {
          NODE_ENV: env().NODE_ENV,
          VITE_ZOO_BASE_DOMAIN: env().VITE_ZOO_BASE_DOMAIN,
          VITE_ZOO_API_BASE_URL: env().VITE_ZOO_API_BASE_URL,
          VITE_KITTYCAD_WEBSOCKET_URL: env().VITE_KITTYCAD_WEBSOCKET_URL,
          VITE_MLEPHANT_WEBSOCKET_URL: env().VITE_MLEPHANT_WEBSOCKET_URL,
        },
      },
    })
    setUserCode('')
    setVerificationUri('')

    // We want to invoke our command to login via device auth.
    const deviceFlowAuthorization = await electron
      .startDeviceFlow(withAPIBaseURL(location.search))
      .catch((error) => {
        if (signInAttemptRef.current === signInAttempt) {
          reportError(error)
          reportSignInClientError({
            code: ClientErrorCode.AuthDeviceFlowStartError,
            error,
            dedupeKeyPrefix: 'SignIn:device-flow-start',
            suppressWhenOffline: true,
            extra: {
              requestedEnvironment,
            },
          })
        }
      })
    if (signInAttemptRef.current !== signInAttempt) return
    if (!deviceFlowAuthorization) {
      console.error(
        'No device flow authorization received while trying to log in'
      )
      reportSignInClientError({
        code: ClientErrorCode.AuthDeviceFlowStartError,
        message: 'No device flow authorization received while trying to log in',
        dedupeKeyPrefix: 'SignIn:device-flow-start-empty',
        suppressWhenOffline: true,
        extra: {
          requestedEnvironment,
        },
      })
      toast.error('Error while trying to log in.')
      return
    }
    setUserCode(deviceFlowAuthorization.userCode)
    setVerificationUri(deviceFlowAuthorization.verificationUri)

    // Now that we have the user code, we can kick off the final login step.
    const token = await electron.loginWithDeviceFlow().catch((error) => {
      if (signInAttemptRef.current === signInAttempt) {
        reportError(error)
        reportSignInClientError({
          code: ClientErrorCode.AuthDeviceFlowLoginError,
          error,
          dedupeKeyPrefix: 'SignIn:device-flow-login',
          suppressWhenOffline: true,
          extra: {
            requestedEnvironment,
            hasUserCode: Boolean(deviceFlowAuthorization.userCode),
            hasVerificationUri: Boolean(
              deviceFlowAuthorization.verificationUri
            ),
          },
        })
      }
    })
    if (signInAttemptRef.current !== signInAttempt) return
    if (!token) {
      console.error('No token received while trying to log in')
      reportSignInClientError({
        code: ClientErrorCode.AuthDeviceFlowLoginError,
        message: 'No token received while trying to log in',
        dedupeKeyPrefix: 'SignIn:device-flow-login-empty',
        suppressWhenOffline: true,
        extra: {
          requestedEnvironment,
          hasUserCode: Boolean(deviceFlowAuthorization.userCode),
          hasVerificationUri: Boolean(deviceFlowAuthorization.verificationUri),
        },
      })
      toast.error('Error while trying to log in.')
      return
    }

    auth.send({ type: 'Log in', token })
  }

  const cancelSignIn = async () => {
    signInAttemptRef.current += 1
    await window.electron?.cancelDeviceFlow().catch(reportRejection)
    auth.send({ type: 'Log out' })
    setUserCode('')
    setVerificationUri('')
  }

  const copyDeviceFlowSignInUrl = async () => {
    if (!verificationUri) return

    try {
      await navigator.clipboard.writeText(verificationUri)
      toast.success('Sign-in URL copied to clipboard.')
    } catch {
      toast.error('Failed to copy sign-in URL.')
    }
  }

  return (
    <main
      className="bg-primary h-screen grid place-items-stretch m-0 p-2"
      style={
        isDesktop()
          ? ({
              WebkitAppRegion: 'drag',
            } as CSSProperties)
          : {}
      }
    >
      <div
        style={
          isDesktop() ? ({ WebkitAppRegion: 'no-drag' } as CSSProperties) : {}
        }
        className="body-bg py-16 md:py-5 px-4 md:px-12 rounded-lg grid place-items-center overflow-y-auto"
      >
        <div className="max-w-7xl flex flex-col md:grid gap-5 grid-cols-3 xl:grid-cols-4 xl:grid-rows-5">
          <div className="md:col-span-2 xl:col-span-3 xl:row-span-3 max-w-3xl mr-8 mb-8">
            <div className="flex flex-row items-baseline mb-8">
              <Logo className="text-primary h-8 md:h-10 lg:h-12 xl:h-16 relative translate-y-1 mr-4 lg:mr-6 xl:mr-8" />
              <h1 className="text-2xl md:text-3xl lg:text-4xl xl:text-5xl">
                {APP_NAME}
              </h1>
              {isDesktop() && (
                <span className="px-2 md:px-3 py-1 text-xs md:text-base rounded-full bg-primary/10 text-primary self-start">
                  v{APP_VERSION}
                </span>
              )}
            </div>
            <p className="my-4 text-lg xl:text-xl">
              Thank you for using our CAD application. It is built on a novel
              geometry engine and crafted to help you create robust parametric
              designs. It represents your models as code, making it easy to
              collaborate with ML tools like Zookeeper to design parts and
              libraries fast.
            </p>
            {window.electron ? (
              <div className="flex flex-col gap-2">
                {!userCode ? (
                  <>
                    <button
                      onClick={() => {
                        const electron = window.electron
                        if (electron) {
                          ;(async () => {
                            await signInDesktop(electron)
                          })().catch(reportRejection)
                        }
                      }}
                      className={
                        'm-0 mt-8 w-fit flex gap-4 items-center px-3 py-1 ' +
                        '!border-transparent !text-lg !text-chalkboard-10 !bg-primary hover:hue-rotate-15'
                      }
                      data-testid="sign-in-button"
                    >
                      Sign in to get started
                      <CustomIcon name="arrowShortRight" className="w-6 h-6" />
                    </button>
                    {isDesktop() && (
                      <AdvancedSignInOptions
                        selectedEnvironment={selectedEnvironment}
                        setSelectedEnvironment={setSelectedEnvironmentFormatter}
                        onEnvironmentCommit={commitEnvironmentChange}
                      />
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-xs">
                      You should see the following code in your browser
                    </p>
                    <p
                      className="text-lg font-bold inline-flex gap-1"
                      data-testid="sign-in-user-code"
                    >
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
                    {verificationUri && (
                      <div className="mt-4 flex max-w-2xl flex-col gap-2">
                        <p className="text-xs">
                          If your browser did not open, copy and paste this
                          sign-in URL.
                        </p>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <input
                            {...noAutofillInputProps}
                            readOnly
                            aria-label="Sign-in URL"
                            value={verificationUri}
                            onFocus={(event) => event.currentTarget.select()}
                            className={
                              'min-w-0 flex-1 rounded-sm border border-solid ' +
                              'border-chalkboard-30 bg-chalkboard-10 px-2 py-1 ' +
                              'text-sm text-chalkboard-90 dark:border-chalkboard-70 ' +
                              'dark:bg-chalkboard-90 dark:text-chalkboard-10'
                            }
                            data-testid="sign-in-url"
                          />
                          <ActionButton
                            Element="button"
                            type="button"
                            onClick={toSync(
                              copyDeviceFlowSignInUrl,
                              reportRejection
                            )}
                            iconStart={{ icon: 'clipboard' }}
                            data-testid="copy-sign-in-url-button"
                          >
                            Copy URL
                          </ActionButton>
                        </div>
                      </div>
                    )}
                    <button
                      onClick={toSync(cancelSignIn, reportRejection)}
                      className={
                        'm-0 mt-8 w-fit flex gap-4 items-center px-3 py-1 ' +
                        '!border-transparent !text-lg !text-chalkboard-10 !bg-primary hover:hue-rotate-15'
                      }
                      data-testid="cancel-sign-in-button"
                    >
                      <CustomIcon name="arrowShortLeft" className="w-6 h-6" />
                      Cancel
                    </button>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="flex md:hidden flex-col gap-2">
                  <p className="text-base text-primary">
                    This app is really best used on a desktop. We're working on
                    simple touch controls for mobile, but in the meantime please
                    visit using a larger device.
                  </p>
                </div>
                <Link
                  onClick={openExternalBrowserIfDesktop(signInUrl)}
                  to={signInUrl}
                  className={
                    'w-fit m-0 mt-8 hidden md:flex gap-4 items-center px-3 py-1 ' +
                    '!border-transparent !text-lg !text-chalkboard-10 !bg-primary hover:hue-rotate-15'
                  }
                  data-testid="sign-in-button"
                >
                  Sign in to get started
                  <CustomIcon name="arrowShortRight" className="w-6 h-6" />
                </Link>
              </>
            )}
          </div>
          <Link
            className={`group relative xl:h-full xl:row-span-full md:col-start--1 xl:col-start-4 rounded-lg overflow-hidden grid place-items-center ${subtleBorder}`}
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
              data-testid="view-sample-button"
            >
              View this sample
              <CustomIcon name="arrowShortRight" className="w-6 h-6" />
            </div>
          </Link>
          <div className="self-end h-min md:col-span-3 xl:row-span-2 flex flex-col md:grid grid-cols-2 gap-5">
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
                  to={withSiteBaseURL('/docs/kcl-samples/pillow-block-bearing')}
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
                  to={withSiteBaseURL('/docs/zoo-design-studio/text-to-cad')}
                  iconStart={{
                    icon: 'sparkles',
                    bgClassName: '!bg-transparent',
                  }}
                  className="!bg-primary !text-chalkboard-10 !border-transarent"
                >
                  <span className="py-2 lg:py-0">ML-unlocked CAD</span>
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
                  to={withSiteBaseURL('/design-api')}
                  iconStart={{ icon: 'sketch', bgClassName: '!bg-transparent' }}
                  className="!bg-primary !text-chalkboard-10 !border-transarent"
                >
                  <span className="py-2 lg:py-0">KittyCAD Design API</span>
                </ActionButton>
                <ActionButton
                  Element="externalLink"
                  to={withSiteBaseURL('/machine-learning-api')}
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
