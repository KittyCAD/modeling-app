import type * as ProjectShellFeature from '@src/lib/projectSession/next/feature'
import type { Item } from 'plankton'
import { vi } from 'vitest'

// Feature-gate behavior has its own tests; subsystem tests install their subject directly.
vi.mock('@src/lib/projectSession/next/feature', async (importOriginal) => ({
  ...(await importOriginal<typeof ProjectShellFeature>()),
  withProjectShellFeature: (item: Item) => item,
}))
