/**
 * Main AI Agent Orchestrator
 * Entry point for intelligent task execution
 * 
 * This orchestrator decides:
 * 1. Whether to use direct LLM call or multi-step orchestration
 * 2. How to decompose complex tasks
 * 3. How to coordinate execution
 * 4. How to aggregate and stream results
 * 
 * Think of this as the "brain" that decides HOW to execute a request.
 */

import { IntentContract } from './intent-contract';
import { planExecution, shouldOrchestrate } from './task-planner';
import { coordinateExecution, shouldUseOrchestration, CoordinatorEvent } from './execution-coordinator';
import { createGeminiStream } from './gemini-stream';
import { getSystemPrompt } from './prompt-templates';

export interface OrchestrationOptions {
  intent: IntentContract;
  currentFiles: Record<string, string>;
  framework: string;
  dbProvider?: string;
  authProvider?: string;
  mode?: 'build' | 'chat' | 'edit' | 'auto-fix';
  skills?: string[];
  userPrompt: string;
}

export interface OrchestrationResult {
  strategy: 'direct' | 'orchestrated';
  planId?: string;
  subtaskCount?: number;
}

/**
 * Main orchestration decision function
 */
export function decideOrchestrationStrategy(intent: IntentContract): OrchestrationResult {
  // Check if orchestration is beneficial
  const needsOrchestration = shouldOrchestrate(intent);
  
  if (!needsOrchestration) {
    return {
      strategy: 'direct',
    };
  }
  
  // Generate execution plan
  const plan = planExecution(intent);
  
  // Double-check if orchestration makes sense
  const beneficial = shouldUseOrchestration(
    plan.subtasks.length,
    plan.metadata.complexity
  );
  
  if (!beneficial) {
    return {
      strategy: 'direct',
    };
  }
  
  return {
    strategy: 'orchestrated',
    planId: plan.id,
    subtaskCount: plan.subtasks.length,
  };
}

/**
 * Execute with orchestration (multi-step approach)
 */
export async function* executeOrchestrated(
  options: OrchestrationOptions
): AsyncGenerator<OrchestrationEvent> {
  const { intent, currentFiles, framework, dbProvider = 'none', authProvider = 'none' } = options;
  
  // Generate execution plan
  const plan = planExecution(intent);
  
  yield {
    type: 'orchestration_start',
    timestamp: new Date().toISOString(),
    data: {
      strategy: 'orchestrated',
      plan: {
        id: plan.id,
        subtasks: plan.subtasks.length,
        parallelGroups: plan.parallelGroups.length,
        complexity: plan.metadata.complexity,
        estimatedDuration: plan.estimatedDuration,
      },
    },
  };
  
  yield {
    type: 'plan_generated',
    timestamp: new Date().toISOString(),
    data: {
      plan: {
        id: plan.id,
        subtasks: plan.subtasks.map(t => ({
          id: t.id,
          description: t.description,
          type: t.type,
          targetFiles: t.targetFiles,
          priority: t.priority,
        })),
        parallelGroups: plan.parallelGroups,
      },
    },
  };
  
  // Execute plan with coordinator
  try {
    for await (const event of coordinateExecution(plan, currentFiles, framework, dbProvider, authProvider)) {
      // Transform coordinator events to orchestration events
      yield transformCoordinatorEvent(event);
      
      // If execution complete, yield final results
      if (event.type === 'execution_complete') {
        yield {
          type: 'orchestration_complete',
          timestamp: new Date().toISOString(),
          data: {
            success: event.data.success,
            files: event.data.finalFiles,
            totalDurationMs: event.data.totalDurationMs,
            successRate: event.data.successRate,
          },
        };
      }
    }
  } catch (error: any) {
    yield {
      type: 'orchestration_error',
      timestamp: new Date().toISOString(),
      data: {
        error: error?.message || 'Unknown orchestration error',
        stack: error?.stack,
      },
    };
  }
}

/**
 * Execute with direct LLM call (simple approach)
 */
