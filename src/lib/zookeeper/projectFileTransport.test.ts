import {
  SDK_HAS_PROJECT_TOOLS,
  usesCloudProjectTools,
} from '@src/lib/zookeeper/projectFileTransport'
import { describe, expect, it } from 'vitest'

describe('Zookeeper project file transport', () => {
  it.each([
    { projectId: 'local:one', sdkHasProjectTools: false, cloud: false },
    { projectId: 'local:one', sdkHasProjectTools: true, cloud: false },
    { projectId: 'cloud:one', sdkHasProjectTools: false, cloud: false },
    { projectId: 'cloud:one', sdkHasProjectTools: true, cloud: true },
    { projectId: undefined, sdkHasProjectTools: true, cloud: false },
  ])(
    'selects the transport for $projectId with SDK support $sdkHasProjectTools',
    ({ projectId, sdkHasProjectTools, cloud }) => {
      expect(usesCloudProjectTools(projectId, sdkHasProjectTools)).toBe(cloud)
    }
  )

  it('uses the installed SDK guard by default', () => {
    expect(usesCloudProjectTools('cloud:one')).toBe(SDK_HAS_PROJECT_TOOLS)
    expect(usesCloudProjectTools('local:one')).toBe(false)
  })
})
