/**
 * Get ArtifactGraph Mermaid Diagram Tool
 *
 * Tool implementation for getting the artifact graph as a Mermaid diagram
 * This provides a visual representation of the artifact graph structure
 */

import { getBridgeClient } from '../bridge/client.js'
import {
  ARTIFACT_GRAPH_SNAPSHOT_DESCRIPTION,
  ARTIFACT_GRAPH_STALENESS_WARNING,
  WAIT_FOR_EXECUTION_DESCRIPTION,
} from './descriptions.js'

export const getArtifactGraphMermaidTool = {
  name: 'get_artifact_graph_mermaid',
  description: `Get the current ArtifactGraph as a Mermaid diagram. This provides a visual flowchart representation of how geometry artifacts relate to each other and to the code. Useful for understanding the structure and dependencies of the 3D model. ${ARTIFACT_GRAPH_STALENESS_WARNING}`,
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
 * Handle getArtifactGraphMermaid tool call
 */
export async function handleGetArtifactGraphMermaidTool(args?: {
  waitForExecution?: boolean
}): Promise<{
  content: Array<{ type: 'text'; text: string }>
}> {
  try {
    const client = getBridgeClient()
    const mermaidDiagram = await client.request('getArtifactGraphMermaid', {
      waitForExecution: args?.waitForExecution ?? true,
    })

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              mermaidDiagram,
              description: `A Mermaid flowchart diagram representing the ArtifactGraph structure. The diagram shows how artifacts (geometry pieces) relate to each other and to the code that created them. IMPORTANT: ${ARTIFACT_GRAPH_SNAPSHOT_DESCRIPTION}`,
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
                'Failed to retrieve ArtifactGraph Mermaid diagram. Make sure the Electron app is running and the bridge is connected.',
            },
            null,
            2
          ),
        },
      ],
    }
  }
}
