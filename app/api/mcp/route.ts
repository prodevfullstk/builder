import { NextRequest, NextResponse } from "next/server";
import { handleMcpRequest } from "@/lib/mcp/server";
import { JsonRpcRequest } from "@/lib/mcp/types";

export const dynamic = "force-dynamic";

// Standard CORS headers for MCP client connections
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-MCP-Version",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  try {
    const body: JsonRpcRequest = await req.json();

    if (!body || body.jsonrpc !== "2.0" || !body.method) {
      return NextResponse.json(
        {
          jsonrpc: "2.0",
          id: (body as any)?.id || null,
          error: {
            code: -32600,
            message: "Invalid Request: must be a valid JSON-RPC 2.0 object with a 'method' property",
          },
        },
        { status: 400, headers: corsHeaders }
      );
    }

    const response = await handleMcpRequest(body);
    return NextResponse.json(response, {
      status: response.error ? (response.error.data?.status || 200) : 200,
      headers: corsHeaders,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: "Parse error: " + (err?.message || "Invalid JSON"),
        },
      },
      { status: 400, headers: corsHeaders }
    );
  }
}

export async function GET(req: NextRequest) {
  const host = req.headers.get("host") || "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const mcpEndpoint = `${protocol}://${host}/api/mcp`;

  return NextResponse.json(
    {
      name: "Opendrok Website Builder MCP Server",
      protocolVersion: "2024-11-05",
      status: "online",
      description: "Official Model Context Protocol (MCP) server for Opendrok Web Builder",
      endpoint: mcpEndpoint,
      clientConfiguration: {
        claudeDesktop: {
          mcpServers: {
            opendrok: {
              url: mcpEndpoint,
              transport: "http",
            },
          },
        },
        cursor: {
          mcpServers: {
            opendrok: {
              url: mcpEndpoint,
              type: "http",
            },
          },
        },
      },
      capabilities: {
        tools: ["list_projects", "get_project", "create_project", "list_files", "get_file", "write_file", "edit_file", "delete_file", "audit_code", "list_templates"],
        resources: ["opendrok://templates/catalog", "opendrok://system/capabilities"],
        prompts: ["build_landing_page", "audit_project_security"],
      },
    },
    { status: 200, headers: corsHeaders }
  );
}
