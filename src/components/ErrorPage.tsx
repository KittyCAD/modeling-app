import { isTauri } from 'lib/isTauri'
import { useRouteError, isRouteErrorResponse } from 'react-router-dom'
import { ActionButton } from './ActionButton'
import {
  faBug,
  faHome,
  faRefresh,
  faTrash,
} from '@fortawesome/free-solid-svg-icons'

export const ErrorPage = () => {
  let error = useRouteError()

  console.error('error', error)

  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <section className="max-w-full xl:max-w-4xl mx-auto">
        <h1 className="text-4xl mb-8 font-bold">
          An unexpected error occurred
        </h1>
        {isRouteErrorResponse(error) && (
          <p className="mb-8">
            {error.status}: {error.data}
          </p>
        )}
        <div className="flex justify-between gap-2 mt-6">
          {isTauri() && (
            <ActionButton Element="link" to={'/'} icon={{ icon: faHome }}>
              Go Home
            </ActionButton>
          )}
          <ActionButton
            Element="button"
            icon={{ icon: faRefresh }}
            onClick={() => window.location.reload()}
          >
            Reload
          </ActionButton>
          <ActionButton
            Element="button"
            icon={{ icon: faTrash }}
            onClick={() => {
              window.localStorage.clear()
            }}
          >
            Clear storage
          </ActionButton>
          <ActionButton
            Element="externalLink"
            icon={{ icon: faBug }}
            to="https://github.com/KittyCAD/modeling-app/issues/new"
          >
            Report Bug
          </ActionButton>
        </div>
      </section>
    </div>
  )
}
