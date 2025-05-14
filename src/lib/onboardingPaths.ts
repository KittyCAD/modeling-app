import type { OnboardingStatus } from '@rust/kcl-lib/bindings/OnboardingStatus'
import { isDesktop } from '@src/lib/isDesktop'

export type OnboardingPath = OnboardingStatus & `/${string}`
export type DesktopOnboardingPath = OnboardingPath & `/desktop${string}`
export type BrowserOnboardingPath = OnboardingPath & `/browser${string}`

// companion to "desktop routes" in `OnboardingRoutes` enum in Rust
export const desktopOnboardingPaths: Record<string, DesktopOnboardingPath> = {
  welcome: '/desktop',
  scene: '/desktop/scene',
  toolbar: '/desktop/toolbar',
  textToCadWelcome: '/desktop/text-to-cad',
  textToCadPrompt: '/desktop/text-to-cad-prompt',
  featureTreePane: '/desktop/feature-tree-pane',
  codePane: '/desktop/code-pane',
  projectFilesPane: '/desktop/project-pane',
  otherPanes: '/desktop/other-panes',
  promptToEditWelcome: '/desktop/prompt-to-edit',
  promptToEditPrompt: '/desktop/prompt-to-edit-prompt',
  promptToEditResult: '/desktop/prompt-to-edit-result',
  imports: '/desktop/imports',
  exports: '/desktop/exports',
  conclusion: '/desktop/conclusion',
}

// companion to "web routes" in `OnboardingRoutes` enum in Rust
export const browserOnboardingPaths: Record<string, BrowserOnboardingPath> = {
  welcome: '/browser',
  scene: '/browser/scene',
  toolbar: '/browser/toolbar',
  textToCadWelcome: '/browser/text-to-cad',
  textToCadPrompt: '/browser/text-to-cad-prompt',
  featureTreePane: '/browser/feature-tree-pane',
  promptToEditWelcome: '/browser/prompt-to-edit',
  promptToEditPrompt: '/browser/prompt-to-edit-prompt',
  promptToEditResult: '/browser/prompt-to-edit-result',
  conclusion: '/browser/conclusion',
}

export const onboardingPaths = {
  desktop: desktopOnboardingPaths,
  browser: browserOnboardingPaths,
}

export const onboardingPathsArray = Object.values(onboardingPaths).flatMap(
  (p) => Object.values(p)
)

/** Whatever the first onboarding path on the current platform is. */
export const onboardingStartPath = Object.values(
  onboardingPaths[isDesktop() ? 'desktop' : 'browser']
)[0]

export const isOnboardingPath = (input: string): input is OnboardingStatus => {
  return Object.values(onboardingPaths)
    .flatMap((o) => Object.values(o))
    .includes(input as OnboardingPath)
}

export const isDesktopOnboardingPath = (
  input: string
): input is OnboardingStatus => {
  return Object.values(onboardingPaths.desktop).includes(
    input as DesktopOnboardingPath
  )
}

export const isBrowserOnboardingPath = (
  input: string
): input is OnboardingStatus => {
  return Object.values(onboardingPaths.browser).includes(
    input as BrowserOnboardingPath
  )
}
