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
} from "../storage/project-authority";

// In-memory project store for MCP sessions
const memoryProjects: Map<string, { id: string; name: string; framework: string; files: Record<string, string>; updatedAt: number; owner_id?: string }> = new Map();

// Seed initial demo project with explicit owner
memoryProjects.set("demo-saas", {
  id: "demo-saas",
  name: "AI Voice Agent SaaS",
  framework: "nextjs",
  owner_id: "system-demo",
  files: {
    "package.json": JSON.stringify({ name: "ai-voice-saas", dependencies: { react: "^19.0.0", next: "^15.0.0" } }, null, 2),
    "app/page.tsx": `'use client';\n\nexport default function Page() { return <div>Welcome to AI Voice SaaS</div>; }`,
  },
  updatedAt: Date.now(),
});

function makeError(code: number, message: string, hint?: string, retryable = false): MCPErrorEnvelope {
  return {
    code,
    message,
    data: {
      hint,
      retryable,
      status: code === -32602 ? 400 : code === -32601 ? 404 : 500,
    },
  };
}

export interface McpRequestContext {
  userId?: string;
  authMode?: 'real' | 'demo';
}

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
            error: makeError(-32602, "Tool name is required in params.name", "Provide 'name' parameter matching one of the tools in tools/list"),
          };
        }

        const result = await executeMcpTool(toolName, args, context);
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

/**
 * Resolve project explicitly by ID without any arbitrary "first project" fallback
 */
function resolveProjectExplicit(projectId: any): { id: string; name: string; framework: string; files: Record<string, string>; updatedAt: number; owner_id?: string } {
  if (!projectId || typeof projectId !== 'string' || !projectId.trim()) {
    throw new Error("Validation Error: 'projectId' parameter is required. Implicit fallback to arbitrary or first project is strictly forbidden.");
  }

  const cleanId = projectId.trim();
  const memoryProj = memoryProjects.get(cleanId);
  if (memoryProj) return memoryProj;

  // Check authoritative project registry
  const authProj = getServerProject(cleanId);
  if (authProj) {
    return {
      id: authProj.id,
      name: authProj.name,
      framework: authProj.framework,
      files: authProj.files,
      updatedAt: authProj.updatedAt,
      owner_id: authProj.owner_id,
    };
  }

  throw new Error(`Project '${cleanId}' not found. Verify the project ID and call list_projects.`);
}

async function executeMcpTool(name: string, args: Record<string, any>, context?: McpRequestContext): Promise<any> {
  switch (name) {
    case "list_projects": {
      const list = Array.from(memoryProjects.values()).map((p) => ({
        id: p.id,
        name: p.name,
        framework: p.framework,
        fileCount: Object.keys(p.files).length,
        updatedAt: p.updatedAt,
      }));
      return { projects: list };
    }

    case "get_project": {
      const proj = resolveProjectExplicit(args.projectId);
      return {
        id: proj.id,
        name: proj.name,
        framework: proj.framework,
        files: proj.files,
        fileCount: Object.keys(proj.files).length,
      };
    }

    case "create_project": {
      const id = "proj_" + Math.random().toString(36).substring(2, 9);
      const framework = args.framework || "nextjs";
      const ownerId = context?.userId || "anonymous";
      const newProj = {
        id,
        name: args.name || "New Project",
        framework,
        owner_id: ownerId,
        files: {
          "package.json": JSON.stringify({ name: args.name?.toLowerCase().replace(/[^a-z0-9]/g, "-"), framework }, null, 2),
        },
        updatedAt: Date.now(),
      };
      memoryProjects.set(id, newProj);
      registerServerProject({
        id,
        owner_id: ownerId,
        name: newProj.name,
        framework: framework as any,
        files: newProj.files,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { success: true, project: newProj };
    }

    case "list_files": {
      const proj = resolveProjectExplicit(args.projectId);
      return { files: Object.keys(proj.files) };
    }

    case "get_file": {
      const proj = resolveProjectExplicit(args.projectId);
      const path = String(args.path || "").replace(/^\/+/, "");
      if (!path) {
        throw new Error("Validation Error: 'path' parameter is required.");
      }
      if (!proj.files[path]) {
        throw new Error(`File '${path}' does not exist in project '${proj.id}'. Call list_files to see available paths.`);
      }
      return { path, content: proj.files[path] };
    }

    case "write_file": {
      const proj = resolveProjectExplicit(args.projectId);
      const path = String(args.path || "").replace(/^\/+/, "");
      if (!path) {
        throw new Error("Validation Error: 'path' parameter is required.");
      }
      // SECURITY: MCP tools stage changes only. The calling client must pass the
      // returned candidateDiff through evaluateCandidateChanges before committing
      // to the authoritative project store. Direct mutation here only affects the
      // MCP session's in-memory copy — not the builder's authoritative Zustand store.
      const previousContent = proj.files[path] ?? null;
      proj.files[path] = String(args.content || "");
      proj.updatedAt = Date.now();
      return {
        success: true,
        path,
        lines: proj.files[path].split("\n").length,
        staged: true,
        note: "Change staged in MCP session. Call evaluate_candidate or pass candidateDiff to the builder for authoritative commit.",
        candidateDiff: { [path]: String(args.content || "") },
      };
    }

    case "edit_file": {
      const proj = resolveProjectExplicit(args.projectId);
      const path = String(args.path || "").replace(/^\/+/, "");
      if (!path) {
        throw new Error("Validation Error: 'path' parameter is required.");
      }
      if (!proj.files[path]) {
        throw new Error(`Cannot edit '${path}' because it does not exist. Call write_file to create it.`);
      }
      const existing = proj.files[path];
      const target = String(args.targetContent || "");
      const replacement = String(args.replacementContent || "");
      if (!existing.includes(target)) {
        throw new Error(`targetContent not found in ${path}. Verify exact lines before calling edit_file.`);
      }
      // SECURITY: staged change only — same semantics as write_file
      proj.files[path] = existing.replace(target, replacement);
      proj.updatedAt = Date.now();
      return {
        success: true,
        path,
        action: "updated",
        staged: true,
        note: "Change staged in MCP session. Pass candidateDiff to the builder for authoritative commit.",
        candidateDiff: { [path]: proj.files[path] },
      };
    }

    case "delete_file": {
      const proj = resolveProjectExplicit(args.projectId);
      const path = String(args.path || "").replace(/^\/+/, "");
      if (!path) {
        throw new Error("Validation Error: 'path' parameter is required.");
      }
      // SECURITY: staged deletion — builder must confirm via candidate pipeline
      delete proj.files[path];
      proj.updatedAt = Date.now();
      return {
        success: true,
        path,
        action: "deleted",
        staged: true,
        note: "File removed from MCP session copy. Pass updated project files to the builder for authoritative commit.",
      };
    }

    case "audit_code": {
      const proj = resolveProjectExplicit(args.projectId);
      const report = runCodeScan(proj.files);
      return { auditReport: report };
    }

    case "list_templates": {
      return { templates: SUGGESTED_PROMPTS };
    }

    default:
      throw new Error(`Tool '${name}' not implemented.`);
  }
}
