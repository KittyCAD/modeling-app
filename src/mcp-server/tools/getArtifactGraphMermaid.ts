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
  description: `Get the current ArtifactGraph as a Mermaid diagram. This provides a visual flowchart representation of how geometry artifacts relate to each other and to the code. Useful for understanding the structure and dependencies of the 3D model. ${ARTIFACT_GRAPH_STALENESS_WARNING}

Artifact code references: Some artifacts are directly created by code (e.g., Planes, Paths, Segments, Sweeps) and have codeRef fields with source ranges. Other artifacts are derived/generated automatically by operations (e.g., Walls and Caps created by Sweep operations, SweepEdges, EdgeCutEdges, Solid2d) and may not have direct code references - they inherit their relationship to code through their parent operations. To find the source range for a derived artifact, trace back through the graph edges to find the parent artifacts (e.g., for a Wall, trace back to the Segment and Sweep operation that created it).

When includeDetailedInfo is true, the diagram includes additional information useful for LLMs:
- Artifact IDs (UUIDs) for each artifact
- Full code reference ranges with module information (file names instead of module IDs)
- Detailed node path information
- Comments explaining which artifacts are derived and how to find their source`,
  inputSchema: {
    type: 'object',
    properties: {
      waitForExecution: {
        type: 'boolean',
        description: WAIT_FOR_EXECUTION_DESCRIPTION,
        default: true,
      },
      includeDetailedInfo: {
        type: 'boolean',
        description:
          'If true, includes additional information in the diagram (artifact IDs, detailed code references, node paths) that is useful for LLMs. Defaults to false for human-readable diagrams.',
        default: false,
      },
    },
  },
} as const

/**
 * Handle getArtifactGraphMermaid tool call
 */
export async function handleGetArtifactGraphMermaidTool(args?: {
  waitForExecution?: boolean
  includeDetailedInfo?: boolean
}): Promise<{
  content: Array<{ type: 'text'; text: string }>
}> {
  try {
    const client = getBridgeClient()
    const mermaidDiagram = await client.request('getArtifactGraphMermaid', {
      waitForExecution: args?.waitForExecution ?? true,
      includeDetailedInfo: args?.includeDetailedInfo ?? false,
    })

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              mermaidDiagram,
              description: `A Mermaid flowchart diagram representing the ArtifactGraph structure. The diagram shows how artifacts (geometry pieces) relate to each other and to the code that created them. Some artifacts are directly created by code and have code references, while others (like Walls, Caps, SweepEdges) are derived from parent operations and inherit their relationship to code through graph edges. IMPORTANT: ${ARTIFACT_GRAPH_SNAPSHOT_DESCRIPTION}`,
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
