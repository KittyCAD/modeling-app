import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'

const api = 'https://api.dev.zoo.dev'
const ciUserId = '96de0581-6c93-4198-b020-0f027d73a1be'
const cutoff = Date.now() - 24 * 60 * 60 * 1000
const receipt = {
  cutoff: new Date(cutoff).toISOString(),
  deleted: [],
  skipped: [],
  failures: [],
}

async function request(path, method = 'GET') {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.ZOO_API_TOKEN}`,
      'User-Agent': 'modeling-app-ci-project-cleanup',
    },
    signal: AbortSignal.timeout(30_000),
  })
  assert(
    response.ok || response.status === 404,
    `${method} ${path}: ${response.status}`
  )
  return response
}

function isStaleFixture(project) {
  return (
    /^(?:(?:test-project|demo-project|browser-file-tree-project)(?:-\d+)?|cloud-sync-e2e-[0-9a-f-]{36})$/.test(
      project.title
    ) &&
    project.access?.scope === 'personal' &&
    project.access.can_delete &&
    project.publication_status === 'private' &&
    Date.parse(project.created_at) < cutoff &&
    Date.parse(project.updated_at) < cutoff
  )
}

try {
  assert(process.env.ZOO_API_TOKEN, 'ZOO_API_TOKEN is required')
  const user = await (await request('/user')).json()
  assert.equal(user.id, ciUserId, 'Refusing to prune a different account')
  receipt.userId = user.id
  const projects = await (await request('/user/projects')).json()
  assert(Array.isArray(projects), 'Expected the complete projects list')
  receipt.before = projects.length
  const candidates = projects.filter(isStaleFixture)
  console.log(
    `Pruning ${candidates.length} stale fixtures from ${projects.length} projects`
  )

  // Bound API load. Recheck each candidate so recently changed projects survive.
  for (let offset = 0; offset < candidates.length; offset += 4) {
    const results = await Promise.allSettled(
      candidates.slice(offset, offset + 4).map(async ({ id }) => {
        const path = `/user/projects/${encodeURIComponent(id)}`
        const current = await request(path)
        if (current.status === 404 || !isStaleFixture(await current.json())) {
          receipt.skipped.push(id)
          return
        }
        await request(path, 'DELETE')
        receipt.deleted.push(id)
      })
    )
    const failures = results.filter((result) => result.status === 'rejected')
    receipt.failures.push(...failures.map((result) => String(result.reason)))
    if (offset % 100 === 0) {
      console.log(`Deleted ${receipt.deleted.length} projects`)
    }
  }

  const remaining = await (await request('/user/projects')).json()
  assert(Array.isArray(remaining), 'Expected the complete projects list')
  receipt.after = remaining.length
  const deleted = new Set(receipt.deleted)
  assert(
    !remaining.some(({ id }) => deleted.has(id)),
    'Deleted projects remain in the API'
  )
  console.log(
    `Deleted ${receipt.deleted.length}; ${remaining.length} projects remain`
  )
  assert.equal(receipt.failures.length, 0, receipt.failures.join('\n'))
} finally {
  await writeFile(
    'cloud-project-cleanup.json',
    JSON.stringify(receipt, null, 2)
  )
}
