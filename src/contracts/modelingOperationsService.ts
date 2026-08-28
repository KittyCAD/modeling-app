import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'
import type { ModelingOperation } from '@src/contracts/modelingOperations'
import type { OperationLayout } from '@src/features/modelingOperations/presentation'
import type {
  ArgumentField,
  PendingOperation,
} from '@src/features/modelingOperations/createOperationRunner'

/**
 * Running a modelling operation.
 *
 * Its own contract module rather than living beside the operation types, because
 * the runner's state type comes from the feature — a contract that imported the
 * whole runner would make every consumer depend on the implementation.
 *
 * Deliberately not shaped around one surface. `asking` is what a prompt that
 * shows one argument at a time needs; `pending.fields`, `supply` and `ready` are
 * what a dialog showing all of them needs; `start` with answers is what a
 * caller that already knows them needs. All three drive the same run, and none
 * of them is a special case of another.
 */
export interface ModelingOperationsService {
  /** The operation being asked about, or null. */
  readonly pending: ReadonlySignal<PendingOperation | null>
  /** The argument a one-at-a-time prompt should be asking about. */
  readonly asking: ReadonlySignal<ArgumentField | null>
  /** Whether every argument that needs an answer has one. */
  readonly ready: ReadonlySignal<boolean>
  readonly available: ReadonlySignal<readonly ModelingOperation[]>
  /** Begin, optionally with arguments already answered, keyed by name. */
  start(
    operationId: string,
    answers?: Readonly<Record<string, string>>
  ): Promise<void>
  /** Answer the argument being asked about. Empty skips an optional one. */
  answer(value: string): Promise<void>
  /** Answer one argument by name, in any order. */
  supply(name: string, value: string): Promise<void>
  /** Take an answer back. */
  clear(name: string): Promise<void>
  /** Offer the current argument a different way. */
  chooseMethod(resolverId: string): Promise<void>
  /** Offer one argument a different way, by name. */
  chooseMethodFor(name: string, resolverId: string): Promise<void>
  /** Arm one argument to receive what is picked in the scene. */
  focus(name: string | null): void
  /** Plan and apply. */
  submit(): Promise<void>
  cancel(): void
  /**
   * How this operation's arguments are laid out.
   *
   * Read here rather than contributed to the operation, so that asking for a
   * layout is something a surface does and not something an operation carries.
   * A surface that does not group anything never calls this.
   */
  layoutFor(operationId: string): OperationLayout
}

export const modelingOperationsServiceContract = defineContract({
  modelingOperationsService: defineService<ModelingOperationsService>(
    'modeling.operationsService'
  ),
})

export const { modelingOperationsService } = modelingOperationsServiceContract
