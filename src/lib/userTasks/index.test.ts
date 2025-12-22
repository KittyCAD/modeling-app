import { expect, vi, describe, it } from 'vitest'
import { UserTask, UserTaskTracker } from '@src/lib/userTasks'

describe('UserTaskTracker', () => {
  it('Does not trigger a subscription multiple times', () => {
    const utt = UserTaskTracker.fromArray([], { shouldAutoPersist: false })
    const subscription = vi.fn()
    const task = UserTask.OpenedFeatureTreePane

    utt.subscribe(task, subscription)
    expect(subscription).toBeCalled()
    const result = utt.trigger(task)
    expect(result).toBe(true)
    expect(subscription).toBeCalledTimes(2)
    const resultAgain = utt.trigger(task)
    expect(resultAgain).toBe(false)
    // Should not increment
    expect(subscription).toBeCalledTimes(2)
  })
  it('Does not call subscription function if task is already completed', () => {
    const task = UserTask.OpenedFeatureTreePane
    // Because this task is included as "done", nothing should fire because of it.
    const utt = UserTaskTracker.fromArray([task], { shouldAutoPersist: false })
    const subscription = vi.fn()

    utt.subscribe(task, subscription)
    expect(subscription).not.toBeCalled()
    const result = utt.trigger(task)
    // And trying to trigger it again should do nothing.
    expect(result).toBe(false)
  })
  it('does not call persist on trigger if autoPersist is turned off', () => {
    const utt = UserTaskTracker.fromArray([], { shouldAutoPersist: false })
    const persistMethod = vi.spyOn(utt, 'persist')
    utt.trigger(UserTask.OpenedFeatureTreePane)
    expect(persistMethod).not.toBeCalled()
    utt.config.shouldAutoPersist = true
    utt.trigger(UserTask.UsedExtrude)
    expect(persistMethod).toBeCalled()
  })
})
