import { createFileOperationsScheduler } from '@src/lib/fileSystem/scheduler'
import fsZds from '@src/lib/fs-zds'

/** Shared Promise facade for tests that configure the process-wide fsZds backing. */
const testFileOperationsScheduler = createFileOperationsScheduler(fsZds)

export const testFileOperations = testFileOperationsScheduler.operations
