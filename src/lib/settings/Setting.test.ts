import { effect } from '@preact/signals-core'
import { Setting } from '@src/lib/settings/Setting'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

describe('Setting reactivity', () => {
  const levels: Array<'default' | 'user' | 'project'> = [
    'default',
    'user',
    'project',
  ]

  it.each(levels)(
    'rejecting a %s value preserves it without subscribing the effect',
    (level) => {
      const setting = new Setting({
        defaultValue: 1,
        validate: (value) => value >= 0,
      })
      setting[level] = 2

      const rejectValue = vi.fn(() => {
        setting[level] = -1
      })
      onTestFinished(effect(rejectValue))

      expect(setting[level]).toBe(2)
      expect(rejectValue).toHaveBeenCalledTimes(1)

      setting[level] = 3

      expect(setting[level]).toBe(3)
      expect(rejectValue).toHaveBeenCalledTimes(1)
    }
  )

  it('reading current does not subscribe the effect to setting changes', () => {
    const setting = new Setting({
      defaultValue: 1,
      validate: (value) => value >= 0,
    })
    const readCurrent = vi.fn(() => setting.current)
    onTestFinished(
      effect(() => {
        readCurrent()
      })
    )

    setting.default = 2
    setting.user = 3
    setting.project = 4

    expect(setting.current).toBe(4)
    expect(readCurrent).toHaveBeenCalledTimes(1)
    expect(readCurrent).toHaveLastReturnedWith(1)
  })

  it('currentSignal notifies subscribers as overrides change and clear', () => {
    const setting = new Setting({
      defaultValue: 1,
      validate: (value) => value >= 0,
    })
    const values: number[] = []
    onTestFinished(
      effect(() => {
        values.push(setting.currentSignal.value)
      })
    )

    setting.default = 2
    setting.user = 3
    setting.project = 4
    setting.user = 5
    setting.project = undefined
    setting.user = undefined

    expect(values).toEqual([1, 2, 3, 4, 5, 2])
  })
})
