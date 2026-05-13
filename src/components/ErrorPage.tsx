import { useEffect } from 'react'
import { isRouteErrorResponse, useRouteError } from 'react-router-dom'

import { ActionButton } from '@src/components/ActionButton'
import { reportClientError } from '@src/lib/clientErrors'
import { isDesktop } from '@src/lib/isDesktop'
import { reportRejection } from '@src/lib/trap'
import { refreshPage } from '@src/lib/utils'

/** Type narrowing function of unknown error to a string */
function errorMessage(error: unknown): string {
  if (isRouteErrorResponse(error)) {
    return `${error.status} ${error.statusText}`
  }
  if (error !== undefined && error instanceof Error) {
    return error.message
  }
  if (error && typeof error === 'object') {
    try {
      return JSON.stringify(error)
    } catch {
      return 'Unknown route error'
    }
  }
  if (typeof error === 'string') {
    return error
  }
  return 'Unknown error'
}

function errorName(error: unknown): string {
  if (error instanceof Error) {
    return error.name
  }
  if (isRouteErrorResponse(error)) {
    return 'RouteErrorResponse'
  }
  return 'RouteError'
}

export const ErrorPage = () => {
  const error = useRouteError()
  // We log the error to the console no matter what
  console.error('error', error)

  useEffect(() => {
    void reportClientError({
      code: isRouteErrorResponse(error)
        ? `route_error_${error.status}`
        : 'route_error_boundary',
      message: errorMessage(error),
      error: error instanceof Error ? error : undefined,
      errorName: errorName(error),
      dedupeKey: `ErrorPage:${errorName(error)}:${errorMessage(error)}`,
      extra: {
        source: 'ErrorPage',
        ...(isRouteErrorResponse(error)
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
