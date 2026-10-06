import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type {
  ProjectShareLinkResponse,
  ProjectSummaryResponse,
} from '@kittycad/lib'

import { isCleanupCandidate } from './cleanup-ci-projects.mts'

const cutoff = Date.parse('2026-09-23T11:00:00.000Z')
const eligibleProject: ProjectSummaryResponse = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'CI test project',
  description: '',
  category_ids: [],
  project_toml_path: 'project.toml',
  entrypoint_path: 'main.kcl',
  preview_status: 'pending',
  created_at: new Date(cutoff - 1).toISOString(),
  updated_at: new Date(cutoff - 1).toISOString(),
  revision: 'revision-1',
  publication_status: 'private',
  publication: { has_unpublished_changes: false },
  access: {
    scope: 'personal',
    can_delete: true,
    can_edit: true,
    can_manage_organization: true,
  },
}

test('selects an old private personal project with deletion permission', () => {
  assert.equal(isCleanupCandidate(eligibleProject, cutoff), true)
})

test('preserves organization projects and projects without deletion permission', () => {
  const accessRestrictions: ProjectSummaryResponse['access'][] = [
    { ...eligibleProject.access, scope: 'organization' },
    {
      ...eligibleProject.access,
      organization_id: '00000000-0000-4000-8000-000000000002',
    },
    { ...eligibleProject.access, can_delete: false },
  ]
  for (const access of accessRestrictions) {
    assert.equal(
      isCleanupCandidate({ ...eligibleProject, access }, cutoff),
      false,
      JSON.stringify(access)
    )
  }
})

test('preserves every non-private publication state', () => {
  const statuses: ProjectSummaryResponse['publication_status'][] = [
    'draft',
    'pending_review',
    'published',
    'rejected',
    'deleted',
    'changes_requested',
  ]
  for (const publication_status of statuses) {
    assert.equal(
      isCleanupCandidate({ ...eligibleProject, publication_status }, cutoff),
      false,
      publication_status
    )
  }
})

test('preserves private projects with publication or submission history', () => {
  const histories: Partial<ProjectSummaryResponse['publication']>[] = [
    { last_published_version_id: '00000000-0000-4000-8000-000000000003' },
    { last_published_at: eligibleProject.created_at },
    { submitted_at: eligibleProject.created_at },
  ]
  for (const history of histories) {
    assert.equal(
      isCleanupCandidate(
        {
          ...eligibleProject,
          publication: { ...eligibleProject.publication, ...history },
        },
        cutoff
      ),
      false,
      JSON.stringify(history)
    )
  }
})

test('preserves projects created or edited at or after the retention boundary', () => {
  const activityFields: ('created_at' | 'updated_at')[] = [
    'created_at',
    'updated_at',
  ]
  for (const field of activityFields) {
    for (const timestamp of [cutoff, cutoff + 1]) {
      assert.equal(
        isCleanupCandidate(
          { ...eligibleProject, [field]: new Date(timestamp).toISOString() },
          cutoff
        ),
        false,
        `${field} at ${timestamp}`
      )
    }
  }
})

test('preserves projects with invalid activity dates or an empty revision', () => {
  const invalidProjects: ProjectSummaryResponse[] = [
    { ...eligibleProject, created_at: 'not-a-date' },
    { ...eligibleProject, updated_at: '' },
    { ...eligibleProject, revision: '' },
  ]
  for (const project of invalidProjects) {
    assert.equal(isCleanupCandidate(project, cutoff), false)
  }
})

const script = fileURLToPath(
  new URL('./cleanup-ci-projects.mts', import.meta.url)
)

test('CLI fails before contacting the API when its credential is missing', () => {
  const result = spawnSync(process.execPath, [script], {
    env: { ...process.env, ZOO_API_TOKEN: '' },
    encoding: 'utf8',
    timeout: 10_000,
  })
  assert.ifError(result.error)
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /ZOO_API_TOKEN is required/)
})

test('CLI rejects unsupported or repeated arguments before credential lookup', () => {
  for (const args of [['--force'], ['--apply', '--apply']]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      env: { ...process.env, ZOO_API_TOKEN: '' },
      encoding: 'utf8',
      timeout: 10_000,
    })
    assert.ifError(result.error)
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /Usage: node scripts\/cleanup-ci-projects\.mts/)
    assert.doesNotMatch(result.stderr, /ZOO_API_TOKEN is required/)
  }
})

interface SharePage {
  body?: unknown
  status?: number
}

