/**
 * Foobar DJ — MCP Server Entry Point
 *
 * A Model Context Protocol server that bridges LLMs to Foobar2000
 * via the Beefweb REST API. Gives any MCP-compatible agent
 * (Gemini CLI, Antigravity, Claude, etc.) the ability to:
 *
 *   - See what's playing
 *   - Control playback (play/pause/skip/volume)
 *   - Browse and search your local music library
 *   - Create mood-based playlists
 *   - Play specific artists
 *
 * Transport: stdio (spawned by the MCP client)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";

const server = new McpServer({
  name: "foobar-dj",
  version: "0.1.0",
});

// Register all Foobar2000 tools
registerTools(server);

// Connect via stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
