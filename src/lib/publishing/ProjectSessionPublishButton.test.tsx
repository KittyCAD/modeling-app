import { signal } from '@preact/signals-core'
import { useApp } from '@src/lib/boot'
import type { ComponentProps } from 'react'
import type { PublishDialog } from '@src/components/PublishDialog'
import { cloudStorageService } from '@src/lib/cloudProjects/registry/contract'
import type { Project } from '@src/lib/projectSession/next/types'
import type { RemoteProjectSummary } from '@src/lib/cloudProjects/runtime/types'
import { editorsService } from '@src/lib/editors/registry/contract'
import { editorSaveService } from '@src/lib/save/registry/contract'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { createProjectSessionService } from '@src/lib/projectSession/next/session'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import { routerService } from '@src/registry/contracts/router'
import { wasmPromiseFacet } from '@src/registry/contracts/wasm'
import { appHeaderEndItemsFacet } from '@src/registry/contracts/appHeader'
import type { AppHeaderContext } from '@src/registry/contracts/appHeader'
import publishPlugin from '@src/registry/plugins/publish'
import { Registry } from 'plankton'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const bindings = vi.hoisted(() => ({ useApp: vi.fn(), workflow: vi.fn() }))
vi.mock('@src/lib/boot', () => ({ useApp: bindings.useApp }))
vi.mock('@src/lib/publishing/projectSessionWorkflow', () => ({
  createProjectSessionPublicationWorkflow: bindings.workflow,
}))
vi.mock('@src/components/PublishDialog', () => ({
  PublishDialog: ({ onSubmit }: ComponentProps<typeof PublishDialog>) => (
    <button
      onClick={() => {
        void onSubmit({
          title: 'Bracket',
          description: '',
          categoryIds: ['hardware'],
        })
      }}
    >
      Submit
    </button>
  ),
}))
let registry: Registry
beforeEach(async () => {
  vi.clearAllMocks()
  registry = new Registry()
  await registry.configure([publishPlugin])
})
afterEach(async () => {
  cleanup()
  await registry.dispose()
})

function setup({ available = true, cloudProject = false } = {}) {
  const projects = createProjectSessionService(testFileOperations)
  const session = projects.openProject({
    contents: { name: 'bracket', path: '/project/bracket', children: [] },
    metadata: { title: 'Bracket', readWriteAccess: true },
    ...(cloudProject
      ? ({
          storage: { type: 'cloud', projectId: 'bracket' },
        } satisfies Partial<Project>)
      : {}),
  })
  const submit = vi.fn(async () => false)
  bindings.workflow.mockReturnValue({ loadDetails: async () => null, submit })
  const wasm = signal(
    available
      ? Promise.resolve({ is_kcl_empty_or_only_settings: () => false })
      : undefined
  )
  const publishedProjects = signal<readonly RemoteProjectSummary[]>([])
  const cloud = {
    getProjectStatus: vi.fn(async () => null),
    projects: publishedProjects,
  }
  const services = new Map<unknown, unknown>([
    [projectSessionService, projects],
    [cloudStorageService, cloud],
    [editorsService, { editors: signal([]) }],
    [editorSaveService, { save: vi.fn(), adopt: vi.fn() }],
    [routerService, { navigate: vi.fn() }],
  ])
  bindings.useApp.mockReturnValue({
    // Deliberately no legacy projectSignal or singletons.
    auth: {
      useToken: () => 'token',
      useUser: () => ({ username: 'zoonaut' }),
      useAuthState: () => ({ matches: () => false }),
      token: signal('token'),
    },
    fileOperations: testFileOperations,
    registry: {
      required: (key: unknown) => services.get(key),
      optional: () => undefined,
      observe: (key: unknown) => {
        if (key !== wasmPromiseFacet) throw new Error('Unexpected observation')
        return wasm
      },
    },
  })
  const item = registry
    .get(appHeaderEndItemsFacet)
    .find((item) => item.id === 'publish.open')
  if (!item) throw new Error('Publish contribution missing')
  const Component = item.Component
  function Header({ context }: { context: AppHeaderContext }) {
    return <Component app={useApp()} context={context} className="" />
  }
  return { session, submit, Header, publishedProjects }
}

it('renders and submits the captured session without legacy application state', async () => {
  const { session, submit, Header } = setup()
  render(<Header context={{ type: 'project', session }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Submit' }))
  expect(submit).toHaveBeenCalledWith({
    title: 'Bracket',
    description: '',
    categoryIds: ['hardware'],
  })
  expect(bindings.workflow).toHaveBeenCalledWith(
    expect.objectContaining({ session, token: 'token' })
  )
})

it('disables publication without the parser and hides it on Home', () => {
  const { session, Header } = setup({ available: false })
  const view = render(<Header context={{ type: 'project', session }} />)
  expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled()
  view.rerender(<Header context={{ type: 'home' }} />)
  expect(
    screen.queryByRole('button', { name: 'Publish' })
  ).not.toBeInTheDocument()
})

it('reflects publication acknowledged by storage after a source navigation', () => {
  const { session, Header, publishedProjects } = setup({ cloudProject: true })
  render(<Header context={{ type: 'project', session }} />)
  expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument()
  act(() => {
    publishedProjects.value = [
      { id: 'bracket', publication_status: 'pending_review' },
    ]
  })
  expect(
    screen.getByRole('button', { name: 'Pending Review' })
  ).toBeInTheDocument()
})
