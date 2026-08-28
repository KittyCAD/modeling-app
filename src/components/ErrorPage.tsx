import { useEffect } from 'react'
import { isRouteErrorResponse, useRouteError } from 'react-router-dom'
import UAParser from 'ua-parser-js'

import { ActionButton } from '@src/components/ActionButton'
import { ClientErrorCode, reportClientError } from '@src/lib/clientErrors'
import { isDesktop } from '@src/lib/isDesktop'
import { PATHS } from '@src/lib/paths'
import { isErr, reportRejection } from '@src/lib/trap'
import { refreshPage } from '@src/lib/utils'

const BROWSER_UPDATE_URL = 'https://browser-update.org/update-browser.html'
const ITERATOR_TO_ARRAY_ERROR = '.toArray is not a function'

/** Type narrowing function of unknown error to a string */
function errorMessage(error: unknown): string {
  if (isRouteErrorResponse(error)) {
    return `${error.status} ${error.statusText}`
  } else if (error != undefined && error instanceof Error) {
    return error.message
  } else if (error && typeof error === 'object') {
    return JSON.stringify(error)
  } else if (typeof error === 'string') {
    return error
  } else {
    return 'Unknown error'
  }
}

function stackTraceMessage(error: unknown): string {
  if (error !== undefined && error instanceof Error) {
    return error.stack || ''
  }
  return ''
}

function isBrowserCompatibilityError(error: unknown): boolean {
  return errorMessage(error).includes(ITERATOR_TO_ARRAY_ERROR)
}

function browserDetails() {
  const browser = new UAParser().getBrowser()
  return {
    browserName: browser.name ?? 'unknown',
    browserVersion: browser.version ?? 'unknown',
  }
}

export const ErrorPage = () => {
  const error = useRouteError()
  const browserCompatibilityError = isBrowserCompatibilityError(error)
  // We log the error to the console no matter what
  console.error('error', error)

  useEffect(() => {
    const isRouteError = isRouteErrorResponse(error)
    const message = errorMessage(error)
    const name = isErr(error) ? error.name : 'RouteError'
    const stackTrace = stackTraceMessage(error)

    void reportClientError({
      code: browserCompatibilityError
        ? ClientErrorCode.UnsupportedBrowserFeature
        : isRouteError
          ? `route_error_${error.status}`
          : 'route_error_boundary',
      message,
      error: isErr(error) ? error : undefined,
      errorName: browserCompatibilityError
        ? 'UnsupportedBrowserFeature'
        : isRouteError
          ? 'RouteErrorResponse'
          : name,
      dedupeKey: browserCompatibilityError
        ? `ErrorPage:${ClientErrorCode.UnsupportedBrowserFeature}:Iterator.prototype.toArray`
        : `ErrorPage:${name}:${message}`,
      extra: {
        source: 'ErrorPage',
        ...(browserCompatibilityError
          ? {
              missingCapability: 'Iterator.prototype.toArray',
              ...browserDetails(),
            }
          : {}),
        ...(stackTrace ? { stackTrace } : {}),
        ...(isRouteError
          ? {
              status: error.status,
              statusText: error.statusText,
            }
          : {}),
      },
    })
  }, [browserCompatibilityError, error])

  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <section className="max-w-full xl:max-w-4xl mx-auto">
        <h1
          className="text-4xl mb-8 font-bold"
          data-testid={
            browserCompatibilityError
              ? 'browser-compatibility-error'
              : 'unexpected-error'
          }
        >
          {browserCompatibilityError
            ? 'Your browser needs an update'
            : 'An unexpected error occurred'}
        </h1>
        <p className="mb-8 w-full overflow-auto">
          {browserCompatibilityError
            ? 'Your browser is out of date and cannot open Zoo Design Studio projects. Update your browser or use the latest Chrome, Edge, Firefox, or Safari.'
            : "We're sorry, something went wrong. The error has been reported to our team."}
        </p>
        <div className="flex justify-between gap-2 mt-6">
          {browserCompatibilityError ? (
            <>
              <ActionButton
                Element="link"
                to={PATHS.HOME}
                iconStart={{ icon: 'arrowShortLeft' }}
              >
                Go Home
              </ActionButton>
              <ActionButton Element="externalLink" to={BROWSER_UPDATE_URL}>
                Update browser
              </ActionButton>
            </>
          ) : (
            <>
              {isDesktop() && (
                <ActionButton
                  Element="link"
                  to={PATHS.INDEX}
                  iconStart={{ icon: 'arrowShortLeft' }}
                  data-testid="unexpected-error-home"
                >
                  Go Home
                </ActionButton>
              )}
              <ActionButton
                Element="button"
                iconStart={{ icon: 'arrowRotateFullRight' }}
                onClick={() => {
                  refreshPage('Crash page').catch(reportRejection)
                }}
              >
                Reload
              </ActionButton>
              <ActionButton
                Element="button"
                iconStart={{ icon: 'trash' }}
                onClick={() => {
                  window.localStorage.clear()
                }}
              >
                Clear Storage
              </ActionButton>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
