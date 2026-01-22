# Zoo Design Studio MCP Specification

The following details a specification of the requirements for an MCP
implementation of the Zoo Design Studio desktop application.

The application has two targets: web and desktop. We will ignore support for
web in this specification to reduce complexity (unless explicitly specified otherwise),
and to align with regular MCP operation. You must gate those code paths with the
appropriate checks that other parts of the application use.

The specification will use Hoare logic to create a list constraints you must
adhere to while developing the feature.

Based on these constraints, create an implementation plan.

Only implement tools I've specified.

Tests are redundant for this implementation, because all tools are tested anyway
through various unit and end-to-end tests.

There does not need to be any manual QA or mechanisms to test after the implementation
is completed. That responsibility is for someone else.

## User-interface requirements

### Zookeeper pane

* Users do not need to be made known the local MCP Proxy Service has started. The Zookeeper UI should simply be disabled until it's available.

## Context

* The 3D scene has +Z as up, +Y as forward, +X as right.
* The 3D modeling scene is made up of two major components: ThreeJS, and a video stream.
* ThreeJS is invoked when Start Sketch is pressed, or we're in "Sketch mode".
* Otherwise, the video stream is showing a 3D scene over WebRTC.
* The video stream can be interacted with using the mouse.
* Left-click on a face or edge selects it.
* A selection is a selected face or edge. Multiple can be selected.
* Right-click & dragging rotates the model.
* Middle-click & dragging pans the scene.
* Scrolling zooms in and out of a point of focus.
* A context menu can be opened with right-click.
* You can change the point of focus in the context menu by selecting "Center view on selection".
* Zoo API documentation can be found at https://api.zoo.dev/ as OpenAPI schema.
* Both the Zookeeper remote WebSocket and the Local Agent can be used at the same time.
* The Local Agent can use Zookeeper if it wishes as another tool call we'll implement in the future.
* Don't use isDesktop, but instead window.electron, for desktop target checks.
* Use https://modelcontextprotocol.io/docs/ to learn how to shape MCP payloads.
* Application bundle size increase in not a concern.
* It is easier if events were simulated, as if clicking on the UI, for modeling related operations.

## Conditions

Pre-conditions:
  * Application has been built for the desktop target.
  * The renderer side of the application has started / mounted.
Commands:
  * Request via IPC to start the MCP Proxy Service.
Post-conditions:
  * None

Pre-conditions:
  * Application has been built for the desktop target.
  * A request for the MCP Proxy Service to start via Electron IPC.
  * Code is running in the NodeJS environment of Electron.
  * All network connections are local.
  * The port to use is not already occupied.
Commands:
  * Start a Fastify web server.
  * Setup a catch-all HTTP request handler.
  * Setup a WebSocket server.
Post-conditions:
  * Fastify is running.
  * The Web Browser side of Electon is notified.

Pre-conditions:
  * The MCP Proxy Service has been started.
  * A notification the MCP Proxy Service has been started.
Command:
  * Connect to the local WebSocket server started by the MCP Proxy Service to receive proxied HTTP requests.
Post-condition:
  * Connected to the local WebSocket server.

Pre-conditions:
  * The MCP Proxy Service has been started.
  * The Web Browser side is connected to the local WebSocket server.
  * An HTTP request was received.
Commands:
  * Serialize the HTTP request.
  * Send it over the local WebSocket.
  * Deserialize the HTTP request on the receiving end.
  * Handle the HTTP request on the receiving end with MCPHTTPRequestHandler.
  * Serialize the HTTP response and send it back over the WebSocket.
  * Deserialize the HTTP response on the receiving end and send it as a response to the original requester.
Post-conditions:
  * An MCP request has been handled.
  * The original requester has been responded to.

Pre-conditions:
  * There is an engine connection.
  * The MCP Proxy Service has been started.
  * The model has completed rendering, if any.
  * A tools/call for tool/camera/position has been requested.
  * Translate, rotate or zoom arguments are different from the previous call.