export async function* executeDirect(
  options: OrchestrationOptions
): AsyncGenerator<OrchestrationEvent> {
  const {
    intent,
    currentFiles,
    framework,
    dbProvider = 'none',
    authProvider = 'none',
    mode = 'build',
    skills,
    userPrompt,
  } = options;
  
  yield {
    type: 'orchestration_start',
    timestamp: new Date().toISOString(),
    data: {
      strategy: 'direct',
      intent: {
        action: intent.action,
        complexity: 'simple',
      },
    },
  };
  
  try {
    // Get system prompt
    const systemPrompt = getSystemPrompt(framework, dbProvider, authProvider, mode, skills);
    
    // Call LLM directly
    const stream = await createGeminiStream({
      prompt: userPrompt,
      framework,
      history: [{ role: 'system', content: systemPrompt }],
    });
    
    // Stream response chunks
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      fullResponse += chunk;
      
      // Yield text chunks
      yield {
        type: 'text_delta',
        timestamp: new Date().toISOString(),
        data: {
          delta: chunk,
        },
      };
    }
    
    yield {
      type: 'orchestration_complete',
      timestamp: new Date().toISOString(),
      data: {
        success: true,
        response: fullResponse,
        strategy: 'direct',
      },
    };
    
  } catch (error: any) {
    yield {
      type: 'orchestration_error',
      timestamp: new Date().toISOString(),
      data: {
        error: error?.message || 'Direct execution error',
        stack: error?.stack,
      },
    };
  }
}

/**
 * Main entry point - orchestrate based on intent
 */
export async function* orchestrateRequest(
  options: OrchestrationOptions
): AsyncGenerator<OrchestrationEvent> {
  const decision = decideOrchestrationStrategy(options.intent);
  
  if (decision.strategy === 'orchestrated') {
    // Use multi-step orchestration
    yield* executeOrchestrated(options);
  } else {
    // Use direct LLM call
    yield* executeDirect(options);
  }
}

/**
 * Transform coordinator events to orchestration events
 */
function transformCoordinatorEvent(event: CoordinatorEvent): OrchestrationEvent {
  switch (event.type) {
    case 'plan_start':
      return {
        type: 'execution_start',
        timestamp: event.timestamp,
        data: event.data,
      };
    
    case 'group_start':
      return {
        type: 'group_start',
        timestamp: event.timestamp,
        data: event.data,
      };
    
    case 'subtask_start':
      return {
        type: 'subtask_start',
        timestamp: event.timestamp,
        data: event.data,
      };
    
    case 'subtask_complete':
      return {
        type: 'subtask_complete',
        timestamp: event.timestamp,
        data: event.data,
      };
    
    case 'subtask_error':
      return {
        type: 'subtask_error',
        timestamp: event.timestamp,
        data: event.data,
      };
    
    case 'execution_complete':
      return {
        type: 'execution_complete',
        timestamp: event.timestamp,
        data: event.data,
      };
    
    default:
      return {
        type: 'info',
        timestamp: event.timestamp,
        data: event.data,
      };
  }
}

/**
 * Orchestration event types
 */
export interface OrchestrationEvent {
  type: 
    | 'orchestration_start'
    | 'plan_generated'
    | 'execution_start'
    | 'group_start'
    | 'subtask_start'
    | 'subtask_complete'
    | 'subtask_error'
    | 'execution_complete'
    | 'orchestration_complete'
    | 'orchestration_error'
    | 'text_delta'
    | 'info';
  timestamp: string;
  data: any;
}

/**
 * Utility: Get orchestration statistics for monitoring
 */
export interface OrchestrationStats {
  totalRequests: number;
  orchestratedRequests: number;
  directRequests: number;
  orchestrationRate: number;
  avgSubtasks: number;
  avgDuration: number;
}

// In-memory stats (would be persisted in production)
let stats: OrchestrationStats = {
  totalRequests: 0,
  orchestratedRequests: 0,
  directRequests: 0,
  orchestrationRate: 0,
  avgSubtasks: 0,
  avgDuration: 0,
};

export function trackOrchestrationUsage(
  strategy: 'direct' | 'orchestrated',
  subtasks: number = 0,
  durationMs: number = 0
) {
  stats.totalRequests++;
  
  if (strategy === 'orchestrated') {
    stats.orchestratedRequests++;
    stats.avgSubtasks = 
      (stats.avgSubtasks * (stats.orchestratedRequests - 1) + subtasks) / stats.orchestratedRequests;
  } else {
    stats.directRequests++;
  }
  
  stats.orchestrationRate = stats.orchestratedRequests / stats.totalRequests;
  stats.avgDuration = (stats.avgDuration * (stats.totalRequests - 1) + durationMs) / stats.totalRequests;
}

export function getOrchestrationStats(): OrchestrationStats {
  return { ...stats };
}
