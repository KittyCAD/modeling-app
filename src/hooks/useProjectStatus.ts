import type {
  KclProjectPublicationStatus,
  ProjectSummaryResponse,
} from '@kittycad/lib'
import { projects } from '@kittycad/lib'
import { createKCClient } from '@src/lib/kcClient'
import type { HomeProjectEntry } from '@src/registry/contracts/homeProjects'
import { useEffect, useMemo, useState } from 'react'

export type ProjectStatus = {
  publicationStatus: KclProjectPublicationStatus
  feedback?: string
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

    let cancelled = false

    async function fetchStatus() {
      try {
        const client = createKCClient(token)
        const remote = await projects.get_project({
          client,
          id: cloudProjectId!,
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
 * Fetches publication statuses for all cloud-linked projects.
 * Uses a single `list_projects` call rather than N individual calls.
 */
export function useProjectStatuses(
  localProjects: readonly HomeProjectEntry[] | undefined,
  token?: string
): Map<string, ProjectStatus> {
  const [remoteProjects, setRemoteProjects] = useState<
    ProjectSummaryResponse[]
  >([])

  const hasCloudProjects = useMemo(() => {
    if (!localProjects) return false
    return localProjects.some((p) => !!p.remoteProjectId)
  }, [localProjects])

  useEffect(() => {
    if (!token || !hasCloudProjects) {
      setRemoteProjects([])
      return
    }

    let cancelled = false

    async function fetchStatuses() {
      try {
        const client = createKCClient(token)
        const result = await projects.list_projects({ client })
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
  }, [token, hasCloudProjects])

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
