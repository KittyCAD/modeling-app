user:

I know that blender has an MCP server, how does this work since the blender app is a client?

Does the client setup a websocket connection to a backend so that the server url can act as a proxy for commands?

Tell me how they did it?

model:

Short version: Blender isn’t “the MCP server.” The common setup makes Blender run a tiny socket addon (inside Blender), and a separate MCP server process bridges between your AI client (Claude Desktop, Cursor, VS Code, etc.) and that addon.

Here’s the data flow most Blender-MCP repos use:
	1.	AI client ⇄ MCP server (local stdio)
Your desktop client launches the MCP server as a local child process (e.g., uvx blender-mcp) and talks MCP over stdio. No public “server URL” is required in this mode. MCP officially supports multiple transports, and stdio is the simplest/common local one.  ￼
	2.	MCP server ⇄ Blender addon (TCP socket)
The MCP server then relays commands to Blender via a JSON-over-TCP socket exposed by the Blender addon (defaults to localhost:9876, overridable with BLENDER_HOST/BLENDER_PORT). The addon executes Blender Python API calls and returns results to the MCP server, which returns them to the client.  ￼

So, to your WebSocket/proxy question: with the popular ahujasid/blender-mcp implementation, the client does not set up a WebSocket to a backend, and there’s no remote proxy URL. It’s local stdio (client ⇄ MCP server) and local TCP (MCP server ⇄ Blender addon). Other MCP servers can use HTTP/WebSocket transports, but that’s optional and not how this Blender repo ships by default.  ￼

How they did it (concrete bits)
	•	Two components: (1) Blender addon that starts a socket server inside Blender; (2) a Python MCP server that implements the MCP spec and connects to the addon.  ￼
	•	Config & launch: Desktop client config points to a command (e.g., uvx blender-mcp) rather than a URL; environment vars like BLENDER_HOST/BLENDER_PORT tell the MCP server where to reach Blender.  ￼
	•	Protocol details: Commands and responses are JSON; the addon can expose tools such as object creation, material edits, scene queries, and (careful!) arbitrary Python execution in Blender.  ￼

If you want to replicate this architecture, the ahujasid repo’s README shows the exact setup (Claude/Cursor config, env vars, and the TCP/JSON bridge).  ￼

If you’re considering a remote/URL-based deployment instead (e.g., WebSocket/HTTP), that’s supported by MCP in general—just a different transport than the Blender addon’s default.  ￼


user:

Okay so there's a server running locally. How do you hook that up to llm? for example if I want to connect it to chat GPT, I assume it needs a public url?

What about cursor or vs-code, can you use local urls?

I'm just thinking of adding a MCP server to my app, which is also a client and trying to figure out the best way to do it.


model:

Great questions. Here’s the practical lay of the land for wiring an MCP server into different clients, and how to design yours if your app is both a client and a server.

How connection works (by client)

ChatGPT (web/desktop, via Connectors)
	•	What it expects: ChatGPT’s “Connectors” talk to remote MCP servers (HTTP/SSE on the public internet). The OpenAI docs describe “remote MCP servers” as any server reachable on the public Internet; this flow is not the local stdio model.  ￼
	•	Implication: You’ll typically provide a public URL (HTTPS) implementing the remote MCP transport (SSE / streamable HTTP) and handle your own auth (API key, OAuth, etc.). Localhost stdio won’t be picked up by ChatGPT’s cloud environment.  ￼
	•	When to choose this: You want ChatGPT to use your server without users installing anything locally.

Cursor
	•	What it supports: Cursor can connect to MCP servers via stdio (local command) or remote SSE/HTTP URL. You can add a server in Settings → Features → MCP, then choose Type: stdio or sse. For stdio you give a shell command; for SSE you give a URL.  ￼
	•	Implication: For local development and tools like Blender bridges, you can keep everything local with stdio. If you later want remote, switch to SSE with an HTTPS URL.  ￼

