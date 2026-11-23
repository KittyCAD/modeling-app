import { signal } from '@preact/signals-core'
import type { App } from '@src/lib/app'
import {
  cloudStorageService,
  type CloudStorageService,
} from '@src/lib/cloudProjects/registry/contract'
import editorsExtension from '@src/lib/editors/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import type * as FsZdsModule from '@src/lib/fs-zds'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import {
  PROJECT_SHELL_FEATURE,
  waitForProjectShellSettled,
  withProjectShellFeature,
} from '@src/lib/projectSession/next/feature'
import { readProject } from '@src/lib/projectSession/next/utils'
import { createProjectSessionExtension } from '@src/lib/projectSession/registry'
import { localLoader, projectLoader } from '@src/lib/routeLoaders'
import {
  UserFeaturesTransition,
  UserFeaturesState,
} from '@src/machines/userFeaturesMachine'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { userFeaturesService } from '@src/registry/contracts/userFeatures'
import { userFeaturesExtension } from '@src/registry/extensions/userFeatures'
import { factory, Facet, contribute, provide, Registry } from 'plankton'
import { expect, it, vi } from 'vitest'
import { waitFor } from 'xstate'

const network = vi.hoisted(() => ({ fetchFeatures: vi.fn() }))
vi.mock('@src/lib/kcClient', () => ({
  createKCClient: () => ({}),
  kcCall: () => network.fetchFeatures(),
}))
vi.mock('@src/lib/fs-zds', async (importOriginal) => ({
  ...(await importOriginal<typeof FsZdsModule>()),
  default: (await import('@chainner/node-path')).posix,
}))
vi.mock('@src/lib/app', () => ({ App: class {} }))
vi.mock('@src/lib/wasm_lib_wrapper', () => ({}))
vi.mock('@src/lib/projectSession/next/utils', () => ({ readProject: vi.fn() }))

it.each(['local', 'cloud'] as const)(
  'opens a %s project after feature grants settle and all gated services install',
  async (kind) => {
    const grant = Promise.withResolvers<{ features: { id: string }[] }>()
    network.fetchFeatures.mockReturnValue(grant.promise)
    const registry = new Registry()
    const path = '/projects/example'
    vi.mocked(readProject).mockResolvedValue({
      contents: {
        name: 'example',
        path,
        children: [
          { name: 'main.kcl', path: `${path}/main.kcl`, children: null },
        ],
      },
      metadata: { title: 'Example', readWriteAccess: true },
    })
    const operations = {
      ...testFileOperations,
      readFile: vi.fn(async () => new TextEncoder().encode('opened contents')),
    }
    const files = factory({
      create: () => ({
        exports: { operations },
        items: [provide(fileOperationsService, operations)],
      }),
    })
    const cloud = { openProject: vi.fn(async () => path), projects: signal([]) }
    const earlier = new Facet(
      'earlier feature',
      (values: readonly number[]) => values
    )
    await registry.configure([
      userFeaturesExtension,
      provide(cloudStorageService, cloud as unknown as CloudStorageService),
      withProjectShellFeature(
        contribute(earlier, () => 1),
        'earlier'
      ),
      createProjectSessionExtension(files),
      editorsExtension,
    ])
    const features = registry.required(userFeaturesService)
    const app = {
      registry,
      userFeatures: features,
      settings: { get: () => ({ app: { libraries: { current: [] } } }) },
      closeProject: vi.fn(),
    } as unknown as App
    try {
      features.send({ type: UserFeaturesTransition.Load, token: 'test-token' })
      const load = kind === 'local' ? localLoader : projectLoader
      const url =
        kind === 'local'
          ? `https://app.zoo.dev/local/${encodeURIComponent(path)}`
          : 'https://app.zoo.dev/project/example'
      const opening = load({ app })({
        request: new Request(url),
        params: kind === 'local' ? { path } : { id: 'example' },
        context: undefined,
        unstable_pattern: kind === 'local' ? '/local/:path' : '/project/:id',
      })
      grant.resolve({ features: [{ id: PROJECT_SHELL_FEATURE }] })
      const session = await opening
      expect(session).toBe(
        registry.required(projectSessionService).currentSession.peek()
      )
      const editors = registry.required(editorsService)
      expect(editors.editors.peek()[0].contents.peek()).toBe('opened contents')
      expect(editors.views.peek()[0].editor).toBe(editors.editors.peek()[0])
    } finally {
      await vi.waitFor(() =>
        expect(registry.optional(editorsService)).toBeDefined()
      )
      await registry.dispose()
    }
  }
)

it('cancels a readiness wait while allowing a removed feature to finish cleanup', async () => {
  const grant = Promise.withResolvers<{ features: { id: string }[] }>()
  network.fetchFeatures.mockReturnValue(grant.promise)
  const cleanupStarted = Promise.withResolvers<undefined>()
  const cleanup = Promise.withResolvers<undefined>()
  let cleaned = false
  const registry = new Registry()
  await registry.configure([
    userFeaturesExtension,
    withProjectShellFeature(
      factory({
        create: () => ({
          dispose: async () => {
            cleanupStarted.resolve(undefined)
            await cleanup.promise
            cleaned = true
          },
        }),
      }),
      'resource'
    ),
  ])
  try {
    const features = registry.required(userFeaturesService)
    features.send({ type: UserFeaturesTransition.Load, token: 'test-token' })
    grant.resolve({ features: [{ id: PROJECT_SHELL_FEATURE }] })
    await waitFor(features.actor, (state) =>
      state.matches(UserFeaturesState.Ready)
    )
    await waitForProjectShellSettled(registry, new AbortController().signal)
    features.send({ type: UserFeaturesTransition.Clear })
    await cleanupStarted.promise

    const controller = new AbortController()
    const waiting = waitForProjectShellSettled(registry, controller.signal)
    controller.abort()
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
    expect(cleaned).toBe(false)
  } finally {
    cleanup.resolve(undefined)
    await waitForProjectShellSettled(registry, new AbortController().signal)
    await registry.dispose()
  }
  expect(cleaned).toBe(true)
})
