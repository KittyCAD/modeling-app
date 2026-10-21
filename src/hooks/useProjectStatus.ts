import type {
  KclProjectPublicationStatus,
  ProjectSummaryResponse,
} from '@kittycad/lib'
import { projects } from '@kittycad/lib'
import { listClientItems } from '@src/lib/apiPagination'
import { createKCClient } from '@src/lib/kcClient'
import { useEffect, useMemo, useState } from 'react'

export type ProjectStatus = {
  publicationStatus: KclProjectPublicationStatus
  feedback?: string
}

type RemoteProjectReference = {
  remoteProjectId?: string
}

/**
 * Fetches publication status for a single cloud-linked project by its ID.
 */
export function useProjectStatus(
  cloudProjectId: string | undefined,
  token?: string
): ProjectStatus | null {
  const [status, setStatus] = useState<ProjectStatus | null>(null)

  useEffect(() => {
    if (!token || !cloudProjectId) {
      setStatus(null)
      return
    }

    const projectId = cloudProjectId
    let cancelled = false

    async function fetchStatus() {
      try {
        const client = createKCClient(token)
        const remote = await projects.get_project({
          client,
          id: projectId,
        })
        if (!cancelled) {
          setStatus({
            publicationStatus: remote.publication_status,
            feedback: remote.publication?.feedback ?? undefined,
          })
        }
      } catch (e) {
        console.error('Failed to fetch project status', e)
      }
    }

    void fetchStatus()

    return () => {
      cancelled = true
    }
  }, [token, cloudProjectId])

  return status
}

/**
 * Fetches publication statuses when Home contains a remote-linked project.
 * Loads the complete project index instead of fetching each project individually.
 */
export function useProjectStatuses(
  homeProjects: readonly RemoteProjectReference[] | undefined,
  token?: string
): Map<string, ProjectStatus> {
  const [remoteProjects, setRemoteProjects] = useState<
    ProjectSummaryResponse[]
  >([])

  const remoteProjectIdsKey = useMemo(
    () =>
      homeProjects
        ?.flatMap((project) =>
          project.remoteProjectId ? [project.remoteProjectId] : []
        )
        .toSorted()
        .join(',') ?? '',
    [homeProjects]
  )
  useEffect(() => {
    if (!token || !remoteProjectIdsKey) {
      setRemoteProjects([])
      return
    }

    let cancelled = false

    async function fetchStatuses() {
      try {
        const client = createKCClient(token)
        const result = await listClientItems<ProjectSummaryResponse>(
          client,
          '/user/projects'
        )
        if (!cancelled) {
          setRemoteProjects(result)
        }
      } catch (e) {
        console.error('Failed to fetch project statuses', e)
      }
    }

    void fetchStatuses()

    return () => {
      cancelled = true
    }
  }, [token, remoteProjectIdsKey])

  return useMemo(() => {
    const map = new Map<string, ProjectStatus>()
    for (const remote of remoteProjects) {
      map.set(remote.id, {
        publicationStatus: remote.publication_status,
        feedback: remote.publication?.feedback ?? undefined,
      })
    }
    return map
  }, [remoteProjects])
}
