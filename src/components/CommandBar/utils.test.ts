import { describe, expect, it, vi } from 'vitest'
import { createActor, createMachine } from 'xstate'

import {
  evaluateCommandArgumentFlags,
  getCommandOptionName,
} from '@src/components/CommandBar/utils'
import type { CommandArgument } from '@src/lib/commandTypes'

it.each(['project', 'library'])(
  'summarizes %s options by name instead of UUID',
  (kind) => {
    const id = '7ec3e1ea-92c8-430e-b1c2-35bb26d64fb0'
    const context = { argumentsToSubmit: { [kind]: id } }
    const arg = {
      inputType: 'options',
      required: true,
      options: () => [{ name: 'Client designs', value: id }],
    } satisfies CommandArgument<string>
    expect(getCommandOptionName(arg, id, context)).toBe('Client designs')
    expect(getCommandOptionName(arg, 'missing', context)).toBe('Unavailable')
  }
)

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
