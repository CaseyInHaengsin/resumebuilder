/**
 * Calls MCP tools the way a connected client does: the real server from
 * `createMcpServer` (so scope gating and zod input validation both run) wired
 * to an SDK client over an in-memory transport.
 *
 * Import `./db` (or `../helpers/db`) before this in every test file.
 */
import "./db";
import { afterAll, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

export const ALL_SCOPES = ["mcp:read", "mcp:write"];

export type ToolOutcome = {
  isError: boolean;
  /** Text of the single content item (or the protocol error message). */
  text: string;
  /** Number of content items returned; 0 when the call was rejected at protocol level. */
  contentItems: number;
};

export type McpSession = {
  toolNames: string[];
  /** Calls a tool. Throws if the tool is not registered for this session's scopes. */
  call(name: string, args?: Record<string, unknown>): Promise<ToolOutcome>;
};

const open: Client[] = [];

afterAll(async () => {
  await Promise.all(open.map((c) => c.close().catch(() => {})));
});

export async function mcpSession(
  userId: number,
  scopes: string[] = ALL_SCOPES,
): Promise<McpSession> {
  const { createMcpServer } = await import("~/mcp/server");
  const server = createMcpServer(userId, scopes);
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await server.connect(serverSide);
  await client.connect(clientSide);
  open.push(client);

  const toolNames = (await client.listTools()).tools.map((t) => t.name);

  return {
    toolNames,
    async call(name, args = {}) {
      // Without this, calling a tool that does not exist yet would come back
      // as an error result and make every "returns an error" test pass.
      if (!toolNames.includes(name)) {
        throw new Error(
          `MCP tool "${name}" is not registered for scopes [${scopes.join(", ")}]`,
        );
      }
      try {
        const result = (await client.callTool({ name, arguments: args })) as {
          isError?: boolean;
          content?: { type: string; text?: string }[];
        };
        const content = result.content ?? [];
        return {
          isError: result.isError === true,
          text: content[0]?.type === "text" ? (content[0].text ?? "") : "",
          contentItems: content.length,
        };
      } catch (err) {
        // Older SDK behavior: invalid input rejects the request instead of
        // returning an error result. Either counts as a refused call.
        return {
          isError: true,
          text: err instanceof Error ? err.message : String(err),
          contentItems: 0,
        };
      }
    },
  };
}

/**
 * Success convention (app/mcp/tools/writes.ts `jsonResult`, reads.ts
 * `toJsonContent`): no `isError`, one text item holding JSON.
 */
export function okJson<T = Record<string, unknown>>(outcome: ToolOutcome): T {
  expect(outcome.isError, `expected success, got error: ${outcome.text}`).toBe(false);
  expect(outcome.contentItems).toBe(1);
  return JSON.parse(outcome.text) as T;
}

/** The call was refused: by input validation or by the tool itself. */
export function expectRefused(outcome: ToolOutcome): void {
  expect(outcome.isError, `expected an error, got: ${outcome.text}`).toBe(true);
  expect(outcome.text.trim()).not.toBe("");
  // A handler that throws (for example on a foreign-key failure) also comes
  // back from the SDK as an error result. That is a crash, not a check.
  expect(outcome.text).not.toMatch(/SQLITE|constraint failed|is not a function|Cannot read prop/i);
}

/**
 * Error convention (writes.ts `errorResult`, reads.ts `notFound`):
 * `isError: true` and one text item with a plain message, which for an id that
 * is missing or belongs to someone else reads "<Thing> <id> not found".
 */
export function expectNotFound(outcome: ToolOutcome, id: number): void {
  expectRefused(outcome);
  expect(outcome.contentItems).toBe(1);
  expect(outcome.text).toMatch(/not found/i);
  expect(outcome.text).toContain(String(id));
  expect(outcome.text).not.toMatch(/^MCP error/);
}
