# MCP Implementation Plan

This document outlines the implementation plan for adding Model Context Protocol (MCP) support to the Zoo Design Studio application. Based on the conversation in `mcp-implementation-conversation.md`, we'll use stdio transport for local development with Cursor/VS Code.

## Architecture Overview

The implementation follows a Blender-style architecture:
1. **MCP Server Process**: A separate Node.js/TypeScript process that implements the MCP spec
2. **Bridge Communication**: The MCP server communicates with the Electron app via IPC or local socket
3. **Transport**: stdio for local clients (Cursor, VS Code, Claude Desktop)

## Phase 1: Foundation & Setup

### 1.1 Project Structure
- [x] Create `src/mcp-server/` directory for MCP server code
- [x] Create `src/mcp-server/tools/` for individual tool implementations
- [x] Create `src/mcp-server/bridge/` for Electron app communication
- [x] Create `src/mcp-server/types.ts` for shared types

### 1.2 Dependencies
- [x] Add `@modelcontextprotocol/sdk` to package.json dependencies
- [x] Verify Node.js version compatibility (MCP SDK requirements) - Node.js v22.14.0 confirmed
- [x] Add any additional dependencies for IPC/socket communication (tsx added for running TypeScript)

### 1.3 Build Configuration
- [x] Add build script for MCP server (`build:mcp-server`)
- [x] Configure TypeScript compilation for MCP server (tsconfig.mcp.json created)
- [x] Create entry point script (`src/mcp-server/index.ts`)
- [x] Add executable script in package.json (`mcp-server` command)

### 1.4 Hello World Tool (Testing) - REMOVED
- [x] Create `src/mcp-server/tools/helloWorld.ts` with a simple test tool
- [x] Register hello world tool in the tool registry
- [x] Verify tool can be listed and called without bridge communication
- [x] Test MCP server with Cursor/VS Code to verify connectivity
- [x] Removed after Phase 4 completion (no longer needed with real tools)

## Phase 2: Bridge Communication

### 2.1 Communication Protocol Design
- [x] Design IPC message protocol between Electron app and MCP server
- [x] Define message types for:
  - Requesting current ArtifactGraph
  - Requesting current featureTree (operations)
  - Requesting current selection
  - Executing commands (future: fillet edge)
- [x] Define error handling and timeout strategies

### 2.2 Electron Main Process Integration
- [x] Create `src/main/mcpBridge.ts` for Electron main process bridge
- [x] Implement IPC handler in main process to expose app state
- [x] Create singleton or service to manage MCP bridge connection
- [x] Add lifecycle management (start/stop bridge on app ready/quit)

### 2.3 MCP Server Bridge Client
- [x] Create `src/mcp-server/bridge/client.ts` for communicating with Electron
- [x] Implement connection mechanism (TCP socket on localhost:9877)
- [x] Implement request/response pattern with error handling
- [x] Add connection retry logic and health checks

### 2.4 Renderer IPC Handlers
- [x] Create `src/lib/mcpBridgeRenderer.ts` for renderer-side IPC handlers
- [x] Implement handlers for getArtifactGraph, getFeatureTree, getCurrentSelection
- [x] Initialize handlers in renderer process (src/index.tsx)

## Phase 3: Core MCP Server Implementation

### 3.1 Server Setup
- [x] Create `src/mcp-server/server.ts` with MCP server initialization
- [x] Implement stdio transport using `@modelcontextprotocol/sdk`
- [x] Set up server lifecycle (initialize, start, shutdown)
- [x] Add error handling and logging

### 3.2 Tool Registry
- [x] Create `src/mcp-server/tools/registry.ts` for tool registration
- [x] Implement tool discovery and registration system
- [x] Add tool metadata (name, description, parameters)

## Phase 4: Query Tools (Phase 1 Features)

### 4.1 Get Current ArtifactGraph Tool
- [x] Create `src/mcp-server/tools/getArtifactGraph.ts`
- [x] Implement tool that queries Electron app for current ArtifactGraph
- [x] Serialize ArtifactGraph to JSON for MCP response
- [x] Add tool description and parameter documentation
- [x] Register tool in server

### 4.2 Get Current FeatureTree Tool
- [x] Create `src/mcp-server/tools/getFeatureTree.ts`
- [x] Implement tool that queries Electron app for current operations/feature tree
- [x] Access operations from kclManager.lastSuccessfulOperations (via bridge)
- [x] Format feature tree data appropriately
- [x] Add tool description and parameter documentation
- [x] Register tool in server

