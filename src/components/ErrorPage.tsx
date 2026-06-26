import { useEffect } from 'react'
import { isRouteErrorResponse, useRouteError } from 'react-router-dom'

import { ActionButton } from '@src/components/ActionButton'
import { reportClientError } from '@src/lib/clientErrors'
import { isDesktop } from '@src/lib/isDesktop'
import { isErr, reportRejection } from '@src/lib/trap'
import { refreshPage } from '@src/lib/utils'

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

export const ErrorPage = () => {
  const error = useRouteError()
  // We log the error to the console no matter what
  console.error('error', error)

  useEffect(() => {
    const isRouteError = isRouteErrorResponse(error)
    const message = errorMessage(error)
    const name = isErr(error) ? error.name : 'RouteError'
    const stackTrace = stackTraceMessage(error)

    void reportClientError({
      code: isRouteError
        ? `route_error_${error.status}`
        : 'route_error_boundary',
      message,
      error: isErr(error) ? error : undefined,
      errorName: isRouteError ? 'RouteErrorResponse' : name,
      dedupeKey: `ErrorPage:${name}:${message}`,
      extra: {
        source: 'ErrorPage',
        ...(stackTrace ? { stackTrace } : {}),
        ...(isRouteError
          ? {
              status: error.status,
              statusText: error.statusText,
            }
          : {}),
      },
    })
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <section className="max-w-full xl:max-w-4xl mx-auto">
        <h1 className="text-4xl mb-8 font-bold" data-testid="unexpected-error">
          An unexpected error occurred
        </h1>
        <p className="mb-8 w-full overflow-auto">
          We're sorry, something went wrong. The error has been reported to our
          team.
        </p>
        <div className="flex justify-between gap-2 mt-6">
          {isDesktop() && (
            <ActionButton
              Element="link"
              to={'/'}
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
        </div>
      </section>
    </div>
  )
}
