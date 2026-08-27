import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { fsOperationQueueService } from '@src/contracts/fsOperations'
import { createFsOperationQueue } from '@src/features/fsOperations/createFsOperationQueue'

/**
 * The single path through which the app mutates files.
 *
 * Kept apart from the filesystem service on purpose: `FileSystem` is *how* to
 * read and write, this is *when*. Ordering and provenance are policy, and policy
 * that lives in the same object as the mechanism ends up bypassed.
 */
export default defineRegistryItemFactory(() => {
  const queue = createFsOperationQueue()

  return {
    model: queue,
    item: defineRuntimeRegistryItem({
      id: 'fsOperations',
      providesServices: [provideService(fsOperationQueueService, queue)],
    }),
  }
}, 'fsOperations')