Commands:
  * Read the translate and rotate argument and call sceneSceneCommand with type default_camera_set_view.
  * Read the zoom argument and call doZoom from CameraControls.ts.
Post-conditions:
  * The scene or model has changed perspective.

Pre-conditions:
  * There is an engine connection.
  * The MCP Proxy Service has been started.
  * The model has completed rendering, if any.
  * A tools/call for tool/camera/snapshot has been requested.
Commands:
  * Call sendSceneCommand with type take_snapshot.
  * Listen for its return data, and return it to the Agent.
Post-conditions:
  * None

Pre-conditions:
  * There is an engine connection.
  * The MCP Proxy Service has been started.
  * The model has completed rendering, if any.
  * A tools/call for tool/mouse/select has been requested.
  * The mouse coordinates are within the video stream area.
  * The mouse coordinates are relative to the video stream area.
  * The coordinate will map to a feature, such as an edge or face.
Commands:
  * Read the screen coordinates argument, and call sendSceneCommand with type highlight_set_entity.
  * tool/camera/snapshot is called to take a screenshot.
Post-conditions:
  * The selected feature is now highlighted yellow.

Pre-conditions:
  * There is an engine connection.
  * The MCP Proxy Service has been started.
  * The model has completed rendering, if any.
  * A tools/call for tool/mouse/select has been requested.
  * The mouse coordinates are within the video stream area.
  * The mouse coordinates are relative to the video stream area.
  * The coordinate will map to a feature, such as an edge or face.
Commands:
  * Read the screen coordinates argument, and call sendSceneCommand with type highlight_set_entity.
  * tool/camera/snapshot is called to take a screenshot.
Post-conditions:
  * The selected feature is now highlighted yellow.

Pre-conditions:
  * There is an engine connection.
  * The MCP Proxy Service has been started.
  * The model has completed rendering, if any.
  * A tools/call for tool/sketch/start has been requested.
Commands:
  * The Start Sketch button is invoked.
Post-conditions:
  * The Start Sketch button now reads Exit Sketch.
  * The 3D scene is now top-down looking at a grid.
  * The modelingMachine is no longer in `idle` state.

Pre-conditions:
  * A subsequent tool/sketch/* call has been called.
Commands:
  * The call is handled.
Post-conditions:
  * The previous tool is deactivated.
  * The requested tool is active.

Pre-conditions:
  * There is an engine connection.
  * The MCP Proxy Service has been started.
  * The model has completed rendering, if any.
  * The modelingMachine is not in `idle` state.
  * A tools/call for tool/sketch/line has been requested.
Commands:
  * The line tool has been activated through the modelingMachine `change tool` event.
  * Read screen coordinates as specified in the tool call argument.
  * Simulate the mouse events to click the position specified.
Post-conditions:
  * The modelingMachine is still not in `idle` state.
  * The Line tool is still active.

Pre-conditions:
  * There is an engine connection.
  * The MCP Proxy Service has been started.
  * The model has completed rendering, if any.
  * The modelingMachine is not in `idle` state.
  * A tools/call for tool/sketch/arc has been requested.
Commands:
  * The line tool has been activated through the modelingMachine `change tool` event.
  * Read screen coordinates as specified in the tool call argument.
  * Simulate the mouse events to click the position specified.
Post-conditions:
  * The modelingMachine is still not in `idle` state.
  * The Arc tool is still active.


Pre-conditions:
  * There is an engine connection.
  * The MCP Proxy Service has been started.
  * The model has completed rendering, if any.
  * The modelingMachine is not in `idle` state.
  * A tools/call for tool/sketch/extrude has been requested.
Commands:
  * The line tool has been activated through the modelingMachine `change tool` event.
  * Read screen coordinates as specified in the tool call argument.
  * Simulate the mouse events to click the position specified.
Post-conditions:
  * The modelingMachine is still not in `idle` state.
  * The Arc tool is still active.
