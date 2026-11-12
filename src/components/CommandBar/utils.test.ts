import { describe, expect, it, vi } from 'vitest'
import { createActor, createMachine } from 'xstate'

import { evaluateCommandArgumentFlags } from '@src/components/CommandBar/utils'
import type { CommandArgument } from '@src/lib/commandTypes'

describe('evaluateCommandArgumentFlags', () => {
  it('passes both command and machine context to argument flags', () => {
    const machineActor = createActor(
      createMachine({ context: { editing: true } })
    ).start()
    try {
      const context = { argumentsToSubmit: { mode: 'Edit' } }
      const hidden = vi.fn(() => true)
      const required = vi.fn(() => false)
      const arg = {
        inputType: 'string',
        machineActor,
        hidden,
        required,
      } satisfies CommandArgument<unknown>

      expect(evaluateCommandArgumentFlags(arg, context)).toEqual({
        isHidden: true,
        isRequired: false,
      })
      expect(hidden).toHaveBeenCalledWith(
        context,
        machineActor.getSnapshot().context
      )
      expect(required).toHaveBeenCalledWith(
        context,
        machineActor.getSnapshot().context
      )
    } finally {
      machineActor.stop()
    }
  })
})
