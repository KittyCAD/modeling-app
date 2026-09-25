import type { IElectronAPI } from '@root/interface'
import { signal } from '@preact/signals-core'
import env, { updateEnvironment } from '@src/env'
import {
  ClientErrorCode,
  errorToMessage,
  reportClientError,
} from '@src/lib/clientErrors'
import { mark } from '@src/lib/performance'
import { reportRejection } from '@src/lib/trap'
import { withAPIBaseURL } from '@src/lib/withBaseURL'
import type {
  AuthRegistryService,
  DesktopSignInState,
} from '@src/registry/contracts/auth'
import toast from 'react-hot-toast'

type AuthSend = AuthRegistryService['send']

function reportDesktopSignInError({
  code,
  error,
  message,
  dedupeKeyPrefix,
  environment,
  extra,
}: {
  code: ClientErrorCode
  error?: unknown
  message?: string
  dedupeKeyPrefix: string
  environment: string
  extra?: Record<string, unknown>
}) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return

  const reportMessage = message ?? errorToMessage(error, 'Unknown auth error')
  void reportClientError({
    code,
    message: reportMessage,
    error,
    dedupeKey: `${dedupeKeyPrefix}:${environment}:${reportMessage}`,
    extra: {
      source: 'DesktopSignIn',
      selectedEnvironment: environment,
      isDesktop: true,
      ...extra,
      online: typeof navigator === 'undefined' ? undefined : navigator.onLine,
    },
  })
}

/**
 * Own the desktop device flow independently of the React sign-in screen.
 *
 * The screen observes `state`; starting or completing the effect never depends
 * on a route component mounting.
 */
export function createDesktopSignIn({
  getElectron = () => window.electron,
  send,
}: {
  getElectron?: () => IElectronAPI | undefined
  send: AuthSend
}) {
  const state = signal<DesktopSignInState>({ status: 'idle' })
  let activeAttempt = 0

  const start = async (environment = env().VITE_ZOO_BASE_DOMAIN || '') => {
    const electron = getElectron()
    if (!electron) return

    const attempt = activeAttempt + 1
    activeAttempt = attempt
    const requestedEnvironment = environment.trim()
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
          VITE_ZOOKEEPER_WEBSOCKET_URL: env().VITE_ZOOKEEPER_WEBSOCKET_URL,
        },
      },
    })
    state.value = { status: 'authorizing' }

    let authorization
    try {
      authorization = await electron.startDeviceFlow(
        withAPIBaseURL(window.location.search)
      )
    } catch (error) {
      if (activeAttempt !== attempt) return
      console.error(error)
      reportDesktopSignInError({
        code: ClientErrorCode.AuthDeviceFlowStartError,
        error,
        dedupeKeyPrefix: 'DesktopSignIn:device-flow-start',
        environment: requestedEnvironment,
      })
      state.value = { status: 'idle' }
      toast.error('Error while trying to log in.')
      return
    }
    if (activeAttempt !== attempt) return
    if (!authorization) {
      const message =
        'No device flow authorization received while trying to log in'
      console.error(message)
      reportDesktopSignInError({
        code: ClientErrorCode.AuthDeviceFlowStartError,
        message,
        dedupeKeyPrefix: 'DesktopSignIn:device-flow-start-empty',
        environment: requestedEnvironment,
      })
      state.value = { status: 'idle' }
      toast.error('Error while trying to log in.')
      return
    }

    state.value = {
      status: 'verification',
      userCode: authorization.userCode,
      verificationUri: authorization.verificationUri,
    }

    let token
    try {
      token = await electron.loginWithDeviceFlow()
    } catch (error) {
      if (activeAttempt !== attempt) return
      console.error(error)
      reportDesktopSignInError({
        code: ClientErrorCode.AuthDeviceFlowLoginError,
        error,
        dedupeKeyPrefix: 'DesktopSignIn:device-flow-login',
        environment: requestedEnvironment,
        extra: {
          hasUserCode: Boolean(authorization.userCode),
          hasVerificationUri: Boolean(authorization.verificationUri),
        },
      })
      state.value = { status: 'idle' }
      toast.error('Error while trying to log in.')
      return
    }
    if (activeAttempt !== attempt) return
    if (!token) {
      const message = 'No token received while trying to log in'
      console.error(message)
      reportDesktopSignInError({
        code: ClientErrorCode.AuthDeviceFlowLoginError,
        message,
        dedupeKeyPrefix: 'DesktopSignIn:device-flow-login-empty',
        environment: requestedEnvironment,
        extra: {
          hasUserCode: Boolean(authorization.userCode),
          hasVerificationUri: Boolean(authorization.verificationUri),
        },
      })
      state.value = { status: 'idle' }
      toast.error('Error while trying to log in.')
      return
    }

    state.value = { status: 'idle' }
    send({ type: 'Log in', token })
  }

  const cancel = async () => {
    activeAttempt += 1
    await getElectron()?.cancelDeviceFlow().catch(reportRejection)
    state.value = { status: 'idle' }
    send({ type: 'Log out' })
  }

  return { state, start, cancel }
}
