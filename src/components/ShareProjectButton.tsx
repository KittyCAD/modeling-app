import { Popover } from '@headlessui/react'
import type { ProjectAccessResponse } from '@kittycad/lib'
import { useSignals } from '@preact/signals-react/runtime'
import { ActionButton } from '@src/components/ActionButton'
import { getProjectHeaderButtonClasses } from '@src/components/actionButtonStyles'
import { CustomIcon } from '@src/components/CustomIcon'
import { cloudStorageService } from '@src/lib/cloudProjects/registry/contract'
import type { CloudStorageService } from '@src/lib/cloudProjects/service'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import type { AppHeaderItemProps } from '@src/registry/contracts/appHeader'
import { authService } from '@src/registry/contracts/auth'
import { routerService } from '@src/registry/contracts/router'
import { runtimeService } from '@src/registry/contracts/runtime'
import { PATHS } from '@src/lib/routePaths'
import { useEffect, useId, useState } from 'react'
import toast from 'react-hot-toast'

export function ShareProjectButton({ app }: AppHeaderItemProps) {
  useSignals()
  const { registry } = app
  const cloud = registry.optional(cloudStorageService)
  const auth = registry.optional(authService)
  const appUrl = registry.optional(runtimeService)?.current.value.appUrl
  const pathname = registry.optional(routerService)?.location.value.pathname

  const nextProject = registry.optional(projectSessionService)?.currentProject
    .value
  const project = app.projectSignal.value?.projectIORefSignal.value
  let projectId: string | undefined
  if (
    pathname?.startsWith(`${PATHS.PROJECT}/`) &&
    nextProject?.storage?.type === 'cloud'
  ) {
    projectId = nextProject.storage.projectId
  } else if (
    pathname?.startsWith(`${PATHS.FILE}/`) &&
    project?.cloudProjectId &&
    project.path === cloud?.pathFor(project.cloudProjectId)
  ) {
    projectId = project.cloudProjectId
  }

  const sharing =
    cloud && projectId && appUrl && auth?.isLoggedIn.value
      ? {
          projectId,
          url: new URL(
            `${PATHS.PROJECT}/${encodeURIComponent(projectId)}`,
            appUrl
          ).href,
          cloud,
        }
      : undefined
  return (
    <Popover
      className="flex"
      key={sharing ? `${sharing.url}:${auth?.user.value?.id ?? ''}` : undefined}
    >
      {({ open }) => (
        <>
          <Popover.Button
            type="button"
            disabled={!sharing}
            title={sharing ? undefined : 'Open a cloud project to share.'}
            className={`${getProjectHeaderButtonClasses()} disabled:cursor-default disabled:opacity-50`}
          >
            <CustomIcon name="link" className="h-5 w-5" aria-hidden="true" />
            Share
          </Popover.Button>
          {open && sharing && <ShareProjectDialog {...sharing} />}
        </>
      )}
    </Popover>
  )
}

function ShareProjectDialog({
  url,
  projectId,
  cloud,
}: {
  url: string
  projectId: string
  cloud: CloudStorageService
}) {
  const id = useId()
  const [permissions, setPermissions] = useState<{
    access: ProjectAccessResponse
    organizationName?: string
  } | null>()
  const access = permissions?.access
  const organizationName = permissions?.organizationName
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    const load = async () => {
      const access = await cloud
        .getProjectAccess(projectId, signal)
        .catch(() => undefined)
      if (signal.aborted) return
      setPermissions(access ? { access } : null)
      if (access?.scope !== 'organization' || !access.organization_id) return
      const organizationName = await cloud
        .getOrganizationName(access.organization_id, signal)
        .catch(() => undefined)
      if (!signal.aborted && organizationName)
        setPermissions({ access, organizationName })
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
    <Popover.Panel
      focus
      role="dialog"
      aria-labelledby={`${id}-title`}
      className="fixed right-4 top-16 z-20 flex max-h-[calc(100vh-5rem)] w-[30rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded border b-4 bg-2 text-sm text-default shadow-2xl"
    >
      <div className="shrink-0 border-b b-4 bg-3 px-4 py-4">
        <h2 id={`${id}-title`} className="text-base font-medium leading-none">
          Share project
        </h2>
        <p className="mt-2 text-xs leading-5 text-2">
          People with access can sign in to open the latest saved version.
        </p>
      </div>
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
        <section aria-labelledby={`${id}-permissions`}>
          <h3 id={`${id}-permissions`} className="text-sm font-medium">
            Current permissions
          </h3>
          {access ? (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-2">Who can open this link</dt>
              <dd className="min-w-0 break-words">
                {access.scope === 'organization'
                  ? `Members of ${organizationName ?? 'the owning organization'}`
                  : 'Project owner'}
              </dd>
              <dt className="text-2">Your access</dt>
              <dd>{access.can_edit ? 'Can edit' : 'Can view'}</dd>
            </dl>
          ) : (
            <p role="status" className="mt-2 text-sm text-2">
              {permissions === undefined
                ? 'Loading permissions…'
                : 'Could not load project permissions.'}
            </p>
          )}
        </section>
      </div>
    </Popover.Panel>
  )
}
