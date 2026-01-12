/**
 * Hello World Tool
 *
 * A simple test tool to verify MCP server is working correctly.
 * Returns a greeting message with optional name parameter.
 */

/**
 * Tool definition for hello_world
 */
export const helloWorldTool = {
  name: 'hello_world',
  description:
    'A simple hello world tool to test MCP server connectivity. Returns a greeting message.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Optional name to include in the greeting',
      },
    },
  },
} as const

/**
 * Handles calls to the hello_world tool
 */
export function handleHelloWorldTool(args: { name?: string } | undefined): {
  content: Array<{ type: 'text'; text: string }>
} {
  const name = args?.name || 'World'

  return {
    content: [
      {
        type: 'text',
        text: `Hello, ${name}! The MCP server is working correctly. 🎉`,
      },
    ],
  }
}
