/**
 * Shared types for MCP server implementation
 */

/**
 * Message types for bridge communication between MCP server and Electron app
 */
export type BridgeMessageType =
  | 'getArtifactGraph'
  | 'getFeatureTree'
  | 'getCurrentSelection'
  | 'filletEdge'

/**
 * Base bridge message structure
 */
export interface BridgeMessage {
  type: BridgeMessageType
  id: string
  timestamp: number
}

/**
 * Request message sent from MCP server to Electron app
 */
export interface BridgeRequest extends BridgeMessage {
  params?: Record<string, unknown>
}

/**
 * Response message sent from Electron app to MCP server
 */
export interface BridgeResponse extends BridgeMessage {
  success: boolean
  data?: unknown
  error?: string
}

/**
 * ArtifactGraph data structure (simplified for bridge)
 */
export type ArtifactGraphData = Array<[string, unknown]>

/**
 * FeatureTree data structure
 */
export interface FeatureTreeData {
  operations: unknown[]
}

/**
 * Selection data structure
 */
export interface SelectionData {
  graphSelections: unknown[]
  otherSelections: unknown[]
}
