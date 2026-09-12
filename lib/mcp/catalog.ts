import { MCPTool, MCPResource, MCPPrompt } from "./types";
import { SUGGESTED_PROMPTS } from "../ai/prompt-templates";

export const OPENDROK_MCP_TOOLS: MCPTool[] = [
  // ── Project / Site Management ──────────────────────────────
  {
    name: "list_projects",
    description: "List all saved projects in Opendrok workspace with their id, name, framework, and updated timestamps. Always call this first when you need a project ID.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_project",
    description: "Retrieve metadata, framework, and file inventory for a specific project.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Unique project ID from list_projects.",
        },
      },
      required: ["projectId"],
    },
  },
  {
    name: "create_project",
    description: "Create a brand-new project in Opendrok with selected framework (vite, nextjs, astro).",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Display name for the new project.",
        },
        framework: {
          type: "string",
          enum: ["vite", "nextjs", "astro", "node"],
          description: "Frontend or backend framework to initialize.",
        },
      },
      required: ["name"],
    },
  },

  // ── File & Component Editing ───────────────────────────────
  {
    name: "list_files",
    description: "List all relative file paths currently present in the project workspace.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Target project ID.",
        },
      },
      required: ["projectId"],
    },
  },
  {
    name: "get_file",
    description: "Read the complete, exact content of a file before editing it.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative filepath (e.g. 'app/page.tsx', 'components/Navbar.tsx', 'package.json').",
        },
        projectId: {
          type: "string",
          description: "Target project ID.",
        },
      },
      required: ["projectId", "path"],
    },
  },
  {
    name: "write_file",
    description: "Create a new file or completely rewrite an existing file with complete production-ready code.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative filepath to write.",
        },
        content: {
          type: "string",
          description: "The complete, unabridged file content.",
        },
        projectId: {
          type: "string",
          description: "Target project ID.",
        },
      },
      required: ["projectId", "path", "content"],
    },
  },
  {
    name: "edit_file",
    description: "Surgically edit an existing file by matching an exact target substring and replacing it. Best for minor updates.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative filepath to edit.",
        },
        targetContent: {
          type: "string",
          description: "Exact lines/string in the existing file to replace.",
        },
        replacementContent: {
          type: "string",
          description: "New replacement code.",
        },
        projectId: {
          type: "string",
          description: "Target project ID.",
        },
      },
      required: ["projectId", "path", "targetContent", "replacementContent"],
    },
  },
  {
    name: "delete_file",
    description: "Delete an obsolete or unused file from the project workspace.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative filepath to delete.",
        },
        confirm: {
          type: "boolean",
          description: "Confirmation flag; must be true.",
        },
        projectId: {
          type: "string",
          description: "Target project ID.",
        },
      },
      required: ["projectId", "path", "confirm"],
    },
  },

  // ── Code Security & Quality Audit ──────────────────────────
  {
    name: "audit_code",
    description: "Audit project files for security risks (leaked API keys, secrets), structure integrity, and framework entry points.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Target project ID to audit.",
        },
      },
      required: ["projectId"],
    },
  },

  // ── Templates ──────────────────────────────────────────────
  {
    name: "list_templates",
    description: "List all built-in starter templates available in Opendrok.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

export const OPENDROK_MCP_RESOURCES: MCPResource[] = [
  {
    uri: "opendrok://templates/catalog",
    name: "Starter Templates Catalog",
    description: "List of all curated starter templates with recommended prompts and tech stacks.",
    mimeType: "application/json",
  },
  {
    uri: "opendrok://system/capabilities",
    name: "Opendrok System Capabilities",
    description: "Overview of supported frameworks, live sandbox engines, and GitHub integration.",
    mimeType: "application/json",
  },
];

export const OPENDROK_MCP_PROMPTS: MCPPrompt[] = [
  {
    name: "build_landing_page",
    description: "Guides the AI agent step-by-step to design and build a high-converting landing page.",
    arguments: [
      { name: "product", description: "Product or SaaS name and core value proposition", required: true },
      { name: "theme", description: "Visual theme (e.g. 'dark cyberpunk', 'minimalist light')", required: false },
    ],
  },
  {
    name: "audit_project_security",
    description: "Audits all files for leaked secrets, API keys, and missing package dependencies.",
    arguments: [
      { name: "projectId", description: "Project to inspect", required: false },
    ],
  },
];
