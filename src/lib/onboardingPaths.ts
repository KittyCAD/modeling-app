import type { OnboardingStatus } from '@rust/kcl-lib/bindings/OnboardingStatus'

export type OnboardingPath = OnboardingStatus & `/${string}`
export type DesktopOnboardingPath = OnboardingPath & `/desktop${string}`

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

export const onboardingPaths = {
  desktop: desktopOnboardingPaths,
}
/** Whatever the first onboarding path on the current platform is. */
export const onboardingStartPath = Object.values(onboardingPaths['desktop'])[0]

export const isOnboardingPath = (input: string): input is OnboardingStatus => {
  return Object.values(onboardingPaths)
    .flatMap((o) => Object.values(o))
    .includes(input as OnboardingPath)
}
