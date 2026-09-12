import { NextRequest, NextResponse } from "next/server";
import { handleMcpRequest, McpRequestContext } from "@/lib/mcp/server";
import { JsonRpcRequest } from "@/lib/mcp/types";
import { authenticateRequest } from "@/lib/auth/server-auth";

export const dynamic = "force-dynamic";

function isAllowedOrigin(origin: string, host: string): boolean {
  if (!origin) return true; // Non-browser clients (Claude Desktop, CLI, curl)
  if (
    origin.startsWith("http://localhost:") ||
    origin.startsWith("https://localhost:") ||
    origin.startsWith("http://127.0.0.1:") ||
    origin.startsWith("https://127.0.0.1:")
  ) {
    return true;
  }
  if (host && (origin === `http://${host}` || origin === `https://${host}`)) {
    return true;
  }
  const allowed = process.env.ALLOWED_ORIGINS;
  if (allowed) {
    const list = allowed.split(",").map((s) => s.trim().toLowerCase());
    if (list.includes(origin.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function getCorsHeaders(req: NextRequest) {
  const origin = req.headers.get("origin") || "";
  const host = req.headers.get("host") || "";
  const allowed = isAllowedOrigin(origin, host);

  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-MCP-Version, X-Auth-Mode, X-Demo-User-Id",
    "Vary": "Origin",
  };

  if (allowed && origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  return { headers, isAllowed: allowed };
}

export async function OPTIONS(req: NextRequest) {
  const { headers, isAllowed } = getCorsHeaders(req);
  const origin = req.headers.get("origin");
  if (origin && !isAllowed) {
    return new NextResponse("CORS Origin Forbidden", { status: 403 });
  }
  return new NextResponse(null, { status: 204, headers });
}

export async function POST(req: NextRequest) {
  const { headers: corsHeaders, isAllowed } = getCorsHeaders(req);
  const origin = req.headers.get("origin");
  if (origin && !isAllowed) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32003,
          message: "Forbidden: Origin not permitted",
          data: { status: 403 },
        },
      },
      { status: 403 }
    );
  }

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

    // Extract authenticated context for user-owned operations
    let context: McpRequestContext | undefined = undefined;
    const authHeader = req.headers.get("authorization");
    const authModeHeader = req.headers.get("x-auth-mode");
    if (authHeader || authModeHeader === "demo") {
      const authResult = await authenticateRequest(req, { allowDemo: true });
      if (authResult.user) {
        context = {
          userId: authResult.user.id,
          authMode: authResult.user.authMode,
        };
      } else if (authResult.error) {
        context = {
          authError: authResult.error,
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
  const { headers: corsHeaders } = getCorsHeaders(req);

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
