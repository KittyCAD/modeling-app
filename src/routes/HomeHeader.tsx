import { ActionButton } from '@src/components/ActionButton'
import { ProjectSearchBar } from '@src/components/ProjectSearchBar'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { appendRouterSubRouteWithSearch, PATHS } from '@src/lib/paths'
import {
  formatProjectLibraryPathForDisplay,
  type ProjectLibrary,
} from '@src/lib/projectLibraries'
import { FREE_CLOUD_PROJECT_TRAINING_POLICY_URL } from '@src/lib/projectLibraries/trainingDisclosure'
import { getNextSearchParams, getSortIcon } from '@src/lib/sorting'
import type { HTMLProps } from 'react'
import { Link } from 'react-router-dom'

type ReadWriteProjectState = {
  value: boolean
  error: unknown
}

interface HomeHeaderProps extends HTMLProps<HTMLDivElement> {
  title: string
  library?: ProjectLibrary
  showLibraryBackLink?: boolean
  setQuery: (query: string) => void
  sort: string
  setSearchParams: (params: Record<string, string>) => void
  readWriteProjectDir: ReadWriteProjectState
  projectSearchKeybinding?: string
  showFreeCloudProjectTrainingDisclosure?: boolean
}

export function HomeHeader({
  title,
  library,
  showLibraryBackLink = false,
  setQuery,
  sort,
  setSearchParams,
  readWriteProjectDir,
  projectSearchKeybinding,
  showFreeCloudProjectTrainingDisclosure = false,
  ...rest
}: HomeHeaderProps) {
  const isSortByModified = sort?.includes('modified') || !sort || sort === null

  return (
    <section {...rest}>
      <div className="flex flex-col md:flex-row gap-4 justify-between md:items-center select-none">
        <div className="flex gap-8 items-center">
          <div className="flex flex-col gap-1">
            {library && showLibraryBackLink && (
              <Link
                to={PATHS.HOME}
                className="text-sm text-chalkboard-70 underline underline-offset-2 dark:text-chalkboard-30"
              >
                All libraries
              </Link>
            )}
            <h1 className="text-3xl font-bold">{title}</h1>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <ProjectSearchBar
            setQuery={setQuery}
            keybinding={projectSearchKeybinding}
          />
          <div className="flex gap-2 items-center">
            <small>Sort by</small>
            <ActionButton
              Element="button"
              data-testid="home-sort-by-name"
              className={`text-xs border-primary/10 ${
                !sort.includes('name')
                  ? 'text-chalkboard-80 dark:text-chalkboard-40'
                  : ''
              }`}
              onClick={() => setSearchParams(getNextSearchParams(sort, 'name'))}
              iconStart={{
                icon: getSortIcon(sort, 'name'),
                bgClassName: 'bg-transparent',
                iconClassName: !sort.includes('name')
                  ? '!text-chalkboard-90 dark:!text-chalkboard-30'
                  : '',
              }}
            >
              Name
            </ActionButton>
            <ActionButton
              Element="button"
              data-testid="home-sort-by-modified"
              className={`text-xs border-primary/10 ${
                !isSortByModified
                  ? 'text-chalkboard-80 dark:text-chalkboard-40'
                  : ''
              }`}
              onClick={() =>
                setSearchParams(getNextSearchParams(sort, 'modified'))
              }
              iconStart={{
                icon: sort ? getSortIcon(sort, 'modified') : 'arrowDown',
                bgClassName: 'bg-transparent',
                iconClassName: !isSortByModified
                  ? '!text-chalkboard-90 dark:!text-chalkboard-30'
                  : '',
              }}
            >
              Last Modified
            </ActionButton>
          </div>
        </div>
      </div>
      {library ? (
        <p className="my-4 break-words text-sm text-chalkboard-80 dark:text-chalkboard-30">
          Loaded from{' '}
          <Link
            data-testid="project-directory-settings-link"
            to={`${appendRouterSubRouteWithSearch(
              PATHS.HOME,
              PATHS.SETTINGS_USER
            )}#libraries`}
            className="text-chalkboard-90 dark:text-chalkboard-20 underline underline-offset-2"
          >
            {formatProjectLibraryPathForDisplay(library)}
          </Link>
          {showFreeCloudProjectTrainingDisclosure && (
            <>
              . Zoo trains on Free user cloud projects.{' '}
              <a
                href={FREE_CLOUD_PROJECT_TRAINING_POLICY_URL}
                onClick={openExternalBrowserIfDesktop(
                  FREE_CLOUD_PROJECT_TRAINING_POLICY_URL
                )}
                className="text-chalkboard-90 dark:text-chalkboard-20 underline underline-offset-2"
              >
                See our policy
              </a>
            </>
          )}
        </p>
      ) : null}
      {!readWriteProjectDir.value && (
        <section>
          <div className="flex items-center select-none">
            <div className="flex gap-8 items-center justify-between grow bg-destroy-80 text-white py-1 px-4 my-2 rounded-sm">
              <p className="">{errorMessage(readWriteProjectDir.error)}</p>
              <Link
                data-testid="project-directory-settings-link"
                to={`${appendRouterSubRouteWithSearch(
                  PATHS.HOME,
                  PATHS.SETTINGS_USER
                )}#libraries`}
                className="py-1 text-white underline underline-offset-2 text-sm"
              >
                Manage Project Libraries
              </Link>
            </div>
          </div>
        </section>
      )}
    </section>
  )
}

/** Type narrowing function of unknown error to a string */
function errorMessage(error: unknown): string {
  if (error !== undefined && error instanceof Error) {
    return error.message
  }
  if (error && typeof error === 'object') {
    return JSON.stringify(error)
  }
  if (typeof error === 'string') {
    return error
  }
  return 'Unknown error'
}