### 4.3 Get Current Selection Tool
- [x] Create `src/mcp-server/tools/getCurrentSelection.ts`
- [x] Implement tool that queries Electron app for current selection
- [x] Add getter for selectionRanges in KclManager
- [x] Access selectionRanges from kclManager (via bridge)
- [x] Format selection data (graphSelections, otherSelections)
- [x] Include artifact references and code ranges
- [x] Add tool description and parameter documentation
- [x] Register tool in server

### 4.4 Get Status Tool
- [x] Create `src/mcp-server/tools/getStatus.ts`
- [x] Implement tool that reports application status
- [x] Include execution state (`isExecuting`)
- [x] Include CodeMirror diagnostics (parse/execution errors)
- [x] Include project name (current project folder)
- [x] Include home screen status (optional field when true)
- [x] Add custom `waitForExecution` description (defaults to false for quick status)
- [x] Add tool description explaining MCP is most useful when project is loaded
- [x] Register tool in server

## Phase 5: Testing & Validation

### 5.1 Unit Tests
- [x] Write unit tests for bridge communication protocol
- [x] Write unit tests for each tool implementation
- [x] Write unit tests for MCP server initialization
- [x] Add test fixtures and mocks

### 5.2 Integration Tests
- [x] Test MCP server startup and shutdown (via registry integration tests)
- [x] Test tool execution end-to-end (server → bridge → Electron → response) - covered by test:mcp-bridge script
- [x] Test error handling and edge cases
- [x] Test with actual Electron app running (verified all 3 tools work in Cursor)

### 5.3 Manual Testing
- [x] Test MCP server with Cursor IDE (verified "3 tools enabled")
- [x] Test all three tools work correctly in Cursor (get_artifact_graph, get_feature_tree, get_current_selection)
- [x] Verify tool responses are correctly formatted (tested manually in Cursor + unit tests)
- [ ] Test with various app states (empty, with geometry, with selections)

## Phase 6: Documentation & Configuration

### 6.1 User Documentation
- [ ] Create `docs/mcp-setup.md` with setup instructions
- [ ] Document Cursor configuration (stdio command)
- [ ] Document VS Code configuration
- [ ] Add troubleshooting guide

### 6.2 Developer Documentation
- [ ] Document MCP server architecture
- [ ] Document bridge communication protocol
- [ ] Document how to add new tools
- [ ] Add code comments and JSDoc

### 6.3 Configuration Files
- [ ] Create example Cursor MCP config snippet
- [ ] Create example VS Code MCP config snippet
- [ ] Document environment variables (if needed)

## Phase 7: Future Enhancements (Fillet Edge Tool)

### 7.1 Fillet Edge Tool Design
- [x] Design tool parameters (edge selection, radius, tolerance, tag)
- [x] Design command execution flow
- [x] Determine how to handle multi-body selections (uses current selection)

### 7.2 Fillet Edge Implementation
- [x] Create `src/mcp-server/tools/filletEdge.ts`
- [x] Implement tool that accepts edge selection and radius
- [x] Bridge command to Electron app to execute fillet
- [x] Use existing `addFillet` function from `src/lang/modifyAst/edges.ts`
- [x] Handle errors and validation
- [x] Return updated AST or success status

### 7.3 Fillet Edge Testing
- [ ] Test fillet edge tool with various edge selections
- [ ] Test error cases (invalid selection, invalid radius)
- [ ] Test with different geometry configurations

## Phase 8: Additional Context Tools for LLMs

The goal of these tools is to provide LLMs with rich context about the 3D scene and KCL codebase that they can't get from just reading code. This helps LLMs write better KCL even without training on it.

### 8.1 Screenshot Tool
**Purpose**: Provide visual context of the 3D scene to help LLMs understand what the model actually looks like. Making multiple calls to view the part from different angles is useful for understanding the 3D geometry.

**Design Decisions**:
- Use existing `screenshot()` function from `src/lib/screenshot.ts`
- Accept `view` parameter with union type: `'Top view' | 'Bottom view' | 'Rear view' | 'Front view' | 'Right view' | 'Left view' | 'Isometric view' | 'Current view'`
- Default to `'Isometric view'` for consistent standard views
- When view is not `'Current view'`, must:
  1. Save current camera state
  2. Set camera to requested view (using `sceneInfra.camControls.updateCameraToAxis()` or `engineViewIsometric()`)
  3. Wait for camera animation to complete
  4. Take screenshot
  5. Restore original camera state
- Return image as base64 data URL (MCP standard for image resources)
- Use MCP image resource format if available, otherwise base64 in JSON

