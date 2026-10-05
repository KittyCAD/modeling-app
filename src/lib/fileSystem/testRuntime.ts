import { createFileOperationsRuntime } from '@src/lib/fileSystem/runtime'
import fsZds from '@src/lib/fs-zds'

/** Shared Promise facade for tests that configure the process-wide fsZds backing. */
const testFileOperationsRuntime = createFileOperationsRuntime(fsZds)

export const testFileOperations = testFileOperationsRuntime.operations
