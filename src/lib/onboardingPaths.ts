/**
 * The types of onboarding status.
 */
export type OnboardingStatus =
  | ''
  | 'completed'
  | 'incomplete'
  | 'dismissed'
  | '/desktop'
  | '/desktop/scene'
  | '/desktop/toolbar'
  | '/desktop/zookeeper'
  | '/desktop/zookeeper-prompt'
  | '/desktop/text-to-cad'
  | '/desktop/text-to-cad-prompt'
  | '/desktop/feature-tree-pane'
  | '/desktop/code-pane'
  | '/desktop/project-pane'
  | '/desktop/other-panes'
  | '/desktop/prompt-to-edit'
  | '/desktop/prompt-to-edit-prompt'
  | '/desktop/prompt-to-edit-result'
  | '/desktop/imports'
  | '/desktop/exports'
  | '/desktop/conclusion'
export type OnboardingPath = OnboardingStatus & `/${string}`
export type DesktopOnboardingPath = OnboardingPath & `/desktop${string}`

// companion to "desktop routes" in `OnboardingRoutes` enum in Rust
export const desktopOnboardingPaths: Record<string, DesktopOnboardingPath> = {
  welcome: '/desktop',
  scene: '/desktop/scene',
  toolbar: '/desktop/toolbar',
  zookeeperWelcome: '/desktop/zookeeper',
  zookeeperPrompt: '/desktop/zookeeper-prompt',
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

export const legacyDesktopOnboardingPathAliases: Record<
  string,
  DesktopOnboardingPath
> = {
  zookeeperWelcome: '/desktop/text-to-cad',
  zookeeperPrompt: '/desktop/text-to-cad-prompt',
}

export const onboardingPaths = {
  desktop: desktopOnboardingPaths,
}
/** Whatever the first onboarding path on the current platform is. */
export const onboardingStartPath = Object.values(onboardingPaths['desktop'])[0]

export const isOnboardingPath = (input: string): input is OnboardingStatus => {
  return [
    ...Object.values(onboardingPaths).flatMap((o) => Object.values(o)),
    ...Object.values(legacyDesktopOnboardingPathAliases),
  ].includes(input as OnboardingPath)
}