**Implementation**:
- [x] Create `src/mcp-server/tools/getScreenshot.ts`
- [x] Add bridge message type `getScreenshot`
- [x] Implement renderer handler that:
  - Accepts `view` parameter (defaults to `'Isometric view'`)
  - Saves current camera state via engine command `default_camera_get_view`
  - Maps view names to camera axis commands:
    - `'Top view'` → `updateCameraToAxis('z')` (Z axis)
    - `'Bottom view'` → `updateCameraToAxis('-z')` (-Z axis)
    - `'Front view'` → `updateCameraToAxis('-y')` (-Y axis)
    - `'Rear view'` → `updateCameraToAxis('y')` (Y axis)
    - `'Right view'` → `updateCameraToAxis('x')` (X axis)
    - `'Left view'` → `updateCameraToAxis('-x')` (-X axis)
    - `'Isometric view'` → `engineViewIsometric()` (standard isometric view)
    - `'Current view'` → skip camera change
  - Waits 800ms for camera animation to complete
  - Calls `screenshot()` function
  - Restores original camera state using `default_camera_set_view`
  - Returns image in MCP image content format (`type: 'image'`, `data`, `mimeType`)
- [x] Add tool description emphasizing value of multiple angle views
- [x] Handle errors gracefully (restore camera even on error)
- [x] Return image in proper MCP format (image content block, not JSON text)

**Considerations**:
- Screenshots can be large - consider compression or size limits
- Camera restoration must be reliable (use try/finally pattern)
- May want to wait for execution to complete before screenshot (optional `waitForExecution` parameter)
- Camera animation timing - may need to wait for engine response or add delay

### 8.2 KCL Samples Access
**Purpose**: Give LLMs access to example KCL code to learn patterns and best practices.

**Design Decisions**:
- Samples are in `public/kcl-samples/` directory (100+ examples)
- Each sample has a folder with `main.kcl` and optional screenshot
- Options considered:
  1. **List samples** - Get directory listing with names/descriptions
  2. **Search samples** - Search by name or category
  3. **Fetch sample** - Get full KCL code for a specific sample
  4. **Point to GitHub** - Just tell LLM to browse GitHub repo

**Recommendation**: Implement list + fetch approach:
- `list_kcl_samples`: Returns array of sample names with metadata (description from README, categories, screenshot paths)
- `get_kcl_sample`: Fetches the actual KCL code for a specific sample by name
- This gives LLMs structured access without requiring web browsing
- Can reference GitHub URL in tool description for manual browsing

**Implementation**:
- [x] Create `src/mcp-server/tools/listKclSamples.ts`
  - Use `public/kcl-samples/manifest.json` for sample metadata (already structured)
  - Return structured list with names, descriptions, categories
- [x] Create `src/mcp-server/tools/getKclSample.ts`
  - Accept sample name parameter
  - Read and return `main.kcl` file content from sample directory
  - Handle errors for invalid sample names
- [x] Add bridge message types (`listKclSamples` and `getKclSample`)
- [x] Add handlers in main process bridge
- [x] Add renderer handlers to read files from filesystem
- [x] Register tools in registry

