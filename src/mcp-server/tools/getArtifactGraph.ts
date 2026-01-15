/**
 * Get ArtifactGraph Tool
 *
 * Tool implementation for querying the current ArtifactGraph
 * The ArtifactGraph maps geometry artifacts in the 3D scene to the code/AST
 */

import { getBridgeClient } from '../bridge/client.js'
import {
  ARTIFACT_GRAPH_SNAPSHOT_DESCRIPTION,
  ARTIFACT_GRAPH_STALENESS_WARNING,
  WAIT_FOR_EXECUTION_DESCRIPTION,
} from './descriptions.js'

export const getArtifactGraphTool = {
  name: 'get_artifact_graph',
  description: `Get the current ArtifactGraph (a snapshot of the current state), which maps geometry artifacts in the 3D scene to the code/AST. This allows you to understand how geometry relates to the user's code. ${ARTIFACT_GRAPH_STALENESS_WARNING}

Artifact code references: Some artifacts are directly created by code (e.g., Planes, Paths, Segments, Sweeps) and have codeRef fields with source ranges. Other artifacts are derived/generated automatically by operations (e.g., Walls and Caps created by Sweep operations, SweepEdges, EdgeCutEdges, Solid2d) and may not have direct code references - they inherit their relationship to code through their parent operations. Derived artifacts may have empty codeRef ranges [0, 0, 0] or missing codeRef fields. To find the source range for a derived artifact, trace back through the graph edges to find the parent artifacts (e.g., for a Wall, trace back to the Segment and Sweep operation that created it).`,
  inputSchema: {
    type: 'object',
    properties: {
      waitForExecution: {
        type: 'boolean',
        description: WAIT_FOR_EXECUTION_DESCRIPTION,
        default: true,
      },
    },
  },
} as const

/**
 * Handle getArtifactGraph tool call
 */
export async function handleGetArtifactGraphTool(args?: {
  waitForExecution?: boolean
}): Promise<{
  content: Array<{ type: 'text'; text: string }>
}> {
  try {
    const client = getBridgeClient()
    const artifactGraphData = await client.request('getArtifactGraph', {
      waitForExecution: args?.waitForExecution ?? true,
    })

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              artifactGraph: artifactGraphData,
              description: `The ArtifactGraph is an array of [artifactId, artifact] pairs. Each artifact represents a piece of geometry in the 3D scene. Some artifacts have direct codeRef fields with source ranges, while others (like Walls, Caps, SweepEdges) are derived from parent operations and may have empty or missing codeRef fields - trace back through graph edges to find their source. IMPORTANT: ${ARTIFACT_GRAPH_SNAPSHOT_DESCRIPTION}`,
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
