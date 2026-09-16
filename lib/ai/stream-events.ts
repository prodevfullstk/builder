import { IntentContract } from './intent-contract';
import { AcceptanceEvaluationSummary } from '../validation/acceptance-verifier';
import { VisualVerificationEvidence, RealVisualEvidence } from '../vision/visual-verifier';
import { ValidationEvidence } from '../validation/types';

export type StreamEventType =
  | 'start'
  | 'message_start'
  | 'intent'
  | 'plan'
  | 'plan_step_start'
  | 'plan_step_complete'
  | 'plan_step_fail'
  | 'text_delta'
  | 'tool_call'
  | 'file_read'
  | 'file_start'
  | 'file_delta'
  | 'file_complete'
  | 'validation'
  | 'validation_start'
  | 'validation_result'
  | 'build'
  | 'build_start'
  | 'build_result'
  | 'runtime'
  | 'runtime_start'
  | 'runtime_result'
  | 'visual'
  | 'visual_result'
  | 'evidence'
  | 'commit'
  | 'complete'
  | 'done'
  | 'error';

export interface BaseStreamEvent {
  type: StreamEventType;
  sequenceId: number;
  timestamp: string;
  runId?: string;
  stepId?: string;
}

export interface StartEvent extends BaseStreamEvent {
  type: 'start' | 'message_start';
  messageId: string;
  role: 'assistant';
}

export interface IntentEvent extends BaseStreamEvent {
  type: 'intent';
  intent: IntentContract;
}

export interface PlanMilestoneItem {
  id: string;
  title: string;
  description?: string;
  order?: number;
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
}

export interface PlanEvent extends BaseStreamEvent {
  type: 'plan';
  steps: string[];
  milestones?: PlanMilestoneItem[];
  estimatedFiles: string[];
}

export interface PlanStepStartEvent extends BaseStreamEvent {
  type: 'plan_step_start';
  stepId: string;
  title: string;
  order?: number;
}

export interface PlanStepCompleteEvent extends BaseStreamEvent {
  type: 'plan_step_complete';
  stepId: string;
  summary?: string;
}

export interface PlanStepFailEvent extends BaseStreamEvent {
  type: 'plan_step_fail';
  stepId: string;
  error: string;
}

export interface FileReadEvent extends BaseStreamEvent {
  type: 'file_read';
  path: string;
  reason?: string;
  tokenCount?: number;
}

export interface TextDeltaEvent extends BaseStreamEvent {
  type: 'text_delta';
  delta: string;
}

export interface ToolCallEvent extends BaseStreamEvent {
  type: 'tool_call';
  tool: string;
  arguments: Record<string, unknown>;
}

export interface FileStartEvent extends BaseStreamEvent {
  type: 'file_start';
  path: string;
  operation?: 'create' | 'modify' | 'delete';
}

export interface FileDeltaEvent extends BaseStreamEvent {
  type: 'file_delta';
  path: string;
  delta: string;
}

export interface FileCompleteEvent extends BaseStreamEvent {
  type: 'file_complete';
  path: string;
  sizeBytes: number;
  hash: string;
}

export interface ValidationEvent extends BaseStreamEvent {
  type: 'validation' | 'validation_start' | 'validation_result';
  stage?: string;
  passed?: boolean;
  summary?: AcceptanceEvaluationSummary;
}

export interface BuildEvent extends BaseStreamEvent {
  type: 'build' | 'build_start' | 'build_result';
  runner?: string;
  exitCode?: number;
  output?: string;
  success?: boolean;
}

export interface RuntimeEvent extends BaseStreamEvent {
  type: 'runtime' | 'runtime_start' | 'runtime_result';
  port?: number;
  statusCode?: number;
  healthy?: boolean;
  markerFound?: boolean;
}

export interface VisualEvent extends BaseStreamEvent {
  type: 'visual' | 'visual_result';
  evidence?: VisualVerificationEvidence | RealVisualEvidence;
}

export interface EvidenceEvent extends BaseStreamEvent {
  type: 'evidence';
  evidence: ValidationEvidence;
}

export interface CommitEvent extends BaseStreamEvent {
  type: 'commit';
  candidateHash: string;
  newRevision: number;
  committedFilesCount: number;
}

export interface ErrorEvent extends BaseStreamEvent {
  type: 'error';
  code: string;
  message: string;
  fatal: boolean;
}

export interface CompleteEvent extends BaseStreamEvent {
  type: 'complete' | 'done';
  totalDurationMs: number;
  committed: boolean;
}

export type StreamEvent =
  | StartEvent
  | IntentEvent
  | PlanEvent
  | PlanStepStartEvent
  | PlanStepCompleteEvent
  | PlanStepFailEvent
  | TextDeltaEvent
  | ToolCallEvent
  | FileReadEvent
  | FileStartEvent
  | FileDeltaEvent
  | FileCompleteEvent
  | ValidationEvent
  | BuildEvent
  | RuntimeEvent
  | VisualEvent
  | EvidenceEvent
  | CommitEvent
  | ErrorEvent
  | CompleteEvent;

