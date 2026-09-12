import { NextRequest, NextResponse } from "next/server";
import { handleMcpRequest, McpRequestContext } from "@/lib/mcp/server";
import { JsonRpcRequest } from "@/lib/mcp/types";
import { authenticateRequest } from "@/lib/auth/server-auth";

export const dynamic = "force-dynamic";

function getCorsHeaders(req: NextRequest) {
  const origin = req.headers.get("origin") || "";
  const host = req.headers.get("host") || "";
  const isAllowedLocal = origin.includes("localhost") || origin.includes("127.0.0.1") || origin === "";

  return {
    "Access-Control-Allow-Origin": isAllowedLocal && origin ? origin : "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-MCP-Version, X-Auth-Mode",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(req) });
}

export async function POST(req: NextRequest) {
  const corsHeaders = getCorsHeaders(req);

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

    // Try extracting optional authenticated context for user-owned operations
    let context: McpRequestContext | undefined = undefined;
    const authHeader = req.headers.get("authorization");
    if (authHeader) {
      const authResult = await authenticateRequest(req, { allowDemo: true });
      if (authResult.user) {
        context = {
          userId: authResult.user.id,
          authMode: authResult.user.authMode,
        };
      }
    }

    const response = await handleMcpRequest(body, context);
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
  const corsHeaders = getCorsHeaders(req);

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
