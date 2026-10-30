import { useApp } from '@src/lib/boot'
import { cloudStorageService } from '@src/registry/contracts/fileOperations'
import type {
  KclProjectPublicationStatus,
  ProjectSummaryResponse,
} from '@kittycad/lib'
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
  const { registry } = useApp()
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
        const result = await registry
          .get(cloudStorageService)
          .getProjectStatus(projectId)
        if (!cancelled) {
          setStatus(result)
        }
      } catch (e) {
        console.error('Failed to fetch project status', e)
      }
    }

    void fetchStatus()

    return () => {
      cancelled = true
    }
  }, [token, cloudProjectId, registry])

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
  const { registry } = useApp()
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
        const result = await registry
          .get(cloudStorageService)
          .getProjectStatuses()
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
  }, [token, remoteProjectIdsKey, registry])

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
