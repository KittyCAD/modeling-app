import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'
import type { ModelingOperation } from '@src/contracts/modelingOperations'
import type { PendingOperation } from '@src/features/modelingOperations/createOperationRunner'

/**
 * Running a modelling operation.
 *
 * Its own contract module rather than living beside the operation types, because
 * the runner's state type comes from the feature — a contract that imported the
 * whole runner would make every consumer depend on the implementation.
 */
export interface ModelingOperationsService {
  /** The operation being asked about, or null. */
  readonly pending: ReadonlySignal<PendingOperation | null>
  readonly available: ReadonlySignal<readonly ModelingOperation[]>
  start(operationId: string): Promise<void>
  answer(value: string): Promise<void>
  cancel(): void
}

export const modelingOperationsServiceContract = defineContract({
  modelingOperationsService: defineService<ModelingOperationsService>(
    'modeling.operationsService'
  ),
})

export const { modelingOperationsService } = modelingOperationsServiceContract
