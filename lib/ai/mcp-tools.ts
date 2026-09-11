/**
 * Model Context Protocol (MCP) Tool Definitions
 * Defines standard tools that the AI builder agent can call to inspect and modify the project.
 */

export interface MCPToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, {
      type: string;
      description: string;
    }>;
    required: string[];
  };
}

export const MCP_TOOLS: MCPToolDefinition[] = [
  {
    name: "write_file",
    description: "Create a new file or completely overwrite an existing file with complete, production-ready code.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative file path (e.g., 'components/Navbar.tsx', 'app/page.tsx', 'lib/utils.ts').",
        },
        content: {
          type: "string",
          description: "The complete file content.",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description: "Surgically edit an existing file by finding exact target content and replacing it with new code. Use this for incremental updates instead of rewriting the whole file.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path of the existing file to modify.",
        },
        targetContent: {
          type: "string",
          description: "The exact substring/lines in the file to be replaced.",
        },
        replacementContent: {
          type: "string",
          description: "The replacement code to put in place of targetContent.",
        },
      },
      required: ["path", "targetContent", "replacementContent"],
    },
  },
  {
    name: "delete_file",
    description: "Delete an existing file that is no longer needed.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path of the file to delete.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "list_files",
    description: "List all files currently in the workspace.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

/**
 * Format MCP tools into prompt instructions for the AI model
 */
export function getMCPToolsPrompt(): string {
  return `
### 🛠️ MCP (MODEL CONTEXT PROTOCOL) TOOLS AVAILABLE:
You can invoke the following tools to manipulate the project workspace:

1. \`write_file(path, content)\`
   - Use to create new files or rewrite full components.
2. \`edit_file(path, targetContent, replacementContent)\`
   - Use for surgical updates to existing files without rewriting everything.
   - \`targetContent\` must match exact existing characters/lines in the file.
3. \`delete_file(path)\`
   - Use to remove obsolete files.

### 📐 TOOL CALL SYNTAX:
To invoke a tool, wrap a valid JSON object in a \`<TOOL_CALL>\` block:

<TOOL_CALL>
{"name": "write_file", "args": {"path": "components/Navbar.tsx", "content": "export function Navbar() { ... }"}}
</TOOL_CALL>

<TOOL_CALL>
{"name": "edit_file", "args": {"path": "app/page.tsx", "targetContent": "<h1 className=\"text-3xl\">Old</h1>", "replacementContent": "<h1 className=\"text-5xl font-bold\">New</h1>"}}
</TOOL_CALL>

<TOOL_CALL>
{"name": "delete_file", "args": {"path": "components/OldBanner.tsx"}}
</TOOL_CALL>

You may call multiple tools in sequence. After calling all needed tools, write a friendly explanation of what you changed.`;
}
