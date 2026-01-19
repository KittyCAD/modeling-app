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

## User-interface requirements

### Zookeeper pane

* Beside the model speed dropdown, show an agent selection dropdown.

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


## Conditions

Pre-conditions:
  * Application has been built for the web target.
Commands:
  * Only show Zookeeper as an agent selection option.
Post-conditions:
  * None

Pre-conditions:
  * Application has been built for the desktop target.
Commands:
  * Show Zookeeper and Local Agent as agent selection options.
Post-conditions:
  * None

Pre-conditions:
  * Application has been built for the desktop target.
  * Local Agent is selected either by default or through the agent selection options.
Commands:
  * Request to start the MCP Proxy Service.
Post-conditions:
  * MCP Proxy Service is started.

Pre-conditions:
  * Application has been built for the desktop target.
  * A request for the MCP Proxy Service to start via Electron IPC.
  * Code is running in the NodeJS environment of Electron.
  * All network connections are local.
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

