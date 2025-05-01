import type { OnboardingStatus } from '@rust/kcl-lib/bindings/OnboardingStatus'

// companion to "desktop routes" in `OnboardingRoutes` enum in Rust
enum DesktopOnboardingStatus {
  DesktopWelcome = '/desktop',
  DesktopScene = '/desktop/scene',
  DesktopToolbar = '/desktop/toolbar',
  DesktopTextToCadWelcome = '/desktop/text-to-cad',
  DesktopTextToCadPrompt = '/desktop/text-to-cad-prompt',
  DesktopFeatureTreePane = '/desktop/feature-tree-pane',
  DesktopCodePane = '/desktop/code-pane',
  DesktopProjectFilesPane = '/desktop/project-pane',
  DesktopOtherPanes = '/desktop/other-panes',
  DesktopPromptToEditWelcome = '/desktop/prompt-to-edit',
  DesktopPromptToEditPrompt = '/desktop/prompt-to-edit-prompt',
  DesktopPromptToEditResult = '/desktop/prompt-to-edit-result',
  DesktopImports = '/desktop/imports',
  DesktopExports = '/desktop/exports',
  DesktopConclusion = '/desktop/conclusion',
}

// companion to "web routes" in `OnboardingRoutes` enum in Rust
enum WebOnboardingStatus {
  BrowserWelcome = '/browser',
  BrowserScene = '/browser/scene',
  BrowserToolbar = '/browser/toolbar',
  BrowserTextToCadWelcome = '/browser/text-to-cad',
  BrowserTextToCadPrompt = '/browser/text-to-cad-prompt',
  BrowserFeatureTreePane = '/browser/feature-tree-pane',
  BrowserPromptToEditWelcome = '/browser/prompt-to-edit',
  BrowserPromptToEditPrompt = '/browser/prompt-to-edit-prompt',
  BrowserPromptToEditResult = '/browser/prompt-to-edit-result',
  BrowserConclusion = '/browser/conclusion',
}

export const onboardingPaths = {
  desktop: DesktopOnboardingStatus,
  web: WebOnboardingStatus,
} as const

export const isOnboardingPath = (input: unknown): input is OnboardingStatus => {
  return Object.values(onboardingPaths).includes(input as OnboardingStatus)
}
