import { Popover } from '@headlessui/react'
import type { ProjectAccessResponse } from '@kittycad/lib'
import { useSignals } from '@preact/signals-react/runtime'
import { ActionButton } from '@src/components/ActionButton'
import { getProjectHeaderButtonClasses } from '@src/components/actionButtonStyles'
import { CustomIcon } from '@src/components/CustomIcon'
import { cloudStorageService } from '@src/lib/cloudProjects/registry/contract'
import type { CloudStorageService } from '@src/lib/cloudProjects/service'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  PERSONAL_CLOUD_PROJECT_LIBRARY_TITLE,
} from '@src/lib/projectLibraries'
import { apiProjectLibraryId } from '@src/lib/projectLibraries/apiProjectLibraries'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { PATHS } from '@src/lib/routePaths'
import type { AppHeaderItemProps } from '@src/registry/contracts/appHeader'
import { authService } from '@src/registry/contracts/auth'
import { projectLibraryTypesFacet } from '@src/registry/contracts/projectLibraries'
import { routerService } from '@src/registry/contracts/router'
import { runtimeService } from '@src/registry/contracts/runtime'
import type { Registry } from 'plankton'
import { type ReactNode, useEffect, useId, useState } from 'react'
import toast from 'react-hot-toast'

const organizationLibraryHint =
  'To share with your organization, duplicate this project into an organization library.'

export function ShareProjectButton({ app }: AppHeaderItemProps) {
  useSignals()
  const { registry } = app
  const pathname = registry.optional(routerService)?.location.value.pathname
  const onProjectRoute = pathname?.startsWith(`${PATHS.PROJECT}/`)
  const onFileRoute = pathname?.startsWith(`${PATHS.FILE}/`)
  const onLocalRoute = pathname?.startsWith(`${PATHS.LOCAL}/`)
  if (!onProjectRoute && !onFileRoute && !onLocalRoute) return null

  const auth = registry.optional(authService)
  if (!auth?.isLoggedIn.value || !auth.organization.current.value) return null

  const cloud = registry.optional(cloudStorageService)
  const appUrl = registry.optional(runtimeService)?.current.value.appUrl

  const nextProject = registry.optional(projectSessionService)?.currentProject
    .value
  const project = app.projectSignal.value?.projectIORefSignal.value
  let projectId: string | undefined
  let localProjectPath: string | undefined
  if (onProjectRoute && nextProject?.storage?.type === 'cloud') {
    projectId = nextProject.storage.projectId
  } else if (onLocalRoute && !nextProject?.storage) {
    localProjectPath = nextProject?.contents.path
  } else if (onFileRoute && project) {
    if (
      project.cloudProjectId &&
      project.path === cloud?.pathFor(project.cloudProjectId)
    ) {
      projectId = project.cloudProjectId
    } else {
      localProjectPath = project.path
    }
  }

  const sharing =
    cloud && projectId && appUrl
      ? {
          projectId,
          url: new URL(
            `${PATHS.PROJECT}/${encodeURIComponent(projectId)}`,
            appUrl
          ).href,
          cloud,
        }
      : undefined
  const dialogKey = sharing?.url ?? localProjectPath
  return (
    <Popover
      className="flex"
      key={dialogKey ? `${dialogKey}:${auth.user.value?.id ?? ''}` : undefined}
    >
      {({ open }) => (
        <>
          <Popover.Button
            type="button"
            disabled={!dialogKey}
            className={`${getProjectHeaderButtonClasses()} disabled:cursor-default disabled:opacity-50`}
          >
            <CustomIcon name="link" className="h-5 w-5" aria-hidden="true" />
            Share
          </Popover.Button>
          {open && sharing && (
            <ShareProjectDialog {...sharing} registry={registry} />
          )}
          {open && localProjectPath && (
            <ShareProjectPanel>
              <div className="px-4 py-4">
                <ShareProjectLibrary ownership="Local" />
                <p className="mt-2 text-xs leading-5 text-2">
                  {organizationLibraryHint}
                </p>
              </div>
            </ShareProjectPanel>
          )}
        </>
      )}
    </Popover>
  )
}

function ShareProjectPanel({ children }: { children: ReactNode }) {
  const id = useId()
  return (
    <Popover.Panel
      focus
      role="dialog"
      aria-labelledby={id}
      className="fixed right-4 top-16 z-20 flex max-h-[calc(100vh-5rem)] w-[30rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded border b-4 bg-2 text-sm text-default shadow-2xl"
    >
      <div className="shrink-0 border-b b-4 bg-3 px-4 py-4">
        <h2 id={id} className="text-base font-medium leading-none">
          Share project
        </h2>
        <p className="mt-2 text-xs leading-5 text-2">
          Grant read-only access to other users in your organization.
        </p>
      </div>
      {children}
    </Popover.Panel>
  )
}

