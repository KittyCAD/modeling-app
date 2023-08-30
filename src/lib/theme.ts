export enum Themes {
  Light = 'light',
  Dark = 'dark',
  System = 'system',
}

export function getSystemTheme(): Exclude<Themes, 'system'> {
  return typeof window !== 'undefined' &&
    'matchMedia' in window &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? Themes.Dark
    : Themes.Light
}

export function setThemeClass(theme: Themes) {
  const systemTheme = theme === Themes.System && getSystemTheme()
  if (theme === Themes.Dark || systemTheme === Themes.Dark) {
    document.body.classList.add('dark')
  } else {
    document.body.classList.remove('dark')
  }
}