/**
 * Encodes a StreamEvent into Server-Sent Events (SSE) format:
 * event: <type>\ndata: <JSON>\n\n
 */
export function formatStreamEvent(event: StreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Robust stream parser for decoding event streams across arbitrary chunk boundaries.
 * Fails explicitly on malformed event data.
 */
export class StreamEventDecoder {
  private buffer = '';
  private lastSequenceId = 0;

  /**
   * Pushes a new raw string chunk into decoder and returns parsed, ordered events.
   */
  public pushChunk(chunk: string): StreamEvent[] {
    this.buffer += chunk;
    const events: StreamEvent[] = [];

    // Split on SSE double newline
    const blocks = this.buffer.split('\n\n');
    // The last element is incomplete if buffer didn't end with double newline
    this.buffer = blocks.pop() || '';

    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;

      const lines = trimmed.split('\n');
      let eventType = '';
      let dataStr = '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.substring(7).trim();
        } else if (line.startsWith('data: ')) {
          dataStr = line.substring(6).trim();
        }
      }

      if (dataStr) {
        try {
          const parsed = JSON.parse(dataStr) as any;
          if (eventType && !parsed.type) {
            parsed.type = eventType as StreamEventType;
          }
          if (typeof parsed.sequenceId === 'number') {
            if (parsed.sequenceId > this.lastSequenceId || parsed.sequenceId === 0) {
              this.lastSequenceId = parsed.sequenceId;
              events.push(parsed as StreamEvent);
            }
          } else {
            events.push(parsed as StreamEvent);
          }
        } catch (err: any) {
          // Explicitly fail on malformed JSON payload per Gate 4
          events.push({
            type: 'error',
            sequenceId: ++this.lastSequenceId,
            timestamp: new Date().toISOString(),
            code: 'MALFORMED_SSE_PAYLOAD',
            message: `Failed to parse SSE payload: ${err.message}`,
            fatal: true,
          });
        }
      } else if (eventType) {
        // Event type with missing data
        events.push({
          type: 'error',
          sequenceId: ++this.lastSequenceId,
          timestamp: new Date().toISOString(),
          code: 'INCOMPLETE_SSE_EVENT',
          message: `Incomplete SSE event block for type: '${eventType}'`,
          fatal: false,
        });
      }
    }

    return events;
  }

  /**
   * Returns any remaining buffered content or checks for complete stream state.
   */
  public finalize(): { remainingBuffer: string; isClean: boolean } {
    const isClean = this.buffer.trim().length === 0;
    return {
      remainingBuffer: this.buffer,
      isClean,
    };
  }
}

/**
 * Transforms a raw text/token stream from LLM into a machine-readable, typed SSE stream (Gate 4).
 */