VS Code (Copilot / AI extensions)
	•	What it supports: VS Code implements the MCP spec and (as of mid-2025) GA’d support. It can load MCP servers, including local stdio servers launched by command, and remote transports.  ￼
	•	Implication: Same as Cursor—local stdio is first-class, and you can also point at a remote endpoint when needed.  ￼

Claude Desktop / Claude Code (for comparison)
	•	What it supports: Add MCP servers that run as local commands over stdio (most common), or other transports depending on the server. Guides show configuring servers by command without any public URL.  ￼

Do you need a public URL?
	•	Yes, for ChatGPT (Connectors) → expose remote MCP over SSE/HTTP behind HTTPS and auth.  ￼
	•	No, for Cursor/VS Code/Claude Desktop → you can use local stdio (no public URL) or optionally use a local/remote SSE URL.  ￼

How most MCP stacks are wired (transports)

The MCP spec defines standard transports: stdio (spawn a local process and speak JSON-RPC over stdin/stdout) and streamable HTTP (incl. SSE) for remote-style servers. Many clients default to stdio for local dev because it’s simple and secure; remote (SSE/HTTP) is for cloud clients like ChatGPT.  ￼

If your app is both an MCP client and server

A clean, future-proof pattern is a dual-transport server plus a small client:
	1.	Server (your app)
	•	Implement core MCP logic once, then expose two transports:
	•	stdio entrypoint (e.g., myapp-mcp serve-stdio) for Cursor/VS Code/Claude Desktop.
	•	SSE/HTTP endpoint (e.g., /mcp/sse) for ChatGPT Connectors and any remote use.  ￼
	•	Add auth for the remote endpoint (bearer token or OAuth), and use HTTPS. Clients like ChatGPT will expect a public URL with authentication.  ￼
	•	Keep your tool/resource/prompt surface identical across transports so clients behave consistently (this is the point of MCP).  ￼
	2.	Client (inside your app)
	•	If your app itself wants to use MCP tools, embed an MCP client and talk stdio to local servers you launch as child processes, or speak SSE/HTTP to remote ones, depending on context. (MCP encourages pluggable transports either way.)  ￼

Minimal configs (what users would enter)
	•	Cursor – local stdio
	•	Type: stdio
	•	Command: uvx myapp-mcp serve-stdio
	•	Notes: If your server needs env vars (e.g., BLENDER_HOST), wrap them in a small shell script and point Cursor at that.  ￼
	•	Cursor – remote SSE
	•	Type: sse
	•	URL: https://api.example.com/mcp/sse
	•	Notes: Put auth in headers; Cursor lets you configure this per server.  ￼
	•	VS Code
	•	Register your server per the VS Code MCP guide (extension or settings). It supports local-process servers and remote transports according to the MCP spec.  ￼
	•	ChatGPT (Connectors)
	•	Publish https://…/mcp with SSE/HTTP, document required auth, and list available tools/resources/prompts. Users connect it as a Connector and ChatGPT will call your remote MCP server.  ￼

Security & ops tips
	•	Local (stdio): no inbound ports, least exposure; great for things like Blender scripting bridges.
	•	Remote (SSE/HTTP): add auth, rate-limits, and consider scoped tools; you’re now on the Internet.
	•	Same schema everywhere: Keep tool names/args identical across transports so users can switch clients seamlessly.
	•	Blender-style bridges: Keep the Blender addon/server on localhost and talk to it from your MCP server via TCP/Unix socket, while your MCP server exposes stdio (local users) and an optional remote SSE for ChatGPT. This mirrors how many Blender MCP bridges do local relays today (local sockets + stdio).  ￼

TL;DR
	•	ChatGPT: Needs a public remote MCP (SSE/HTTP) URL.  ￼
	•	Cursor & VS Code: Can use local stdio commands (no URL) or remote URLs.  ￼
	•	Build yours as dual-transport so you cover both worlds with one codebase. The MCP spec explicitly supports both stdio and streamable HTTP/SSE.  ￼

