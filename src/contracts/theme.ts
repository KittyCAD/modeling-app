import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'
import type { ThemeName } from '@kittycad/ui-kit/tokens'

export type ThemeSetting = ThemeName | 'system'

export interface ThemeService {
  /** What the user chose, including `system`. */
  readonly setting: ReadonlySignal<ThemeSetting>
  /** What is actually applied right now. Never `system`. */
  readonly resolved: ReadonlySignal<ThemeName>
  set(setting: ThemeSetting): void
  /** dark -> light -> system -> dark. */
  cycle(): void
}

export const themeContract = defineContract({
  themeService: defineService<ThemeService>('theme.service'),
})

export const { themeService } = themeContract