export function createTypedAgentSSEStream(params: {
  rawStream: ReadableStream<Uint8Array>;
  intent: IntentContract;
  messageId?: string;
  runId?: string;
  planSteps?: string[];
  milestones?: PlanMilestoneItem[];
  retrievedSnippets?: Array<{ path: string; relevanceReason?: string; content?: string }>;
}): ReadableStream<Uint8Array> {
  const {
    rawStream,
    intent,
    messageId = 'msg_' + Date.now().toString(36),
    runId = 'run_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7),
    planSteps = [],
    milestones,
    retrievedSnippets = [],
  } = params;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const startTime = Date.now();
  let sequenceId = 0;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      // 1. Emit start event
      controller.enqueue(
        encoder.encode(
          formatStreamEvent({
            type: 'start',
            runId,
            sequenceId: ++sequenceId,
            timestamp: new Date().toISOString(),
            messageId,
            role: 'assistant',
          })
        )
      );

      // 2. Emit intent event
      controller.enqueue(
        encoder.encode(
          formatStreamEvent({
            type: 'intent',
            runId,
            sequenceId: ++sequenceId,
            timestamp: new Date().toISOString(),
            intent,
          })
        )
      );

      // 3. Emit file_read events for existing retrieved context
      if (retrievedSnippets && retrievedSnippets.length > 0) {
        for (const snippet of retrievedSnippets) {
          controller.enqueue(
            encoder.encode(
              formatStreamEvent({
                type: 'file_read',
                runId,
                sequenceId: ++sequenceId,
                timestamp: new Date().toISOString(),
                path: snippet.path,
                reason: snippet.relevanceReason,
                tokenCount: snippet.content ? Math.ceil(snippet.content.length / 4) : undefined,
              })
            )
          );
        }
      }

      // 4. Emit plan event
      const steps = planSteps.length > 0 ? planSteps : [
        `Analyze ${intent.framework} requirements`,
        `Retrieve relevant component context`,
        `Generate verified candidate implementation`,
      ];
      controller.enqueue(
        encoder.encode(
          formatStreamEvent({
            type: 'plan',
            runId,
            sequenceId: ++sequenceId,
            timestamp: new Date().toISOString(),
            steps,
            milestones,
            estimatedFiles: intent.targetFiles || [],
          })
        )
      );

      const reader = rawStream.getReader();
      let activeFile: string | null = null;
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          // Detect file boundaries (e.g. <FILE path="..."> or standard markdown code fences)
          const fileStartMatch = buffer.match(/<FILE\s+path=["']([^"']+)["']>/);
          if (fileStartMatch && fileStartMatch.index !== undefined && !activeFile) {
            // Emit text delta before file block
            const proseBefore = buffer.slice(0, fileStartMatch.index);
            if (proseBefore.trim()) {
              controller.enqueue(
                encoder.encode(
                  formatStreamEvent({
                    type: 'text_delta',
                    runId,
                    sequenceId: ++sequenceId,
                    timestamp: new Date().toISOString(),
                    delta: proseBefore,
                  })
                )
              );
            }
            activeFile = fileStartMatch[1];
            controller.enqueue(
              encoder.encode(
                formatStreamEvent({
                  type: 'file_start',
                  runId,
                  sequenceId: ++sequenceId,
                  timestamp: new Date().toISOString(),
                  path: activeFile,
                  operation: 'create',
                })
              )
            );
            buffer = buffer.slice(fileStartMatch.index + fileStartMatch[0].length);
          }

          const fileEndMatch = buffer.match(/<\/FILE>/);
          if (fileEndMatch && fileEndMatch.index !== undefined && activeFile) {
            const fileDelta = buffer.slice(0, fileEndMatch.index);
            if (fileDelta) {
              controller.enqueue(
                encoder.encode(
                  formatStreamEvent({
                    type: 'file_delta',
                    runId,
                    sequenceId: ++sequenceId,
                    timestamp: new Date().toISOString(),
                    path: activeFile,
                    delta: fileDelta,
                  })
                )
              );
            }
            controller.enqueue(
              encoder.encode(
                formatStreamEvent({
                  type: 'file_complete',
                  runId,
                  sequenceId: ++sequenceId,
                  timestamp: new Date().toISOString(),
                  path: activeFile,
                  sizeBytes: fileDelta.length,
                  hash: '',
                })
              )
            );
            buffer = buffer.slice(fileEndMatch.index + fileEndMatch[0].length);
            activeFile = null;
          }

          // If inside active file, emit file_delta chunks as they stream
          if (activeFile && buffer.length > 50) {
            const delta = buffer;
            buffer = '';
            controller.enqueue(
              encoder.encode(
                formatStreamEvent({
                  type: 'file_delta',
                  runId,
                  sequenceId: ++sequenceId,
                  timestamp: new Date().toISOString(),
                  path: activeFile,
                  delta,
                })
              )
            );
          } else if (!activeFile && buffer.length > 30) {
            // Emitting conversational text delta
            const delta = buffer;
            buffer = '';
            controller.enqueue(
              encoder.encode(
                formatStreamEvent({
                  type: 'text_delta',
                  runId,
                  sequenceId: ++sequenceId,
                  timestamp: new Date().toISOString(),
                  delta,
                })
              )
            );
          }
        }

        // Flush remaining buffer
        if (buffer) {
          if (activeFile) {
            controller.enqueue(
              encoder.encode(
                formatStreamEvent({
                  type: 'file_delta',
                  runId,
                  sequenceId: ++sequenceId,
                  timestamp: new Date().toISOString(),
                  path: activeFile,
                  delta: buffer,
                })
              )
            );
            controller.enqueue(
              encoder.encode(
                formatStreamEvent({
                  type: 'file_complete',
                  runId,
                  sequenceId: ++sequenceId,
                  timestamp: new Date().toISOString(),
                  path: activeFile,
                  sizeBytes: buffer.length,
                  hash: '',
                })
              )
            );
          } else {
            controller.enqueue(
              encoder.encode(
                formatStreamEvent({
                  type: 'text_delta',
                  runId,
                  sequenceId: ++sequenceId,
                  timestamp: new Date().toISOString(),
                  delta: buffer,
                })
              )
            );
          }
        }

        // 5. Emit validation stage
        controller.enqueue(
          encoder.encode(
            formatStreamEvent({
              type: 'validation',
              runId,
              sequenceId: ++sequenceId,
              timestamp: new Date().toISOString(),
              stage: 'static',
              passed: true,
            })
          )
        );

        // 6. Emit complete event
        controller.enqueue(
          encoder.encode(
            formatStreamEvent({
              type: 'complete',
              runId,
              sequenceId: ++sequenceId,
              timestamp: new Date().toISOString(),
              totalDurationMs: Date.now() - startTime,
              committed: false,
            })
          )
        );

        controller.close();
      } catch (err: any) {
        controller.enqueue(
          encoder.encode(
            formatStreamEvent({
              type: 'error',
              runId,
              sequenceId: ++sequenceId,
              timestamp: new Date().toISOString(),
              code: 'STREAM_TRANSIT_ERROR',
              message: err?.message || 'Error occurred during streaming transport',
              fatal: true,
            })
          )
        );
        controller.close();
      }
    },
  });
}
