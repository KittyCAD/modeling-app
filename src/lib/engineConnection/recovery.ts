/** Shared retry ceiling for abnormal closes; manual retry or renewed connectivity starts a new budget. */
export function canAutomaticallyRecoverEngine(
  attempt: number,
  terminal = false
) {
  return !terminal && attempt <= 3
}
