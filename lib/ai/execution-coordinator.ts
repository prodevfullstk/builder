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
    
    // Parse tool calls from response
    const { toolCalls, explanation } = parseToolCalls(fullResponse);
    logs.push(`[Coordinator] Parsed ${toolCalls.length} tool calls`);
    
    if (toolCalls.length === 0) {
      // No tool calls - might be explanatory response or need to parse <FILES> blocks
      logs.push(`[Coordinator] Warning: No tool calls found in response for ${task.id}`);
      
      // Try to extract files from markdown code blocks as fallback
      const filesFromMarkdown = extractFilesFromMarkdown(fullResponse);
      if (Object.keys(filesFromMarkdown).length > 0) {
        logs.push(`[Coordinator] Extracted ${Object.keys(filesFromMarkdown).length} files from markdown`);
        return {
          subtaskId: task.id,
          success: true,
          files: filesFromMarkdown,
          errors: [],
          logs,
          durationMs: Date.now() - startTime,
        };
      }
      
      // If still no files, consider it a failure for generate/edit tasks
      if (task.type === 'generate' || task.type === 'edit') {
        errors.push('No files generated or tool calls found in LLM response');
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
    
    // Execute tool calls
    const execution = executeToolCalls(contextFiles, toolCalls);
    logs.push(...execution.logs);
    
    // Check for failures
    const failedTools = execution.executedTools.filter(t => t.action === 'failed');
    if (failedTools.length > 0) {
      errors.push(...failedTools.map(t => `${t.tool} failed for ${t.path}: ${t.details}`));
    }
    
    // Get only the NEW/MODIFIED files (delta from context)
    const deltaFiles: Record<string, string> = {};
    for (const [path, content] of Object.entries(execution.updatedFiles)) {
      if (contextFiles[path] !== content) {
        deltaFiles[path] = content;
      }
    }
    
    logs.push(`[Coordinator] Subtask ${task.id} completed successfully with ${Object.keys(deltaFiles).length} file changes`);
    
    return {
      subtaskId: task.id,
      success: failedTools.length === 0,
      files: deltaFiles,
      errors,
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
  
  // MCP tool usage
  if (task.type === 'generate' || task.type === 'edit') {
    prompt += `**IMPORTANT:** Use MCP tool calls to create/modify files:\n`;
    prompt += `- Use <TOOL_CALL>{"name": "write_file", "args": {"path": "...", "content": "..."}}</TOOL_CALL> to create new files\n`;
    prompt += `- Use <TOOL_CALL>{"name": "edit_file", "args": {"path": "...", "targetContent": "...", "replacementContent": "..."}}</TOOL_CALL> to edit existing files\n\n`;
  }
  
  // Priority context
  if (task.priority === 1) {
    prompt += `**PRIORITY:** This is a critical subtask that other tasks depend on. Ensure correctness.\n\n`;
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
  
  // Pattern: ```typescript filename=path/to/file.tsx
  const codeBlockRegex = /```(?:typescript|tsx|ts|javascript|jsx|js|css)?\s*(?:filename=|filepath:)?\s*([^\s\n]+)\s*\n([\s\S]*?)```/g;
  
  let match: RegExpExecArray | null;
  while ((match = codeBlockRegex.exec(response)) !== null) {
    const filename = match[1].trim();
    const content = match[2].trim();
    
    if (filename && content) {
      files[filename] = content;
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
