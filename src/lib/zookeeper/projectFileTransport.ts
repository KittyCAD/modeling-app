import type { MlCopilotTool } from '@kittycad/lib'

type SdkProjectTool = Extract<MlCopilotTool, `project_${string}`>

// This is an SDK rollout guard, not discovery of the deployed service.
// When the SDK adds project tools, compilation forces us to review the service
// rollout and explicitly switch to true before omitting current_files.
export const SDK_HAS_PROJECT_TOOLS: [SdkProjectTool] extends [never]
  ? false
  : true = false

export function usesCloudProjectTools(
  projectId: string | undefined,
  sdkHasProjectTools: boolean = SDK_HAS_PROJECT_TOOLS
) {
  return sdkHasProjectTools && projectId?.startsWith('cloud:') === true
}
