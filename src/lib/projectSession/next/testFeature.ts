import type { RegistryItem } from '@kittycad/registry'
import { vi } from 'vitest'
import type * as ProjectShellFeature from '@src/lib/projectSession/next/feature'

// Feature-gate behavior has its own tests; subsystem tests install their subject directly.
vi.mock('@src/lib/projectSession/next/feature', async (importOriginal) => ({
  ...(await importOriginal<typeof ProjectShellFeature>()),
  withProjectShellFeature: (item: RegistryItem) => item,
}))
