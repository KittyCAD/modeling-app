/**
 * Tool Registry
 *
 * Central registry for all MCP tools. This module:
 * - Maintains the list of available tools
 * - Registers tool listing handler (tools/list)
 * - Registers tool call handler (tools/call)
 * - Routes tool calls to appropriate handlers
 *
 * To add a new tool:
 * 1. Create tool file in `tools/` directory
 * 2. Import tool and handler here
 * 3. Add to `tools` array
 * 4. Add case to switch statement
 *
 * @see {@link ./getArtifactGraph.ts} for example tool implementation
 * @see {@link ../docs/mcp-adding-tools.md} for detailed guide
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import {
  getArtifactGraphTool,
  handleGetArtifactGraphTool,
} from './getArtifactGraph.js'
import {
  getFeatureTreeTool,
  handleGetFeatureTreeTool,
} from './getFeatureTree.js'
import {
  getCurrentSelectionTool,
  handleGetCurrentSelectionTool,
} from './getCurrentSelection.js'
import { filletEdgeTool, handleFilletEdgeTool } from './filletEdge.js'
import { getStatusTool, handleGetStatusTool } from './getStatus.js'
import {
  getScreenshotTool,
  handleGetScreenshotTool,
  type ScreenshotView,
} from './getScreenshot.js'
import {
  listKclSamplesTool,
  handleListKclSamplesTool,
} from './listKclSamples.js'
import { getKclSampleTool, handleGetKclSampleTool } from './getKclSample.js'
import {
  getKclFileNamesTool,
  handleGetKclFileNamesTool,
} from './getKclFileNames.js'
import {
  getCurrentKclFileTool,
  handleGetCurrentKclFileTool,
} from './getCurrentKclFile.js'
import {
  setCurrentKclFileTool,
  handleSetCurrentKclFileTool,
} from './setCurrentKclFile.js'
import {
  setEntityHighlightTool,
  handleSetEntityHighlightTool,
} from './setEntityHighlight.js'
import {
  getArtifactGraphMermaidTool,
  handleGetArtifactGraphMermaidTool,
} from './getArtifactGraphMermaid.js'
import { getCameraTool, handleGetCameraTool } from './getCamera.js'
import { setCameraTool, handleSetCameraTool } from './setCamera.js'

/**
 * All available MCP tools
 *
 * Add new tools to this array to make them available to MCP clients.
 * Each tool must have:
 * - `name`: Unique tool identifier (snake_case)
 * - `description`: Human-readable description for AI assistants
 * - `inputSchema`: JSON Schema defining tool parameters
 */
const tools = [
  getArtifactGraphTool,
  getArtifactGraphMermaidTool,
  getFeatureTreeTool,
  getCurrentSelectionTool,
  filletEdgeTool,
  getStatusTool,
  getScreenshotTool,
  listKclSamplesTool,
  getKclSampleTool,
  getKclFileNamesTool,
  getCurrentKclFileTool,
  setCurrentKclFileTool,
  setEntityHighlightTool,
  getCameraTool,
  setCameraTool,
]

/**
 * Registers all tools with the MCP server
 *
 * Sets up two request handlers:
 * 1. `tools/list`: Returns list of all available tools
 * 2. `tools/call`: Routes tool calls to appropriate handlers
 *
 * @param server - The MCP server instance to register tools with
 * @returns Promise that resolves when tools are registered
 */
export async function registerTools(server: Server): Promise<void> {
  // Register handler for listing tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    }
  })

  // Register handler for tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name

    switch (toolName) {
      case 'get_artifact_graph': {
        const args =
          (request.params.arguments as
            | { waitForExecution?: boolean }
            | undefined) || {}
        return handleGetArtifactGraphTool(args)
      }

      case 'get_artifact_graph_mermaid': {
        const args =
          (request.params.arguments as
            | { waitForExecution?: boolean; includeDetailedInfo?: boolean }
            | undefined) || {}
        return handleGetArtifactGraphMermaidTool(args)
      }

      case 'get_feature_tree': {
        const args =
          (request.params.arguments as
            | { waitForExecution?: boolean }
            | undefined) || {}
        return handleGetFeatureTreeTool(args)
      }

      case 'get_current_selection': {
        const args =
          (request.params.arguments as
            | { waitForExecution?: boolean }
            | undefined) || {}
        return handleGetCurrentSelectionTool(args)
      }

      case 'fillet_edge': {
        const args = (request.params.arguments as
          | {
              radius: string
              tag?: string
              useCurrentSelection?: boolean
              edges?: string[]
            }
          | undefined) || { radius: '' }
        return handleFilletEdgeTool(args)
      }

      case 'get_status': {
        const args =
          (request.params.arguments as
            | { waitForExecution?: boolean }
            | undefined) || {}
        return handleGetStatusTool(args)
      }

      case 'get_screenshot': {
        const args =
          (request.params.arguments as
            | {
                view?: ScreenshotView
                waitForExecution?: boolean
                entityIds?: string[]
              }
            | undefined) || {}
        return handleGetScreenshotTool(args)
      }

      case 'list_kcl_samples': {
        return handleListKclSamplesTool()
      }

      case 'get_kcl_sample': {
        const args =
          (request.params.arguments as
            | { sampleName?: string; fileName?: string }
            | undefined) || {}
        return handleGetKclSampleTool(args)
      }

      case 'get_kcl_file_names': {
        return handleGetKclFileNamesTool()
      }

      case 'get_current_kcl_file': {
        return handleGetCurrentKclFileTool()
      }

      case 'set_current_kcl_file': {
        const args =
          (request.params.arguments as { filePath?: string } | undefined) || {}
        return handleSetCurrentKclFileTool(args)
      }

      case 'set_entity_highlight': {
        const args =
          (request.params.arguments as { entityIds?: string[] } | undefined) ||
          {}
        if (!args.entityIds || args.entityIds.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    error: 'Entity IDs are required',
                    message:
                      'Please provide at least one entity ID to highlight.',
                  },
                  null,
                  2
                ),
              },
            ],
          }
        }
        return handleSetEntityHighlightTool({ entityIds: args.entityIds })
      }

      case 'get_camera': {
        const args =
          (request.params.arguments as
            | { waitForExecution?: boolean }
            | undefined) || {}
        return handleGetCameraTool(args)
      }

      case 'set_camera': {
        const args =
          (request.params.arguments as
            | {
                position?: { x: number; y: number; z: number }
                target?: { x: number; y: number; z: number }
                up?: { x: number; y: number; z: number }
                projection?: 'perspective' | 'orthographic'
                fov?: number
                waitForExecution?: boolean
              }
            | undefined) || {}
        return handleSetCameraTool(args)
      }

      default: {
        // MCP protocol expects errors to be thrown for unknown tools
        // eslint-disable-next-line suggest-no-throw/suggest-no-throw
        throw new Error(`Unknown tool: ${toolName}`)
      }
    }
  })

  // Future tools:
  // - Additional modeling operations can be added here
}
