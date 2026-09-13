import {
  JsonRpcRequest,
  JsonRpcResponse,
  MCPErrorEnvelope,
} from "./types";
import {
  OPENDROK_MCP_TOOLS,
  OPENDROK_MCP_RESOURCES,
  OPENDROK_MCP_PROMPTS,
} from "./catalog";
import { SUGGESTED_PROMPTS } from "../ai/prompt-templates";
import { runCodeScan } from "../export/code-scanner";
import {
  AuthoritativeProject,
  getServerProject,
  registerServerProject,
  listServerProjectsForOwner,
  verifyProjectOwnership,
} from "../storage/project-authority";

function makeError(
  code: number,
  message: string,
  hint?: string,
  retryable = false,
  status = 500
): MCPErrorEnvelope {
  return {
    code,
    message,
    data: {
      hint,
      retryable,
      status: status || (code === -32602 ? 400 : code === -32601 ? 404 : 500),
    },
  };
}

export interface McpRequestContext {
  userId?: string;
  authMode?: 'real' | 'demo';
  authError?: string;
}

const PROJECT_SCOPED_TOOLS = new Set([
  "list_projects",
  "get_project",
  "create_project",
  "list_files",
  "get_file",
  "write_file",
  "edit_file",
  "delete_file",
  "audit_code",
]);

export async function handleMcpRequest(
  request: JsonRpcRequest,
  context?: McpRequestContext
): Promise<JsonRpcResponse> {
  const { id, method, params = {} } = request;

  try {
    switch (method) {
      // 1. MCP Initialization Handshake
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            serverInfo: {
              name: "opendrok-website-builder-mcp",
              version: "1.0.0",
              description: "Official Model Context Protocol (MCP) server for Opendrok Web Builder",
            },
            capabilities: {
              tools: { listChanged: false },
              resources: { subscribe: false, listChanged: false },
              prompts: { listChanged: false },
            },
          },
        };

      case "notifications/initialized":
        return { jsonrpc: "2.0", id, result: {} };

      // 2. Tools
      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: OPENDROK_MCP_TOOLS,
          },
        };

      case "tools/call": {
        const toolName = params.name;
        const args = params.arguments || params.args || {};

        if (!toolName) {
          return {
            jsonrpc: "2.0",
            id,
            error: makeError(
              -32602,
              "Tool name is required in params.name",
              "Provide 'name' parameter matching one of the tools in tools/list",
              false,
              400
            ),
          };
        }

        const result = await executeMcpTool(toolName, args, context);

        if (
          result &&
          typeof result === "object" &&
          "code" in result &&
          "message" in result &&
          "data" in result
        ) {
          return {
            jsonrpc: "2.0",
            id,
            error: result as MCPErrorEnvelope,
          };
        }

        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
              },
            ],
          },
        };
      }

      // 3. Resources
      case "resources/list":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            resources: OPENDROK_MCP_RESOURCES,
          },
        };

      case "resources/read": {
        const uri = params.uri;
        if (uri === "opendrok://templates/catalog") {
          return {
            jsonrpc: "2.0",
            id,
            result: {
              contents: [
                {
                  uri,
                  mimeType: "application/json",
                  text: JSON.stringify(SUGGESTED_PROMPTS, null, 2),
                },
              ],
            },
          };
        }

        if (uri === "opendrok://system/capabilities") {
          return {
            jsonrpc: "2.0",
            id,
            result: {
              contents: [
                {
                  uri,
                  mimeType: "application/json",
                  text: JSON.stringify({
                    supportedFrameworks: ["nextjs", "vite", "astro", "node"],
                    previewEngines: ["instant", "nodebox", "vercel"],
                    gitExportSupported: true,
                    multimodalVision: true,
                  }, null, 2),
                },
              ],
            },
          };
        }

        return {
          jsonrpc: "2.0",
          id,
          error: makeError(-32602, `Resource '${uri}' not found`, "Call resources/list to view all available resources"),
        };
      }

      // 4. Prompts
      case "prompts/list":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            prompts: OPENDROK_MCP_PROMPTS,
          },
        };

      case "prompts/get": {
        const promptName = params.name;
        if (promptName === "build_landing_page") {
          const product = params.arguments?.product || "modern SaaS";
          const theme = params.arguments?.theme || "dark cyberpunk";
          return {
            jsonrpc: "2.0",
            id,
            result: {
              description: "Landing page guide",
              messages: [
                {
                  role: "user",
                  content: {
                    type: "text",
                    text: `Please design and build a high-converting landing page for ${product} with ${theme} aesthetics. Create a complete hero section, feature cards, pricing table, and FAQ accordion.`,
                  },
                },
              ],
            },
          };
        }

        return {
          jsonrpc: "2.0",
          id,
          error: makeError(-32601, `Prompt '${promptName}' not recognized`, "Check prompts/list for valid prompt names"),
        };
      }

      default:
        return {
          jsonrpc: "2.0",
          id,
          error: makeError(-32601, `Method '${method}' not implemented`, "Supported methods: initialize, tools/list, tools/call, resources/list, resources/read, prompts/list, prompts/get"),
        };
    }
  } catch (err: any) {
    return {
      jsonrpc: "2.0",
      id,
      error: makeError(-32603, err?.message || "Internal server error", "Verify request parameters and try again", true),
    };
  }
}

