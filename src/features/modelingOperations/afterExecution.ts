import { effect } from '@preact/signals'
import type { ExecutionCoordinator } from '@src/contracts/execution'

/**
 * How long to wait for a run before giving up on it.
 *
 * The wait is not for the run itself but for the *debounce* in front of it plus
 * the run, and neither is bounded by anything this can see. A cap is here so a
 * handoff cannot leak an effect forever when the buffer is closed, the project is
 * switched, or the run is superseded by the user typing — all of which are
 * ordinary and none of which produce a result for the version being waited on.
 */
const GIVE_UP_AFTER_MS = 30_000

/**
 * Run something once the model has caught up to a version of a buffer.
 *
 * The piece that makes "and then edit the sketch" possible. An operation writes
 * a sketch block and the block is not somewhere you can be until it has
 * executed, so the follow-up has to wait for a specific edit to land — not for
 * the next run, which might be the user typing, and not for the coordinator to
 * be idle, which it already is while the debounce is still counting.
 *
 * `resultVersion` is the exact predicate: it is the buffer version the last
 * completed result describes. Greater than counts too, because a run can be
 * superseded by a later edit and the later result still contains this one.
 */
export function afterExecution(
  coordinator: () => ExecutionCoordinator | undefined,
  until: { bufferId: string; version: number },
  run: () => void
): void {
  const execution = coordinator()
  if (!execution) return

  let done = false
  let stop = () => {}

  const finish = (act: boolean) => {
    if (done) return
    done = true
    window.clearTimeout(timer)

    /*
     * Both deferred, and for two different reasons.
     *
     * Disposing an effect from inside its own first synchronous run is not
     * allowed, and the state can already satisfy the predicate on that run.
     *
     * The command is deferred because it is a command: it will set signals — a
     * mode, a session — and doing that from inside an effect body is a write
     * during a read. It also lets anything published in the same batch as the
     * result settle first, which is what the command is waiting for.
     */
    queueMicrotask(() => {
      stop()
      if (act) run()
    })
  }

  const timer = window.setTimeout(() => finish(false), GIVE_UP_AFTER_MS)

  stop = effect(() => {
    const state = execution.stateFor(until.bufferId).value
    if (state.resultVersion === null) return
    if (state.resultVersion < until.version) return
    finish(true)
  })

  if (done) stop()
}
