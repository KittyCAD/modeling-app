import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { ProjectSummaryResponse } from '@kittycad/lib'

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