**Decision**: Access samples via bridge for cloud compatibility (even though they're in `public/` folder, bridge approach works better for future web/cloud deployment)

**Implementation Notes**:
- Uses existing `manifest.json` for sample metadata (no need to parse README.md)
- File path resolution tries multiple locations to handle both dev and production builds
- Sample names are derived from directory names (e.g., "bracket", "ball-bearing")

### 8.3 Project File Management
**Purpose**: Help LLMs understand project structure and switch between files for better performance.

**Design Decisions**:
- Projects can have multiple KCL files organized in folders
- Entry file is the currently active/selected file
- LLMs might want to:
  - See all files in project
  - Switch to a smaller file for faster iteration
  - Understand file dependencies/imports

**Tools**:
1. **`get_kcl_file_names`**: List all KCL files in current project
   - Returns array of file paths (relative to project root)
   - Includes current entry file indicator
   - Optionally include file metadata (size, last modified)
   
2. **`get_current_kcl_file`**: Get the currently active file path
   - Returns the entry file path
   - Useful for understanding what file LLM is editing

3. **`set_current_kcl_file`**: Change the active/entry file
   - Accepts relative file path
   - Switches editor to that file (sets it as the entry file)
   - Useful for performance: switching to smaller files without dependencies speeds up feedback loop
   - This is a setter but provides value for LLM workflow optimization

**Implementation**:
- [ ] Create `src/mcp-server/tools/getKclFileNames.ts`
  - Access project structure from `settingsActor.getSnapshot().context.currentProject`
  - Recursively list all `.kcl` files
  - Return structured list with paths and metadata
- [ ] Create `src/mcp-server/tools/getCurrentKclFile.ts`
  - Get `kclManager.currentFilePath`
  - Return current file path relative to project root
- [ ] Create `src/mcp-server/tools/setCurrentKclFile.ts` (if we include setters)
  - Accept file path parameter
  - Navigate to file using router/route loader
  - Validate file exists in project
- [ ] Add bridge message types for file operations
- [ ] Implement renderer handlers

**Considerations**:
- File paths should be relative to project root for portability
- Need to handle browser vs desktop differences
- Should validate file exists before switching

### 8.4 Additional Context Tools (Future Considerations)

**Variables/Constants Context**:
- `get_variables`: Get all variables from execution state
  - Access from `kclManager.lastSuccessfulVariables` or `execState.variables`
  - Helpful for understanding what values are available
  - Could include variable types and current values

**Import Dependencies**:
- `get_imports`: Get list of imported files/modules
  - From `execState.filenames` or AST analysis
  - Help LLMs understand file dependencies
  - Could show import graph

**Execution Logs**:
- `get_execution_logs`: Get recent execution logs
  - From `kclManager.logs`
  - Help debug execution issues
  - Might be noisy, so optional or filtered

**Camera/View State** (Lower Priority):
- `get_camera_state`: Get current camera position/view
  - From `sceneInfra.camControls` or engine
  - Less critical but could help understand user's perspective
  - Might be overkill for most use cases

**Geometry Metadata** (Future):
- `get_geometry_bounds`: Get bounding box of current geometry
- `get_geometry_stats`: Get statistics (face count, edge count, etc.)
- Could help LLMs understand model complexity

### 8.5 Stub: get artifact graph as mermaid diagram

### 8.6 Stub: get and set tag for an artifact

### 8.7 Highlight entity in scene

## Technical Considerations

### Communication Mechanism Options
1. **IPC (Recommended for Electron)**: Use Electron's IPC between main and MCP server
2. **TCP Socket**: Local TCP socket (similar to Blender's approach)
3. **Named Pipes**: Platform-specific named pipes

**Decision**: Start with IPC for Electron, with abstraction to allow TCP socket for future web app support.

### Data Serialization
- ArtifactGraph: Already serializable (Map → Array of entries)
- FeatureTree: Operations from rustContext need serialization
- Selection: Selections type needs serialization

### Error Handling
- Bridge connection failures
- Timeout handling for requests
- Invalid app state (not initialized, no geometry, etc.)
- Tool execution errors

### Performance
- Minimize data transfer (only send necessary data)
- Consider caching for frequently accessed data
- Optimize serialization/deserialization

## File Structure

```
src/
├── mcp-server/
│   ├── index.ts                 # Entry point (stdio server)
│   ├── server.ts                 # MCP server setup
│   ├── types.ts                  # Shared types
│   ├── tools/
│   │   ├── registry.ts          # Tool registry
│   │   ├── getArtifactGraph.ts  # Get current ArtifactGraph
│   │   ├── getFeatureTree.ts    # Get current feature tree
│   │   ├── getCurrentSelection.ts # Get current selection
│   │   ├── getStatus.ts          # Get application status
│   │   ├── filletEdge.ts        # Fillet edge tool
│   │   ├── getScreenshot.ts     # Get 3D scene screenshot (Phase 8)
│   │   ├── listKclSamples.ts    # List available KCL samples (Phase 8)
│   │   ├── getKclSample.ts      # Get specific KCL sample code (Phase 8)
│   │   ├── getKclFileNames.ts   # List KCL files in project (Phase 8)
│   │   ├── getCurrentKclFile.ts # Get current active file (Phase 8)
│   │   └── setCurrentKclFile.ts # Set active file (Phase 8, optional)
│   └── bridge/
│       ├── client.ts            # Bridge client (talks to Electron)
│       └── protocol.ts           # Communication protocol types
└── main/
    └── mcpBridge.ts             # Electron main process bridge handler
```

## Success Criteria

- [ ] MCP server can be started via stdio command
- [ ] Cursor IDE can connect to MCP server
- [ ] All three query tools (ArtifactGraph, FeatureTree, Selection) work correctly
- [ ] Tools return properly formatted JSON responses
- [ ] Error handling works for edge cases
- [ ] Documentation is complete and accurate
- [ ] Code follows project conventions (no `any`, no `as`, no semicolons)

## Notes

- The MCP server will run as a separate process, spawned by the IDE (Cursor/VS Code)
- The server needs to communicate with the Electron app, which may require the app to be running
- Consider adding a "server mode" flag or environment variable to enable MCP bridge in Electron
- Future: Add Streamable HTTP transport for web app support (as discussed in conversation)


## quick notes

run tests
```bash
npm run test:integration -- src/mcp-server
npm run test:unit -- src/mcp-server
```