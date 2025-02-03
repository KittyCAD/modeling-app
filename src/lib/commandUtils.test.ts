import { CommandWithDisabledState, sortCommands } from './commandUtils'

function commandWithDisabled(
  name: string,
  disabled: boolean,
  groupId = 'modeling'
): CommandWithDisabledState {
  return {
    command: {
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
