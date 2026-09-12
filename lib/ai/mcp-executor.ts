/**
 * MCP (Model Context Protocol) Tool Call Parser & Executor
 * Parses <TOOL_CALL> blocks from the AI stream and executes file operations on the workspace.
 */

import { runCodeScan } from "@/lib/export/code-scanner";

export interface ToolCall {
  id: string;
  name: "write_file" | "edit_file" | "delete_file" | "list_files" | string;
  args: Record<string, any>;
}

export interface ToolExecutionResult {
  updatedFiles: Record<string, string>;
  logs: string[];
  executedTools: {
    tool: string;
    path: string;
    action: "created" | "updated" | "deleted" | "failed";
    details?: string;
  }[];
  explanation: string;
}

/**
 * Parses all completed <TOOL_CALL> JSON blocks from the model response
 */
export function parseToolCalls(text: string): { toolCalls: ToolCall[]; explanation: string } {
  const toolCalls: ToolCall[] = [];
  const regex = /<TOOL_CALL>\s*([\s\S]*?)\s*<\/TOOL_CALL>/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const rawJson = match[1].trim();
    try {
      const parsed = JSON.parse(rawJson);
      if (parsed.name && typeof parsed.args === "object") {
        toolCalls.push({
          id: Math.random().toString(36).substring(2, 9),
          name: parsed.name,
          args: parsed.args || {},
        });
      }
    } catch (err) {
      // Attempt relaxed JSON parse (handling unescaped newlines)
      try {
        const sanitized = rawJson
          .replace(/\r\n/g, "\\n")
          .replace(/(?<!\\)\n/g, "\\n")
          .replace(/(?<!\\)\t/g, "\\t");
        const parsed = JSON.parse(sanitized);
        if (parsed.name && typeof parsed.args === "object") {
          toolCalls.push({
            id: Math.random().toString(36).substring(2, 9),
            name: parsed.name,
            args: parsed.args || {},
          });
        }
      } catch (e2) {
        console.warn("[MCP Executor] Failed to parse tool call JSON:", rawJson.slice(0, 100));
      }
    }
  }

  // Extract explanation: everything after the last </TOOL_CALL> or before first <TOOL_CALL>
  const cleaned = text.replace(/<TOOL_CALL>[\s\S]*?<\/TOOL_CALL>/g, "").trim();
  // Filter out leftover <FILES> or markdown fences if any
  const explanation = cleaned
    .replace(/<FILES>[\s\S]*?<\/FILES>/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .trim();

  return { toolCalls, explanation };
}

/**
 * Execute tool calls against the current workspace file tree
 */
export function executeToolCalls(
  currentFiles: Record<string, string>,
  toolCalls: ToolCall[]
): ToolExecutionResult {
  const updatedFiles = { ...currentFiles };
  const logs: string[] = [];
  const executedTools: ToolExecutionResult["executedTools"] = [];

  for (const call of toolCalls) {
    const { name, args } = call;

    if (name === "write_file") {
      const rawPath = String(args.path || "").replace(/^\/+/, "");
      const content = String(args.content ?? "");
      if (rawPath) {
        const exists = Boolean(updatedFiles[rawPath]);
        updatedFiles[rawPath] = content;
        executedTools.push({
          tool: "write_file",
          path: rawPath,
          action: exists ? "updated" : "created",
          details: `${content.split("\n").length} lines`,
        });
        logs.push(`[MCP] write_file: ${rawPath} (${exists ? "updated" : "created"})`);
      }
    } else if (name === "edit_file") {
      const rawPath = String(args.path || "").replace(/^\/+/, "");
      const target = String(args.targetContent ?? "");
      const replacement = String(args.replacementContent ?? "");

      if (rawPath && updatedFiles[rawPath]) {
        const existingContent = updatedFiles[rawPath];
        if (existingContent.includes(target)) {
          updatedFiles[rawPath] = existingContent.replace(target, replacement);
          executedTools.push({
            tool: "edit_file",
            path: rawPath,
            action: "updated",
            details: "Surgical replacement applied",
          });
          logs.push(`[MCP] edit_file: surgical update applied to ${rawPath}`);
        } else {
          // Fuzzy fallback: try line-trimmed match
          const targetTrimmed = target.trim();
          if (targetTrimmed && existingContent.includes(targetTrimmed)) {
            updatedFiles[rawPath] = existingContent.replace(targetTrimmed, replacement.trim());
            executedTools.push({
              tool: "edit_file",
              path: rawPath,
              action: "updated",
              details: "Trimmed surgical replacement applied",
            });
            logs.push(`[MCP] edit_file: trimmed update applied to ${rawPath}`);
          } else {
            executedTools.push({
              tool: "edit_file",
              path: rawPath,
              action: "failed",
              details: "Target content snippet not found in file",
            });
            logs.push(`[MCP] edit_file warning: target snippet not found in ${rawPath}`);
          }
        }
      } else {
        logs.push(`[MCP] edit_file error: file ${rawPath} does not exist`);
      }
    } else if (name === "delete_file") {
      const rawPath = String(args.path || "").replace(/^\/+/, "");
      if (rawPath && updatedFiles[rawPath] !== undefined) {
        delete updatedFiles[rawPath];
        executedTools.push({
          tool: "delete_file",
          path: rawPath,
          action: "deleted",
        });
        logs.push(`[MCP] delete_file: removed ${rawPath}`);
      }
    } else if (name === "audit_code") {
      const report = runCodeScan(updatedFiles);
      executedTools.push({
        tool: "audit_code",
        path: "workspace",
        action: "created",
        details: `Security score: ${report.score}/100 with ${report.issues.length} findings`,
      });
      logs.push(`[MCP] audit_code completed: safety score ${report.score}/100, ${report.issues.length} issues`);
    }
  }

  return {
    updatedFiles,
    logs,
    executedTools,
    explanation: "",
  };
}
