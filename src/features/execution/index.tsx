import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed, useComputed } from '@preact/signals'
import { StatusDot } from '@kittycad/ui-kit'
import { useService } from '@src/app/context'
import { commandsValueSpec } from '@src/contracts/commands'
import {
  type BufferExecutionState,
  type ExecutionStatus,
  executionCoordinatorService,
  executorsValueSpec,
  idleExecutionState,
} from '@src/contracts/execution'
import { projectSessionService } from '@src/contracts/projectSession'
import { statusBarItemsValueSpec } from '@src/contracts/shell'
import { createExecutionCoordinator } from '@src/features/execution/createExecutionCoordinator'
import { bufferOrigin, requestExecution } from '@src/lib/buffers/annotations'

/** How a status maps onto the app's five-tone state vocabulary. */
const toneFor = (state: BufferExecutionState) => {
  if (state.status === 'running' || state.status === 'queued') return 'busy'
  if (state.status === 'failed') return 'fault'
  if (state.diagnostics.some((d) => d.severity === 'error')) return 'fault'
  if (state.diagnostics.length > 0) return 'warn'
  if (state.status === 'succeeded') return 'ok'
  return 'idle'
}

const labelFor = (state: BufferExecutionState, status: ExecutionStatus) => {
  if (status === 'queued') return 'queued'
  if (status === 'running') return 'running'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'superseded'

  const errors = state.diagnostics.filter((d) => d.severity === 'error').length
  const warnings = state.diagnostics.length - errors
  if (errors > 0) return `${errors} error${errors === 1 ? '' : 's'}`
  if (warnings > 0) return `${warnings} warning${warnings === 1 ? '' : 's'}`
  if (status === 'succeeded') return 'no issues'
  return 'idle'
}

/**
 * Execution state for the buffer that is executing.
 *
 * Reads the coordinator rather than tracking anything itself, so it is correct
 * whether the run was triggered by typing, a command, or a future agent.
 */
function ExecutionField() {
  const sessions = useService(projectSessionService)
  const coordinator = useService(executionCoordinatorService)

  const buffer = useComputed(
    () => sessions.current.value?.executingBuffer.value ?? null
  )
  const state = useComputed(() =>
    buffer.value
      ? coordinator.stateFor(buffer.value.id).value
      : idleExecutionState('none')
  )

  if (!buffer.value) return null

  return (
    <span class="zds-status-field">
      <StatusDot
        tone={toneFor(state.value)}
        label={`Execution: ${labelFor(state.value, state.value.status)}`}
      />
      <span class="zds-status-field__name">kcl</span>
      <span class="zds-status-field__value">
        {labelFor(state.value, state.value.status)}
      </span>
      {state.value.durationMs !== null && state.value.status === 'succeeded' ? (
        <span class="zds-status-field__value">
          {Math.round(state.value.durationMs)}ms
        </span>
      ) : null}
    </span>
  )
}

/**
 * Provides the execution coordinator.
 *
 * Executors are contributions, so an engine-backed executor installs beside the
 * offline analysis one and takes precedence by declaring a lower order — with no
 * change to the coordinator, the adapter, or any UI.
 */
export default defineRegistryItemFactory((ctx) => {
  const executors = computed(() => ctx.valueSpecs.get(executorsValueSpec))
  const coordinator = createExecutionCoordinator({ executors })

  const executingBuffer = () =>
    ctx.services
      .get(projectSessionService)
      .current.peek()
      ?.executingBuffer.peek()

  return {
    model: coordinator,
    item: defineRuntimeRegistryItem({
      id: 'execution',
      dispose: () => coordinator.dispose(),
      providesServices: [
        provideService(executionCoordinatorService, coordinator),
      ],
      provides: [
        provide(statusBarItemsValueSpec, {
          id: 'execution.status',
          zone: 'start',
          order: 5,
          render: () => <ExecutionField />,
        }),
        provide(commandsValueSpec, {
          id: 'execution.cancel',
          title: 'Cancel execution',
          category: 'Model',
          icon: 'close',
          enabled: computed(() => coordinator.busy.value),
          run: () => coordinator.cancelAll(),
        }),
        provide(commandsValueSpec, {
          id: 'execution.rerun',
          title: 'Re-run the executing file',
          category: 'Model',
          icon: 'refresh',
          enabled: computed(
            () =>
              ctx.services.get(projectSessionService).current.value
                ?.executingBuffer.value !== null
          ),
          run: () => {
            const buffer = executingBuffer()
            if (!buffer) return

            // Requested through the buffer, as an annotated transaction, so the
            // re-run takes the same dispatch boundary as everything else rather
            // than reaching around it.
            buffer.dispatch({
              annotations: [
                bufferOrigin.of('command'),
                requestExecution.of(true),
              ],
            })
          },
        }),
      ],
    }),
  }
}, 'execution')
