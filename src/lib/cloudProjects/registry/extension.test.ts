import { provide, Registry } from 'plankton'
import { signal } from '@preact/signals-core'
import { cloudProjectsExtension } from '@src/lib/cloudProjects/registry/extension'
import { cloudStorageService } from '@src/lib/cloudProjects/registry/contract'
import {
  authService,
  type AuthRegistryService,
} from '@src/registry/contracts/auth'
import { expect, it, vi } from 'vitest'

vi.mock('@src/lib/fs-zds', async () => ({
  default: {
    ...(await import('@src/lib/fs-zds/noopfs')).default.impl,
    ...(await import('@chainner/node-path')).posix,
  },
}))

it('constructs cloud storage without resolving auth while building the registry graph', async () => {
  const registry = new Registry()
  await registry.configure([
    cloudProjectsExtension,
    provide(authService, {
      token: signal('token'),
      user: signal({ id: 'account' }),
    } as unknown as AuthRegistryService),
  ])
  try {
    const storage = registry.required(cloudStorageService)
    await Promise.resolve()
    expect(storage.projects.value).toEqual([])
  } finally {
    await registry.dispose()
  }
})
