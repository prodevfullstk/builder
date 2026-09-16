/**
 * Execution Coordinator
 * Orchestrates multiple LLM calls for complex multi-step tasks
 * 
 * Responsibilities:
 * 1. Execute subtasks from ExecutionPlan in correct order
 * 2. Handle parallel execution where possible
 * 3. Manage state and context between subtasks
 * 4. Aggregate results and handle errors
 * 5. Stream progress events to client
 */

import { ExecutionPlan, ExecutionSubtask } from './task-planner';
import { createGeminiStream } from './gemini-stream';
import { getSystemPrompt } from './prompt-templates';
import { parseToolCalls, executeToolCalls, ToolExecutionResult } from './mcp-executor';

export interface SubtaskResult {
  subtaskId: string;
  success: boolean;
  files: Record<string, string>;
  errors: string[];
  logs: string[];
  durationMs: number;
}

export interface CoordinatorEvent {
  type: 'plan_start' | 'group_start' | 'subtask_start' | 'subtask_complete' | 'subtask_error' | 'execution_complete';
  timestamp: string;
  data: any;
}

/**
 * Main coordinator function - executes an execution plan
 */
export async function* coordinateExecution(
  plan: ExecutionPlan,
  baseFiles: Record<string, string>,
  framework: string,
  dbProvider: string = 'none',
  authProvider: string = 'none'
): AsyncGenerator<CoordinatorEvent> {
  let currentFiles = { ...baseFiles };
  const results: SubtaskResult[] = [];
  const startTime = Date.now();
  
  yield {
    type: 'plan_start',
    timestamp: new Date().toISOString(),
    data: {
      planId: plan.id,
      totalSubtasks: plan.subtasks.length,
      parallelGroups: plan.parallelGroups.length,
      estimatedDuration: plan.estimatedDuration,
    },
  };
  
  // Execute parallel groups sequentially
  for (let groupIndex = 0; groupIndex < plan.parallelGroups.length; groupIndex++) {
    const group = plan.parallelGroups[groupIndex];
    const groupTasks = group.map(id => plan.subtasks.find(t => t.id === id)!).filter(Boolean);
    
    if (groupTasks.length === 0) continue;
    
    yield {
      type: 'group_start',
      timestamp: new Date().toISOString(),
      data: {
        groupIndex,
        taskCount: groupTasks.length,
        taskIds: groupTasks.map(t => t.id),
      },
    };
    
    // Execute group tasks in parallel (for now, sequential with potential for parallel later)
    const groupResults = await Promise.all(
      groupTasks.map(task => 
        executeSubtask(task, currentFiles, framework, dbProvider, authProvider)
      )
    );
    
    // Process results
    for (let i = 0; i < groupTasks.length; i++) {
      const task = groupTasks[i];
      const result = groupResults[i];
      
      results.push(result);
      
      if (result.success) {
        // Merge successful results into current workspace
        currentFiles = { ...currentFiles, ...result.files };
        
        yield {
          type: 'subtask_complete',
          timestamp: new Date().toISOString(),
          data: {
            subtaskId: result.subtaskId,
            success: true,
            files: result.files,
            filesModified: Object.keys(result.files).length,
            durationMs: result.durationMs,
          },
        };
      } else {
        // Handle error
        yield {
          type: 'subtask_error',
          timestamp: new Date().toISOString(),
          data: {
            subtaskId: result.subtaskId,
            errors: result.errors,
            logs: result.logs,
          },
        };
        
        // For now, continue execution even if subtask fails
        // In future, could implement retry logic or halt execution
      }
    }
  }
  
  const totalDuration = Date.now() - startTime;
  
  yield {
    type: 'execution_complete',
    timestamp: new Date().toISOString(),
    data: {
      finalFiles: currentFiles,
      results,
      success: results.every(r => r.success),
      totalDurationMs: totalDuration,
      successRate: results.filter(r => r.success).length / results.length,
    },
  };
}

/**
 * Execute a single subtask by calling the LLM with appropriate context
 */
