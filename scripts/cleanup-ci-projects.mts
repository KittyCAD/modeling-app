import { ApiError, Client, projects, users } from '@kittycad/lib'
import type {
  ProjectShareLinkResponse,
  ProjectSummaryResponse,
} from '@kittycad/lib'

import { listClientItems } from '../src/lib/apiPagination.ts'

const DEVELOPMENT_API = 'https://api.dev.zoo.dev'
const RETENTION_MS = 60 * 60 * 1000

export function isCleanupCandidate(
  project: ProjectSummaryResponse,
  cutoff: number
): boolean {
  return (
    project.access?.scope === 'personal' &&
    project.access.can_delete === true &&
    project.access.organization_id == null &&
    project.publication_status === 'private' &&
    project.publication != null &&
    project.publication.last_published_version_id == null &&
    project.publication.last_published_at == null &&
    project.publication.submitted_at == null &&
    typeof project.revision === 'string' &&
    project.revision.length > 0 &&
    Date.parse(project.created_at) < cutoff &&
    Date.parse(project.updated_at) < cutoff
  )
}

async function main() {
  const args = process.argv.slice(2)
  if (args.some((arg) => arg !== '--apply') || args.length > 1) {
    throw new Error('Usage: node scripts/cleanup-ci-projects.mts [--apply]')
  }
  const apply = args.includes('--apply')
  const token = process.env.ZOO_API_TOKEN
  if (!token?.trim()) throw new Error('ZOO_API_TOKEN is required')

  // This is the same service-account token used by the E2E workflow. The fixed
  // development URL prevents a local ZOO_HOST setting from targeting production.
  const client = new Client({
    token,
    baseUrl: DEVELOPMENT_API,
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      }),
  })
  const user = await users.get_user_self({ client })
  if (user.is_service_account !== true) {
    throw new Error('Refusing to clean projects for a human account')
  }
  console.log(`${apply ? 'Cleanup' : 'Dry run'} for CI account ${user.id}`)

  const cutoff = Date.now() - RETENTION_MS
  const candidates = (
    await listClientItems<ProjectSummaryResponse>(client, '/user/projects')
  ).filter((project) => isCleanupCandidate(project, cutoff))
  let deleted = 0
  let eligible = 0
  for (const project of candidates) {
    try {
      const shares = await listClientItems<ProjectShareLinkResponse>(
        client,
        `/user/projects/${project.id}/share-links`
      )
      if (shares.length !== 0) continue

      // Recheck immediately before deletion so activity since the initial list
      // preserves the project. DELETE currently has no conditional revision API.
      const current = await projects.get_project({ client, id: project.id })
      if (
        current.id !== project.id ||
        current.revision !== project.revision ||
        !isCleanupCandidate(current, cutoff)
      ) {
        continue
      }
      eligible++
      if (apply) {
        await projects.delete_project({ client, id: project.id })
        deleted++
      }
      console.log(`${apply ? 'Deleted' : 'Would delete'} project ${project.id}`)
    } catch (error) {
      // E2E teardown may have already removed this project.
      if (error instanceof ApiError && error.status === 404) continue
      throw error
    }
  }
  console.log(`${eligible} eligible projects; ${deleted} deleted`)
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof ApiError
        ? `CI project cleanup failed: API returned HTTP ${error.status}`
        : error instanceof Error
          ? error.message
          : 'CI project cleanup failed'
    )
    process.exitCode = 1
  })
}
