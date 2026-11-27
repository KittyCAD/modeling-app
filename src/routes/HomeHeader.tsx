import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import { ProjectSearchBar } from '@src/components/ProjectSearchBar'
import { isDesktop } from '@src/lib/isDesktop'
import { PATHS } from '@src/lib/paths'
import {
  DIRECTORY_PROJECT_LIBRARY_TYPE,
  getProjectLibraryDetailsDescription,
  type ProjectLibrary,
} from '@src/lib/projectLibraries'
import { getNextSearchParams, getSortIcon } from '@src/lib/sorting'
import { getProjectLibraryIconName } from '@src/routes/projectLibraryIcons'
import { type HTMLProps, type ReactNode, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

type ReadWriteProjectState = {
  value: boolean
  error: unknown
}

interface HomeHeaderProps extends HTMLProps<HTMLDivElement> {
  title: string
  onRefresh?: () => void
  isRefreshing?: boolean
  library?: ProjectLibrary
  isOverview?: boolean
  showLibraryBackLink?: boolean
  setQuery: (query: string) => void
  sort: string
  setSearchParams: (params: Record<string, string>) => void
  readWriteProjectDir: ReadWriteProjectState
  projectSearchKeybinding?: string
  libraryDetails?: ReactNode
}

export function HomeHeader({
  title,
  onRefresh,
  isRefreshing = false,
  library,
  isOverview = false,
  showLibraryBackLink = false,
  setQuery,
  sort,
  setSearchParams,
  readWriteProjectDir,
  projectSearchKeybinding,
  libraryDetails,
  ...rest
}: HomeHeaderProps) {
  const [refreshCoolingDown, setRefreshCoolingDown] = useState(false)
  useEffect(() => {
    if (!refreshCoolingDown) return
    const timeout = setTimeout(() => setRefreshCoolingDown(false), 5_000)
    return () => clearTimeout(timeout)
  }, [refreshCoolingDown])

  const isSortByModified = sort?.includes('modified') || !sort || sort === null
  const canManageLocalLibraries = isDesktop()
  const libraryDetailsDescription = library
    ? getProjectLibraryDetailsDescription(library)
    : undefined

  return (
    <section {...rest}>
      <div className="flex flex-col md:flex-row gap-4 justify-between md:items-center select-none">
        <div className={isOverview ? 'sr-only' : 'flex gap-8 items-center'}>
          <div className="flex flex-col gap-1">
            {library && showLibraryBackLink && (
              <Link
                to={PATHS.HOME}
                className="inline-flex items-center gap-1 text-sm text-chalkboard-70 underline underline-offset-2 dark:text-chalkboard-30"
              >
                <CustomIcon
                  name="caretLeft"
                  className="h-4 w-4"
                  aria-hidden="true"
                />
                All libraries
              </Link>
            )}
            <div className="flex items-center gap-3">
              {library && (
                <span
                  className="grid h-12 w-12 flex-none place-content-center rounded-sm bg-primary/10 text-primary dark:bg-chalkboard-90 dark:text-chalkboard-20"
                  data-testid="project-library-details-icon"
                >
                  <CustomIcon
                    name={getProjectLibraryIconName(library)}
                    className="h-7 w-7"
                    aria-hidden="true"
                  />
                </span>
              )}
              <h1 className="text-3xl font-bold">{title}</h1>
            </div>
          </div>
        </div>
        <div
          className={`flex flex-col gap-2 sm:flex-row sm:items-center ${
            isOverview ? 'w-full sm:justify-end' : ''
          }`}
        >
          {onRefresh && (
            <ActionButton
              Element="button"
              onClick={() => {
                setRefreshCoolingDown(true)
                onRefresh()
              }}
              disabled={isRefreshing || refreshCoolingDown}
              aria-label="Refresh projects"
              aria-busy={isRefreshing}
              className="text-xs border-primary/10"
              iconStart={{
                icon: 'arrowRotateRight',
                bgClassName: 'bg-transparent',
                iconClassName: isRefreshing ? 'animate-spin' : '',
              }}
            >
              Refresh
            </ActionButton>
          )}
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
        <div className="my-4">
          <p className="m-0 break-words text-sm text-chalkboard-80 dark:text-chalkboard-30">
            {libraryDetailsDescription ? `${libraryDetailsDescription} ` : null}
            {canManageLocalLibraries &&
              library.type === DIRECTORY_PROJECT_LIBRARY_TYPE && (
                <span className="whitespace-nowrap">
                  Folder:{' '}
                  <Link
                    data-testid="project-directory-settings-link"
                    to={`${PATHS.HOME + PATHS.SETTINGS_USER}#libraries`}
                    className="text-chalkboard-90 dark:text-chalkboard-20 underline underline-offset-2"
                  >
                    {library.path}
                  </Link>
                </span>
              )}
            {libraryDetails}
          </p>
        </div>
      ) : null}
      {!readWriteProjectDir.value && (
        <section>
          <div className="flex items-center select-none">
            <div className="flex gap-8 items-center justify-between grow bg-destroy-80 text-white py-1 px-4 my-2 rounded-sm">
              <p className="">{errorMessage(readWriteProjectDir.error)}</p>
              {canManageLocalLibraries && (
                <Link
                  data-testid="project-directory-settings-link"
                  to={`${PATHS.HOME + PATHS.SETTINGS_USER}#libraries`}
                  className="py-1 text-white underline underline-offset-2 text-sm"
                >
                  Manage Project Libraries
                </Link>
              )}
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
