#!/usr/bin/env node

/**
 * Test script for MCP Bridge Client
 *
 * This script tests the bridge connection without needing the full MCP server.
 * Run this while the Electron app is running.
 *
 * Usage:
 *   tsx src/mcp-server/bridge/test-client.ts
 */

import { getBridgeClient } from './client'
import { isArray } from '@src/lib/utils'

async function testBridge() {
  console.log('Testing MCP Bridge connection...')
  console.log('Make sure Electron app is running!\n')

  const client = getBridgeClient()

  try {
    // Test connection
    console.log('1. Connecting to bridge...')
    await client.connect()
    console.log('✅ Connected successfully!\n')

    // Test getArtifactGraph
    console.log('2. Testing getArtifactGraph...')
    try {
      const artifactGraph = await client.request('getArtifactGraph')
      console.log('✅ getArtifactGraph response received')
      console.log('   Type:', typeof artifactGraph)
      console.log('   Is Array:', isArray(artifactGraph))
      if (isArray(artifactGraph)) {
        console.log('   Length:', artifactGraph.length)
      }
    } catch (error) {
      console.log(
        '❌ getArtifactGraph failed:',
        error instanceof Error ? error.message : error
      )
    }
    console.log()

    // Test getFeatureTree
    console.log('3. Testing getFeatureTree...')
    try {
      const featureTree = await client.request('getFeatureTree')
      console.log('✅ getFeatureTree response received')
      console.log('   Type:', typeof featureTree)
      if (
        featureTree &&
        typeof featureTree === 'object' &&
        'operations' in featureTree
      ) {
        const ops = (featureTree as { operations: unknown[] }).operations
        console.log('   Operations count:', ops.length)
      }
    } catch (error) {
      console.log(
        '❌ getFeatureTree failed:',
        error instanceof Error ? error.message : error
      )
    }
    console.log()

    // Test getCurrentSelection
    console.log('4. Testing getCurrentSelection...')
    try {
      const selection = await client.request('getCurrentSelection')
      console.log('✅ getCurrentSelection response received')
      console.log('   Type:', typeof selection)
      if (selection && typeof selection === 'object') {
        console.log('   Keys:', Object.keys(selection))
      }
    } catch (error) {
      console.log(
        '❌ getCurrentSelection failed:',
        error instanceof Error ? error.message : error
      )
    }
    console.log()

    // Disconnect
    console.log('5. Disconnecting...')
    client.disconnect()
    console.log('✅ Disconnected\n')

    console.log('✅ All tests completed!')
  } catch (error) {
    console.error('❌ Test failed:', error)
    process.exit(1)
  }
}

testBridge().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
