import { isDesktop } from 'lib/isDesktop'
import { useRouteError, isRouteErrorResponse } from 'react-router-dom'
import { ActionButton } from './ActionButton'
import {
  faBug,
  faHome,
  faRefresh,
  faTrash,
} from '@fortawesome/free-solid-svg-icons'

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

/** Generate a GitHub issue URL from the error */
function generateToUrl(error: unknown) {
  const title: string = 'An unexpected error occurred'
  const body = errorMessage(error)
  const result = `https://github.com/KittyCAD/modeling-app/issues/new?title=${title}&body=${body}`
  return result
}

export const ErrorPage = () => {
  let error = useRouteError()
  // We log the error to the console no matter what
  console.error('error', error)

  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <section className="max-w-full xl:max-w-4xl mx-auto">
        <h1 className="text-4xl mb-8 font-bold" data-testid="unexpected-error">
          An unexpected error occurred
        </h1>
        <p className="mb-8">
          <>{errorMessage(error)}</>
        </p>
        <div className="flex justify-between gap-2 mt-6">
          {isDesktop() && (
            <ActionButton
              Element="link"
              to={'/'}
              iconStart={{ icon: faHome }}
              data-testid="unexpected-error-home"
            >
              Go Home
            </ActionButton>
          )}
          <ActionButton
            Element="button"
            iconStart={{ icon: faRefresh }}
            onClick={() => window.location.reload()}
          >
            Reload
          </ActionButton>
          <ActionButton
            Element="button"
            iconStart={{ icon: faTrash }}
            onClick={() => {
              window.localStorage.clear()
            }}
          >
            Clear storage
          </ActionButton>
          <ActionButton
            Element="externalLink"
            iconStart={{ icon: faBug }}
            to={generateToUrl(error)}
          >
            Report Bug
          </ActionButton>
        </div>
      </section>
    </div>
  )
}
