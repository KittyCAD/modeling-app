import type { CommandWithDisabledState } from '@src/lib/commandUtils'
import {
  canUseModelingDialog,
  commandKey,
  sortCommands,
} from '@src/lib/commandUtils'
import { GLOBAL_COMMAND_SCOPES } from '@src/registry/contracts/commands'
import { describe, expect, it } from 'vitest'

function commandWithDisabled(
  name: string,
  disabled: boolean,
  groupId = 'modeling'
): CommandWithDisabledState {
  return {
    command: {
      scopes: GLOBAL_COMMAND_SCOPES,
      name,
      groupId,
      needsReview: false,
      onSubmit: () => {},
    },
    disabled,
  }
}

describe('Command sorting', () => {
  it(`Puts modeling commands first`, () => {
    const initial = [
      commandWithDisabled('a', false, 'settings'),
      commandWithDisabled('b', false, 'modeling'),
      commandWithDisabled('c', false, 'settings'),
    ]
    const sorted = initial.sort(sortCommands)
    expect(sorted[0].command.groupId).toBe('modeling')
  })

  it(`Puts disabled commands last`, () => {
    const initial = [
      commandWithDisabled('a', true, 'modeling'),
      commandWithDisabled('z', false, 'modeling'),
      commandWithDisabled('a', false, 'settings'),
    ]
    const sorted = initial.sort(sortCommands)
    expect(sorted[sorted.length - 1].disabled).toBe(true)
  })

  it(`Puts settings commands second to last`, () => {
    const initial = [
      commandWithDisabled('a', true, 'modeling'),
      commandWithDisabled('z', false, 'modeling'),
      commandWithDisabled('a', false, 'settings'),
    ]
    const sorted = initial.sort(sortCommands)
    expect(sorted[1].command.groupId).toBe('settings')
  })
})

describe('commandKey', () => {
  it('preserves command IDs and the existing machine-event fallback', () => {
    const command = commandWithDisabled(
      'Zoom to fit',
      false,
      'standardViews'
    ).command

    expect(commandKey(command)).toBe('standardViews:Zoom to fit')
    expect(commandKey({ ...command, id: 'zds.view.zoomToFit' })).toBe(
      'zds.view.zoomToFit'
    )
  })
})

describe('canUseModelingDialog', () => {
  const command = {
    groupId: 'modeling',
    args: {
      profiles: { inputType: 'selection', hidden: () => false },
      length: { inputType: 'kcl' },
      metadata: { inputType: 'text', hidden: true },
    },
  }

  it('accepts supported modeling inputs but ignores hidden metadata', () => {
    expect(canUseModelingDialog(command)).toBe(true)
    expect(canUseModelingDialog({ ...command, groupId: 'settings' })).toBe(
      false
    )
    expect(canUseModelingDialog({ ...command, args: {} })).toBe(false)
  })

  it.each([{ inputType: 'selectionMixed' }, { inputType: 'kcl', skip: true }])(
    'keeps unsupported controls and skipped flows on the palette: %o',
    (arg) => {
      expect(
        canUseModelingDialog({
          ...command,
          args: { ...command.args, extra: arg },
        })
      ).toBe(false)
    }
  )
})
