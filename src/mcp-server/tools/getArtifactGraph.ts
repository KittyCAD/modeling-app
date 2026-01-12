/**
 * Get ArtifactGraph Tool
 *
 * Tool implementation for querying the current ArtifactGraph
 * The ArtifactGraph maps geometry artifacts in the 3D scene to the code/AST
 */

import { getBridgeClient } from '../bridge/client.js'

export const getArtifactGraphTool = {
  name: 'get_artifact_graph',
  description:
    "Get the current ArtifactGraph, which maps geometry artifacts in the 3D scene to the code/AST. This allows you to understand how geometry relates to the user's code.",
  inputSchema: {
    type: 'object',
    properties: {},
  },
} as const

/**
 * Handle getArtifactGraph tool call
 */
export async function handleGetArtifactGraphTool(): Promise<{
  content: Array<{ type: 'text'; text: string }>
}> {
  try {
    const client = getBridgeClient()
    const artifactGraphData = await client.request('getArtifactGraph')

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              artifactGraph: artifactGraphData,
              description:
                'The ArtifactGraph is an array of [artifactId, artifact] pairs. Each artifact represents a piece of geometry in the 3D scene and contains references to the code that created it.',
            },
            null,
            2
          ),
        },
      ],
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: error instanceof Error ? error.message : 'Unknown error',
              message:
                'Failed to retrieve ArtifactGraph. Make sure the Electron app is running and the bridge is connected.',
            },
            null,
            2
          ),
        },
      ],
    }
  }
}
