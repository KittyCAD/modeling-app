/**
 * Common description text for MCP tools
 *
 * These constants help maintain consistency across tool descriptions
 * and make it easier to update shared messaging.
 */

/**
 * Warning about artifact graph staleness and ID invalidation
 */
export const ARTIFACT_GRAPH_STALENESS_WARNING =
  'Note: IDs may become invalid after operations modify geometry, so fetch a fresh graph before using artifact IDs.'

/**
 * Important notice about using fresh artifact graphs
 */
export const USE_FRESH_GRAPH_NOTICE =
  'IMPORTANT: Fetch a fresh artifact graph before using artifact IDs, as operations that modify geometry may invalidate previously fetched IDs.'

/**
 * Notice about using IDs from recently fetched graphs
 */
export const USE_RECENT_GRAPH_NOTICE =
  'IMPORTANT: Use IDs from a recently fetched artifact graph, as IDs may become invalid after operations modify geometry.'

/**
 * Description of artifact graph snapshot behavior
 */
export const ARTIFACT_GRAPH_SNAPSHOT_DESCRIPTION =
  'This is a snapshot that may become stale after operations modify geometry. Always fetch a fresh graph before using artifact IDs.'