async function executeMcpTool(
  name: string,
  args: Record<string, any>,
  context?: McpRequestContext
): Promise<any> {
  // 1. Mandatory authentication check for all project-scoped tools (P0-D requirement)
  if (PROJECT_SCOPED_TOOLS.has(name)) {
    if (!context?.userId) {
      const reason =
        context?.authError ||
        "Authentication required: Missing or invalid Authorization credentials.";
      return makeError(
        -32001,
        `Unauthorized: ${reason}`,
        "Provide a valid Bearer token in the Authorization header or X-Auth-Mode: demo.",
        false,
        401
      );
    }
  }

  // 2. Project-scoped tools execution
  switch (name) {
    case "list_projects": {
      const isDemo = context?.authMode === 'demo' || context?.userId === 'demo-user';
      const ownerId = isDemo ? 'demo-user' : context!.userId!;
      const projects = listServerProjectsForOwner(ownerId).map((p) => ({
        id: p.id,
        name: p.name,
        framework: p.framework,
        fileCount: Object.keys(p.files).length,
        updatedAt: p.updatedAt,
      }));
      return { projects };
    }

    case "create_project": {
      const id = "proj_" + Math.random().toString(36).substring(2, 9);
      const framework = args.framework || "nextjs";
      const ownerId = context!.userId!;
      const newProj: AuthoritativeProject = {
        id,
        owner_id: ownerId,
        name: args.name || "New Project",
        framework: framework as any,
        files: {
          "package.json": JSON.stringify(
            {
              name: args.name?.toLowerCase().replace(/[^a-z0-9]/g, "-") || "new-project",
              framework,
            },
            null,
            2
          ),
        },
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      registerServerProject(newProj);
      return { success: true, project: newProj };
    }

    case "get_project": {
      const check = await verifyProjectOwnership(args.projectId, context!.userId!, context?.authMode);
      if (!check.authorized) {
        return makeError(
          check.status === 400 ? -32602 : check.status === 404 ? -32601 : -32003,
          check.error || "Access denied",
          undefined,
          false,
          check.status
        );
      }
      const proj = check.project!;
      return {
        id: proj.id,
        name: proj.name,
        framework: proj.framework,
        files: proj.files,
        fileCount: Object.keys(proj.files).length,
      };
    }

    case "list_files": {
      const check = await verifyProjectOwnership(args.projectId, context!.userId!, context?.authMode);
      if (!check.authorized) {
        return makeError(
          check.status === 400 ? -32602 : check.status === 404 ? -32601 : -32003,
          check.error || "Access denied",
          undefined,
          false,
          check.status
        );
      }
      return { files: Object.keys(check.project!.files) };
    }

    case "get_file": {
      const check = await verifyProjectOwnership(args.projectId, context!.userId!, context?.authMode);
      if (!check.authorized) {
        return makeError(
          check.status === 400 ? -32602 : check.status === 404 ? -32601 : -32003,
          check.error || "Access denied",
          undefined,
          false,
          check.status
        );
      }
      const proj = check.project!;
      const path = String(args.path || "").replace(/^\/+/, "");
      if (!path) {
        return makeError(-32602, "Validation Error: 'path' parameter is required.", undefined, false, 400);
      }
      if (!proj.files[path]) {
        return makeError(
          -32602,
          `File '${path}' does not exist in project '${proj.id}'. Call list_files to see available paths.`,
          undefined,
          false,
          404
        );
      }
      return { path, content: proj.files[path] };
    }

    case "write_file": {
      const check = await verifyProjectOwnership(args.projectId, context!.userId!, context?.authMode);
      if (!check.authorized) {
        return makeError(
          check.status === 400 ? -32602 : check.status === 404 ? -32601 : -32003,
          check.error || "Access denied",
          undefined,
          false,
          check.status
        );
      }
      const path = String(args.path || "").replace(/^\/+/, "");
      if (!path) {
        return makeError(-32602, "Validation Error: 'path' parameter is required.", undefined, false, 400);
      }
      const content = String(args.content ?? "");
      // SECURITY: MCP tools stage changes ONLY. Direct mutation of the authoritative
      // project store without candidate validation and compilation evidence is strictly forbidden.
      return {
        success: true,
        path,
        lines: content.split("\n").length,
        staged: true,
        candidateDiff: { [path]: content },
        note: "Change staged in MCP session. Must pass candidate validation and virtual compilation before authoritative commit.",
      };
    }

    case "edit_file": {
      const check = await verifyProjectOwnership(args.projectId, context!.userId!, context?.authMode);
      if (!check.authorized) {
        return makeError(
          check.status === 400 ? -32602 : check.status === 404 ? -32601 : -32003,
          check.error || "Access denied",
          undefined,
          false,
          check.status
        );
      }
      const proj = check.project!;
      const path = String(args.path || "").replace(/^\/+/, "");
      if (!path) {
        return makeError(-32602, "Validation Error: 'path' parameter is required.", undefined, false, 400);
      }
      if (!proj.files[path]) {
        return makeError(
          -32602,
          `Cannot edit '${path}' because it does not exist. Call write_file to create it.`,
          undefined,
          false,
          404
        );
      }
      const existing = proj.files[path];
      const target = String(args.targetContent ?? "");
      const replacement = String(args.replacementContent ?? "");
      if (!existing.includes(target)) {
        return makeError(
          -32602,
          `targetContent not found in ${path}. Verify exact lines before calling edit_file.`,
          undefined,
          false,
          400
        );
      }
      const newContent = existing.replace(target, replacement);
      // SECURITY: staged candidate change only
      return {
        success: true,
        path,
        action: "updated",
        staged: true,
        candidateDiff: { [path]: newContent },
        note: "Change staged in MCP session. Must pass candidate validation and virtual compilation before authoritative commit.",
      };
    }

    case "delete_file": {
      const check = await verifyProjectOwnership(args.projectId, context!.userId!, context?.authMode);
      if (!check.authorized) {
        return makeError(
          check.status === 400 ? -32602 : check.status === 404 ? -32601 : -32003,
          check.error || "Access denied",
          undefined,
          false,
          check.status
        );
      }
      const proj = check.project!;
      const path = String(args.path || "").replace(/^\/+/, "");
      if (!path) {
        return makeError(-32602, "Validation Error: 'path' parameter is required.", undefined, false, 400);
      }
      if (!args.confirm) {
        return makeError(
          -32602,
          "Validation Error: 'confirm: true' is required to stage file deletion.",
          undefined,
          false,
          400
        );
      }
      if (!proj.files[path]) {
        return makeError(-32602, `File '${path}' does not exist in project '${proj.id}'.`, undefined, false, 404);
      }
      // SECURITY: staged deletion candidate only
      return {
        success: true,
        path,
        action: "deleted",
        staged: true,
        candidateDiff: { [path]: null },
        note: "File deletion staged in MCP session. Must pass candidate validation before authoritative commit.",
      };
    }

    case "audit_code": {
      const check = await verifyProjectOwnership(args.projectId, context!.userId!, context?.authMode);
      if (!check.authorized) {
        return makeError(
          check.status === 400 ? -32602 : check.status === 404 ? -32601 : -32003,
          check.error || "Access denied",
          undefined,
          false,
          check.status
        );
      }
      const report = runCodeScan(check.project!.files);
      return { auditReport: report };
    }

    case "list_templates": {
      return { templates: SUGGESTED_PROMPTS };
    }

    default:
      return makeError(-32601, `Tool '${name}' not implemented.`, undefined, false, 404);
  }
}