async function executeSubtask(
  task: ExecutionSubtask,
  contextFiles: Record<string, string>,
  framework: string,
  dbProvider: string,
  authProvider: string
): Promise<SubtaskResult> {
  const startTime = Date.now();
  const logs: string[] = [];
  const errors: string[] = [];
  
  logs.push(`[Coordinator] Starting subtask: ${task.id} - ${task.description}`);
  
  try {
    // Build prompt for this specific subtask
    const prompt = buildSubtaskPrompt(task, contextFiles);
    
    // Get system prompt with task-specific skills
    const systemPrompt = getSystemPrompt(
      framework,
      dbProvider,
      authProvider,
      task.type === 'edit' ? 'edit' : 'build',
      task.skillsRequired
    );
    
    // Call LLM
    logs.push(`[Coordinator] Calling LLM for ${task.id}...`);
    const stream = await createGeminiStream({
      prompt,
      framework,
      history: [{ role: 'system', content: systemPrompt }],
    });
    
    // Collect full response
    const fullResponse = await streamToString(stream);
    logs.push(`[Coordinator] LLM response received (${fullResponse.length} chars)`);
    
    // ⚠️ CRITICAL FIX: Try multiple parsing strategies
    let extractedFiles: Record<string, string> = {};
    
    // Strategy 1: Parse MCP tool calls
    const { toolCalls, explanation } = parseToolCalls(fullResponse);
    logs.push(`[Coordinator] Parsed ${toolCalls.length} tool calls`);
    
    if (toolCalls.length > 0) {
      const execution = executeToolCalls(contextFiles, toolCalls);
      logs.push(...execution.logs);
      
      // Check for failures
      const failedTools = execution.executedTools.filter(t => t.action === 'failed');
      if (failedTools.length > 0) {
        errors.push(...failedTools.map(t => `${t.tool} failed for ${t.path}: ${t.details}`));
      }
      
      // Get only the NEW/MODIFIED files (delta from context)
      for (const [path, content] of Object.entries(execution.updatedFiles)) {
        if (contextFiles[path] !== content) {
          extractedFiles[path] = content;
        }
      }
      
      logs.push(`[Coordinator] MCP tool calls extracted ${Object.keys(extractedFiles).length} files`);
    }
    
    // Strategy 2: Extract from markdown code blocks (if no tool calls or to supplement)
    if (Object.keys(extractedFiles).length === 0) {
      logs.push(`[Coordinator] No tool calls found, trying markdown extraction...`);
      const filesFromMarkdown = extractFilesFromMarkdown(fullResponse);
      if (Object.keys(filesFromMarkdown).length > 0) {
        extractedFiles = { ...extractedFiles, ...filesFromMarkdown };
        logs.push(`[Coordinator] Markdown extraction found ${Object.keys(filesFromMarkdown).length} files`);
      }
    }
    
    // Strategy 3: Extract from <FILE> tags (legacy format)
    if (Object.keys(extractedFiles).length === 0) {
      logs.push(`[Coordinator] Trying <FILE> tag extraction...`);
      const filesFromTags = extractFilesFromXMLTags(fullResponse);
      if (Object.keys(filesFromTags).length > 0) {
        extractedFiles = { ...extractedFiles, ...filesFromTags };
        logs.push(`[Coordinator] <FILE> tag extraction found ${Object.keys(filesFromTags).length} files`);
      }
    }
    
    // If still no files, consider it a failure for generate/edit tasks
    if (Object.keys(extractedFiles).length === 0) {
      if (task.type === 'generate' || task.type === 'edit') {
        errors.push(`No files generated for ${task.id}. LLM response:\n${fullResponse.slice(0, 500)}...`);
        logs.push(`[Coordinator] ✕ FAILED: No files extracted from LLM response`);
        return {
          subtaskId: task.id,
          success: false,
          files: {},
          errors,
          logs,
          durationMs: Date.now() - startTime,
        };
      } else {
        // For validate/inspect tasks, no files is OK
        logs.push(`[Coordinator] ✓ Validation/inspection task completed (no files expected)`);
        return {
          subtaskId: task.id,
          success: true,
          files: {},
          errors: [],
          logs,
          durationMs: Date.now() - startTime,
        };
      }
    }
    
    logs.push(`[Coordinator] ✓ Subtask ${task.id} completed successfully with ${Object.keys(extractedFiles).length} file changes`);
    
    return {
      subtaskId: task.id,
      success: true,
      files: extractedFiles,
      errors: [],
      logs,
      durationMs: Date.now() - startTime,
    };
    
  } catch (error: any) {
    errors.push(`Subtask execution error: ${error?.message || error}`);
    logs.push(`[Coordinator] Error in subtask ${task.id}: ${error?.message || error}`);
    
    return {
      subtaskId: task.id,
      success: false,
      files: {},
      errors,
      logs,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Build a focused prompt for a specific subtask
 */
function buildSubtaskPrompt(
  task: ExecutionSubtask,
  contextFiles: Record<string, string>
): string {
  let prompt = `# Subtask: ${task.description}\n\n`;
  
  // Task type specific instructions
  if (task.type === 'generate') {
    prompt += `**Task Type:** Generate new files\n`;
    prompt += `**Target Files:** ${task.targetFiles.length > 0 ? task.targetFiles.join(', ') : 'Determine based on requirements'}\n\n`;
  } else if (task.type === 'edit') {
    prompt += `**Task Type:** Edit existing files\n`;
    prompt += `**Target Files:** ${task.targetFiles.join(', ')}\n\n`;
  } else if (task.type === 'integrate') {
    prompt += `**Task Type:** Integrate and compose components\n`;
    prompt += `**Target Files:** ${task.targetFiles.join(', ')}\n\n`;
  } else if (task.type === 'validate') {
    prompt += `**Task Type:** Validate and analyze\n`;
  }
  
  // Include relevant context files (dependencies)
  const relevantFiles = findRelevantContext(task, contextFiles);
  if (relevantFiles.length > 0) {
    prompt += `## Existing Context Files:\n\n`;
    for (const path of relevantFiles) {
      const content = contextFiles[path];
      const truncated = content.length > 2000 ? content.slice(0, 2000) + '\n... (truncated)' : content;
      prompt += `### ${path}\n\`\`\`typescript\n${truncated}\n\`\`\`\n\n`;
    }
  }
  
  // Task instructions
  prompt += `## Instructions:\n\n`;
  prompt += `${task.description}\n\n`;
  
  // ⚠️ CRITICAL: Clear file output format instructions
  if (task.type === 'generate' || task.type === 'edit' || task.type === 'integrate') {
    prompt += `## OUTPUT FORMAT (MANDATORY):\n\n`;
    prompt += `You MUST output files using ONE of these formats:\n\n`;
    prompt += `**Option 1 - MCP Tool Calls (Preferred):**\n`;
    prompt += `\`\`\`\n`;
    prompt += `<TOOL_CALL>{"name": "write_file", "args": {"path": "components/Button.tsx", "content": "import React..."}}</TOOL_CALL>\n`;
    prompt += `\`\`\`\n\n`;
    prompt += `**Option 2 - Markdown Code Blocks:**\n`;
    prompt += `\`\`\`typescript filename=components/Button.tsx\n`;
    prompt += `import React from 'react';\n`;
    prompt += `export function Button() { ... }\n`;
    prompt += `\`\`\`\n\n`;
    prompt += `**Option 3 - FILE Tags:**\n`;
    prompt += `\`\`\`\n`;
    prompt += `<FILE path="components/Button.tsx">\n`;
    prompt += `import React from 'react';\n`;
    prompt += `export function Button() { ... }\n`;
    prompt += `</FILE>\n`;
    prompt += `\`\`\`\n\n`;
    prompt += `⚠️ **IMPORTANT:** Do NOT just explain what to do - actually OUTPUT the complete file content!\n\n`;
  }
  
  // Priority context
  if (task.priority === 1) {
    prompt += `**PRIORITY:** This is a critical subtask that other tasks depend on. Ensure correctness and completeness.\n\n`;
  }
  
  return prompt;
}

/**
 * Find relevant context files for a subtask
 */
function findRelevantContext(
  task: ExecutionSubtask,
  contextFiles: Record<string, string>
): string[] {
  const relevant: string[] = [];
  
  // Include files mentioned in dependencies
  for (const depId of task.dependencies) {
    // Find files from dependency tasks (heuristic: look for common patterns)
    for (const path of Object.keys(contextFiles)) {
      if (depId.includes('types') && path.includes('types')) {
        if (!relevant.includes(path)) relevant.push(path);
      }
      if (depId.includes('data') && path.includes('data')) {
        if (!relevant.includes(path)) relevant.push(path);
      }
      if (depId.includes('utils') && path.includes('utils')) {
        if (!relevant.includes(path)) relevant.push(path);
      }
    }
  }
  
  // Include target files if they exist (for edit tasks)
  if (task.type === 'edit') {
    for (const targetFile of task.targetFiles) {
      if (contextFiles[targetFile] && !relevant.includes(targetFile)) {
        relevant.push(targetFile);
      }
    }
  }
  
  // Include key dependency files
  if (contextFiles['types/index.ts'] && !relevant.includes('types/index.ts')) {
    relevant.push('types/index.ts');
  }
  if (contextFiles['lib/utils.ts'] && !relevant.includes('lib/utils.ts')) {
    relevant.push('lib/utils.ts');
  }
  
  // Limit context to prevent token overflow
  return relevant.slice(0, 5);
}

/**
 * Convert a ReadableStream to string
 */
async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let result = '';
  const reader = stream.getReader();
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += decoder.decode(value, { stream: true });
    }
    // Final flush
    result += decoder.decode();
    return result;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Extract files from markdown code blocks (fallback when no tool calls)
 */
function extractFilesFromMarkdown(response: string): Record<string, string> {
  const files: Record<string, string> = {};
  
  // Pattern 1: ```typescript filename=path/to/file.tsx
  // Pattern 2: ```typescript path/to/file.tsx
  // Pattern 3: ```tsx\n// path/to/file.tsx\n
  const codeBlockRegex = /```(?:typescript|tsx|ts|javascript|jsx|js|css|html|json)?\s*(?:filename=|filepath:|path=)?\s*([^\s\n]+)?\s*\n([\s\S]*?)```/g;
  
  let match: RegExpExecArray | null;
  while ((match = codeBlockRegex.exec(response)) !== null) {
    let filename = match[1]?.trim();
    let content = match[2]?.trim();
    
    // If no filename in the header, try to extract from first comment line
    if (!filename || filename.length < 2) {
      const firstLine = content.split('\n')[0];
      const commentMatch = firstLine.match(/^\/\/\s*([^\s]+\.(?:tsx?|jsx?|css|html|json))/);
      if (commentMatch) {
        filename = commentMatch[1];
        // Remove the comment line from content
        content = content.split('\n').slice(1).join('\n').trim();
      }
    }
    
    if (filename && content && filename.length > 2) {
      // Clean up filename
      filename = filename.replace(/^["']|["']$/g, '').replace(/^\/+/, '');
      files[filename] = content;
    }
  }
  
  return files;
}

/**
 * Extract files from <FILE> XML-style tags
 */
function extractFilesFromXMLTags(response: string): Record<string, string> {
  const files: Record<string, string> = {};
  
  // Pattern: <FILE path="...">content</FILE>
  const fileTagRegex = /<FILE\s+path=["']([^"']+)["']>([\s\S]*?)<\/FILE>/g;
  
  let match: RegExpExecArray | null;
  while ((match = fileTagRegex.exec(response)) !== null) {
    const path = match[1].trim().replace(/^\/+/, '');
    const content = match[2].trim();
    
    if (path && content) {
      files[path] = content;
    }
  }
  
  return files;
}

/**
 * Utility: Estimate if orchestration will be beneficial
 */
export function shouldUseOrchestration(
  subtaskCount: number,
  estimatedComplexity: 'simple' | 'medium' | 'high' | 'very_high'
): boolean {
  // Use orchestration for:
  // - 3+ subtasks
  // - High complexity even with fewer subtasks
  if (subtaskCount >= 3) return true;
  if (estimatedComplexity === 'high' || estimatedComplexity === 'very_high') return true;
  
  return false;
}
