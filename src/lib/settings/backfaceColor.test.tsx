import { Registry } from '@kittycad/registry'
import { createSettings } from '@src/lib/settings/initialSettings'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

test('applies every native color change immediately without a delayed write after unmount', async () => {
  const settings = createSettings()
  const ColorSetting = settings.modeling.backfaceColor.Component
  if (!ColorSetting)
    expect.fail('Backface color must have its real settings field')
  const updateValue = vi.fn((value: string) => {
    settings.modeling.backfaceColor.user = value
  })
  const { unmount } = render(
    <ColorSetting
      value="#123456"
      updateValue={updateValue}
      category="modeling"
      settingName="backfaceColor"
      settingsLevel="user"
      settingsContext={settings}
      registry={new Registry()}
    />
  )
  const input = screen.getByDisplayValue('#123456')
  fireEvent.change(input, { target: { value: '#ff0000' } })
  expect(settings.modeling.backfaceColor.current).toBe('#FF0000')
  fireEvent.change(input, { target: { value: '#00ff00' } })
  expect(settings.modeling.backfaceColor.current).toBe('#00FF00')
  unmount()
  await Promise.resolve()
  expect(updateValue.mock.calls).toEqual([['#FF0000'], ['#00FF00']])
})
