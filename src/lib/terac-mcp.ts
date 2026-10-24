import { object } from "./terac-data";

// Direct MCP is available for free draft preparation when Claude's login is unavailable.
// Paid launches remain on the separately guarded headless path.
const DRAFT_TOOLS = new Set(["terac_get_context", "terac_create_opportunity", "terac_get_opportunity", "terac_update_opportunity"]);
export class DraftMcpClient {
  private session: string | null = null;
  private id = 0;
  constructor(private readonly apiKey: string) { if (!apiKey) throw new Error("TERAC_API_KEY is required for direct MCP drafts."); }

  private async rpc(method: string, params: unknown, notification = false): Promise<unknown> {
    const id = ++this.id;
    const response = await fetch("https://terac.com/api/mcp", { method: "POST", signal: AbortSignal.timeout(45000),
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-api-key": this.apiKey,
        ...(this.session ? { "Mcp-Session-Id": this.session } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id }), method, params }),
    });
    this.session = response.headers.get("mcp-session-id") ?? this.session;
    if (!response.ok) throw new Error(`Terac MCP returned HTTP ${response.status}.`);
    const text = await response.text();
    if (notification && !text) return null;
    const envelope = object(response.headers.get("content-type")?.includes("text/event-stream")
      ? text.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => JSON.parse(line.slice(5))).find(row => row.id === id)
      : JSON.parse(text));
    if (envelope.error) throw new Error("Terac MCP rejected the request. Inspect the saved draft before any retry.");
    return envelope.result;
  }
  async connect(): Promise<void> {
    await this.rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "second-instance-draft", version: "1.0" } });
    await this.rpc("notifications/initialized", {}, true);
  }
  async call(name: string, args: unknown): Promise<unknown> {
    if (!DRAFT_TOOLS.has(name)) throw new Error("Direct draft MCP cannot launch, pause or pay participants.");
    const result = object(await this.rpc("tools/call", { name, arguments: args }));
    if (result.isError) throw new Error("Terac draft tool rejected the request.");
    if (result.structuredContent) return result.structuredContent;
    const content = result.content as { type: string; text?: string }[] | undefined;
    const text = content?.find(block => block.type === "text")?.text;
    if (!text) throw new Error("Terac draft tool returned no structured response.");
    return JSON.parse(text);
  }
}