If you want, I can sketch a tiny reference layout (TypeScript or Python) showing a shared tool registry wired into both a stdio runner and an SSE server.

user: 

Okay well my app is an electron app, is it easy to integrate stdio?

Are there best practises/libs for doing so?


model:

Yep—stdio is a great fit for an Electron app, and it’s straightforward if you lean on the official MCP TypeScript SDK.

What “good” looks like in Electron

1) Use the official SDK’s stdio client

The @modelcontextprotocol/sdk gives you a StdioClientTransport that spawns a child process and speaks MCP over stdin/stdout. You don’t have to hand-roll framing or JSON-RPC—just wire it up.  ￼

Why stdio here? It’s the MCP-recommended local transport for tooling that runs on the same machine (no ports, minimal surface area). If later you want ChatGPT Connector support, add a second SSE/HTTP transport to the same server; MCP explicitly supports both.  ￼

2) Spawn from the main process (not the renderer)

Launch your MCP server as a child process from Electron main and talk to it via the SDK. Keep the renderer sandboxed and communicate with main via IPC. Electron provides child_process and (optionally) utilityProcess helpers that give you clean access to stdin/stdout.  ￼

Minimal main-process client (TypeScript)

user:

Our app runs both as an electron app, and a web app. Will this solution suit both?

model:

Short answer: stdio is perfect for your Electron app, but it won’t work in a web browser. Browsers can’t spawn child processes or speak stdio. For the web build, you’ll use MCP’s remote transport (Streamable HTTP; SSE is/was used but the spec now emphasises Streamable HTTP).  ￼

What to do for each runtime

Electron (desktop)
	•	Use the MCP TS SDK’s StdioClientTransport from the main process to spawn your MCP server (child process) and talk over stdin/stdout. This is first-class in the official SDK.  ￼
	•	Spawn via Node/Electron (child_process or utilityProcess), keep the renderer sandboxed, and relay via IPC if needed.  ￼

Web app (browser)
	•	Use the Streamable HTTP client transport to call a remote MCP server you host (HTTPS). Browsers can’t use stdio. The MCP spec + SDKs document Streamable HTTP as the remote transport path; SSE is being phased out in favour of Streamable HTTP.  ￼
	•	You can either:
	1.	Run your MCP server inside your backend and expose a /mcp HTTP endpoint, or
	2.	Put a thin backend proxy in front of a separate MCP server process.
Both keep secrets off the client and let you add auth/rate-limits.  ￼

Recommended “dual-transport” design (one codebase)

Implement your MCP server once, then expose both transports:
	•	stdio entrypoint for Electron (local, no ports).
	•	Streamable HTTP endpoint for the web app / cloud clients (public HTTPS with auth).
This is exactly what the spec and SDKs are designed for.  ￼

Minimal wiring pointers

Electron (main):
	•	Spawn your server and connect with SDK client: StdioClientTransport({ command, args }).  ￼
	•	Use child_process.spawn (or utilityProcess) with piped stdio.  ￼

Browser:
	•	Point your SDK client at a Streamable HTTP endpoint (the TS SDK documents HTTP client transport; many guides show POST + streaming semantics).  ￼
	•	Secure it (bearer tokens/OAuth), and follow the session/header rules of the spec (e.g., Mcp-Session-Id).  ￼

Gotchas & best practices
	•	Don’t open localhost ports for the browser and try to hit them directly—same-origin/CORS and security issues aside, it’s not portable. Use your backend.  ￼
	•	Keep tool names/args identical across transports so Electron <→ Web behave the same. The SDK encourages this.  ￼
	•	Plan for Streamable HTTP (SSE is considered legacy/being replaced).  ￼

If you want, I can sketch a tiny skeleton that exports serve-stdio and serve-http from the same Node/TS server so your Electron build and your web build both “just work.”