function ShareProjectLibrary({
  name,
  ownership,
}: {
  name?: string
  ownership?: string
}) {
  const id = useId()
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="text-sm font-medium">
        Library
      </h3>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {name && (
          <>
            <dt className="text-2">Name</dt>
            <dd className="min-w-0 break-words">{name}</dd>
          </>
        )}
        {ownership && (
          <>
            <dt className="text-2">Ownership</dt>
            <dd className="min-w-0 break-words">{ownership}</dd>
          </>
        )}
      </dl>
    </section>
  )
}

function ShareProjectDialog({
  url,
  projectId,
  cloud,
  registry,
}: {
  url: string
  projectId: string
  cloud: CloudStorageService
  registry: Registry
}) {
  useSignals()
  const id = useId()
  const [details, setDetails] = useState<{
    access?: ProjectAccessResponse
    libraryId?: string
  } | null>()
  const access = details?.access
  const organization =
    registry.optional(authService)?.organization.current.value
  const organizationName =
    organization && access?.organization_id === organization.id
      ? organization.name?.trim()
      : undefined
  const libraryId = details?.libraryId
  const library = libraryId
    ? registry
        .observe(projectLibraryTypesFacet)
        .value.get(CLOUD_PROJECT_LIBRARY_TYPE)
        ?.libraries?.find(
          (library) =>
            library.id === apiProjectLibraryId(libraryId) &&
            !library.hiddenByDefault
        )
    : undefined
  const isPersonal = access?.scope === 'personal'
  const libraryName =
    library?.title ??
    (isPersonal && !libraryId
      ? PERSONAL_CLOUD_PROJECT_LIBRARY_TITLE
      : undefined)
  let ownership: string | undefined
  if (isPersonal) ownership = 'Personal'
  if (access?.scope === 'organization')
    ownership = organizationName || 'Organization'
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    const load = async () => {
      const info = await cloud
        .getProjectSharingInfo(projectId, signal)
        .catch(() => null)
      if (!signal.aborted) setDetails(info ?? null)
    }
    void load()
    return () => controller.abort()
  }, [projectId, cloud])

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      toast.error('Could not copy the link. Select it and copy manually.')
    }
  }

  return (
    <ShareProjectPanel>
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-4 py-4">
        <div>
          <label htmlFor={`${id}-link`} className="text-xs font-medium text-2">
            Project link
          </label>
          <div className="mt-2 flex items-center gap-2">
            <input
              id={`${id}-link`}
              className="min-w-0 flex-1 select-text rounded border b-4 bg-default px-2.5 py-1.5 focus-visible:outline-color-4"
              type="url"
              value={url}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
            <ActionButton
              Element="button"
              type="button"
              tabIndex={0}
              iconStart={{
                icon: copied ? 'clipboardCheckmark' : 'clipboard',
                bgClassName: '!bg-transparent',
              }}
              className="min-w-24 shrink-0 self-stretch justify-center whitespace-nowrap !rounded"
              onClick={() => void copyLink()}
            >
              {copied ? 'Copied' : 'Copy link'}
            </ActionButton>
          </div>
        </div>
        {(libraryName || ownership) && (
          <div>
            <ShareProjectLibrary name={libraryName} ownership={ownership} />
            {isPersonal && (
              <p className="mt-2 text-xs leading-5 text-2">
                {organizationLibraryHint}
              </p>
            )}
          </div>
        )}
        <section aria-labelledby={`${id}-permissions`}>
          <h3 id={`${id}-permissions`} className="text-sm font-medium">
            Current permissions
          </h3>
          {access ? (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-2">Who can open this link</dt>
              <dd className="min-w-0 break-words">
                {access.scope === 'organization'
                  ? `Members of ${organizationName || 'the owning organization'}`
                  : 'Project owner'}
              </dd>
              <dt className="text-2">Your access</dt>
              <dd>{access.can_edit ? 'Can edit' : 'Can view'}</dd>
            </dl>
          ) : (
            <p role="status" className="mt-2 text-sm text-2">
              {details === undefined
                ? 'Loading permissions…'
                : 'Could not load project permissions.'}
            </p>
          )}
        </section>
      </div>
    </ShareProjectPanel>
  )
}