// Exercise the actual CLI and SDK transport without giving the subprocess a real
// credential or allowing it to contact the API.
function cleanupWithSharePages(pages: SharePage[]) {
  const preload = `
    import assert from 'node:assert/strict'
    const project = ${JSON.stringify(eligibleProject)}
    const pages = ${JSON.stringify(pages)}
    const requests = []
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      assert.equal(url.origin, 'https://api.dev.zoo.dev')
      assert.equal(request.headers.get('Authorization'), 'Bearer test-only-token')
      assert.equal(request.redirect, 'error')
      requests.push({ method: request.method, path: url.pathname, token: url.searchParams.get('page_token') })
      if (url.pathname === '/user') return Response.json({ id: 'ci-account', is_service_account: true })
      // Keep the project-list fixture on the legacy contract until API #4800.
      if (url.pathname === '/user/projects') return Response.json([project])
      if (url.pathname === '/user/projects/' + project.id + '/share-links') {
        const page = pages.shift()
        assert.ok(page, 'unexpected share-links request')
        return new Response(JSON.stringify(page.body), {
          status: page.status ?? 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      assert.equal(url.pathname, '/user/projects/' + project.id)
      if (request.method === 'DELETE') return new Response(null, { status: 204 })
      assert.equal(request.method, 'GET')
      return Response.json(project)
    }
    process.on('exit', () => console.log('TEST_REQUESTS=' + JSON.stringify(requests)))
  `
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      `data:text/javascript,${encodeURIComponent(preload)}`,
      script,
      '--apply',
    ],
    {
      env: { ...process.env, ZOO_API_TOKEN: 'test-only-token' },
      encoding: 'utf8',
      timeout: 10_000,
    }
  )
  assert.ifError(result.error)
  return result
}

const shareLink: ProjectShareLinkResponse = {
  access_mode: 'anyone_with_link',
  created_at: eligibleProject.created_at,
  key: 'shared-project',
  updated_at: eligibleProject.updated_at,
  url: 'https://example.test/shared-project',
}

test('CLI preserves a project whose share link appears after an empty page', () => {
  const result = cleanupWithSharePages([
    { body: { items: [], next_page: 'cursor-_=' } },
    {
      body: {
        items: [shareLink],
        next_page: null,
      },
    },
  ])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /"token":"cursor-_="/)
  assert.match(result.stdout, /0 eligible projects; 0 deleted/)
  assert.doesNotMatch(result.stdout, /"method":"DELETE"/)
})

test('CLI deletes only after every share-link page is empty and the project is rechecked', () => {
  const result = cleanupWithSharePages([
    { body: { items: [], next_page: 'cursor-_=' } },
    { body: { items: [], next_page: null } },
  ])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /"token":"cursor-_="/)
  assert.match(result.stdout, /1 eligible projects; 1 deleted/)
  assert.match(
    result.stdout,
    /"method":"GET","path":"\/user\/projects\/[^"/]+","token":null},{"method":"DELETE"/
  )
})

test('CLI accepts omitted cursors on initial and later terminal share-link pages', () => {
  for (const items of [[], [shareLink]]) {
    for (const initialPages of [
      [],
      [{ body: { items: [], next_page: 'cursor-_=' } }],
    ]) {
      const result = cleanupWithSharePages([
        ...initialPages,
        { body: { items } },
      ])
      assert.equal(result.status, 0, result.stderr)
      if (initialPages.length > 0) {
        assert.match(result.stdout, /"token":"cursor-_="/)
      }
      if (items.length === 0) {
        assert.match(result.stdout, /1 eligible projects; 1 deleted/)
        assert.match(
          result.stdout,
          /"method":"GET","path":"\/user\/projects\/[^"/]+","token":null},{"method":"DELETE"/
        )
      } else {
        assert.match(result.stdout, /0 eligible projects; 0 deleted/)
        assert.doesNotMatch(result.stdout, /"method":"DELETE"/)
      }
    }
  }
})

test('CLI propagates a later-page authorization error without deleting a project', () => {
  const result = cleanupWithSharePages([
    { body: { items: [], next_page: 'cursor-_=' } },
    { status: 403, body: { message: 'Forbidden' } },
  ])
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /API returned HTTP 403/)
  assert.doesNotMatch(result.stdout, /"method":"DELETE"/)
})

test('CLI rejects the obsolete bare-array share-links contract without deleting', () => {
  const result = cleanupWithSharePages([{ body: [] }])
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /paginated response|page token/i)
  assert.doesNotMatch(result.stdout, /"method":"DELETE"/)
})

test('CLI fails closed on malformed later pages and repeated cursors', () => {
  const malformedPages: SharePage[] = [
    { body: { next_page: null } },
    { body: { items: [], next_page: '' } },
    { body: { items: [], next_page: '   ' } },
    { body: { items: [], next_page: 'cursor-_=' } },
    { body: { items: null, next_page: null } },
  ]
  for (const page of malformedPages) {
    const result = cleanupWithSharePages([
      { body: { items: [], next_page: 'cursor-_=' } },
      page,
    ])
    assert.equal(result.status, 1, JSON.stringify(page))
    assert.match(result.stderr, /paginated response|page token/i)
    assert.doesNotMatch(result.stdout, /"method":"DELETE"/)
  }
})

test('CLI rejects an empty later-page body without deleting', () => {
  const result = cleanupWithSharePages([
    { body: { items: [], next_page: 'cursor-_=' } },
    { status: 204 },
  ])
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /JSON/)
  assert.doesNotMatch(result.stdout, /"method":"DELETE"/)
})
