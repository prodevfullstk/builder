import { IntentContract } from './intent-contract';
import { AcceptanceEvaluationSummary } from '../validation/acceptance-verifier';
import { VisualVerificationEvidence } from '../vision/visual-verifier';

export type StreamEventType =
  | 'message_start'
  | 'intent'
  | 'plan'
  | 'text_delta'
  | 'tool_call'
  | 'file_start'
  | 'file_delta'
  | 'file_complete'
  | 'validation_start'
  | 'validation_result'
  | 'build_start'
  | 'build_result'
  | 'runtime_start'
  | 'runtime_result'
  | 'visual_result'
  | 'commit'
  | 'error'
  | 'done';

export interface BaseStreamEvent {
  type: StreamEventType;
  sequenceId: number;
  timestamp: string;
}

export interface MessageStartEvent extends BaseStreamEvent {
  type: 'message_start';
  messageId: string;
  role: 'assistant';
}

export interface IntentEvent extends BaseStreamEvent {
  type: 'intent';
  intent: IntentContract;
}

export interface PlanEvent extends BaseStreamEvent {
  type: 'plan';
  steps: string[];
  estimatedFiles: string[];
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

export interface ValidationStartEvent extends BaseStreamEvent {
  type: 'validation_start';
  stage: 'static' | 'native_build' | 'runtime' | 'behavioral' | 'visual';
}

export interface ValidationResultEvent extends BaseStreamEvent {
  type: 'validation_result';
  passed: boolean;
  stage: string;
  summary: AcceptanceEvaluationSummary;
}

export interface BuildStartEvent extends BaseStreamEvent {
  type: 'build_start';
  runner: 'microvm_sandbox' | 'simulated';
}

export interface BuildResultEvent extends BaseStreamEvent {
  type: 'build_result';
  exitCode: number;
  output: string;
  success: boolean;
}

export interface RuntimeStartEvent extends BaseStreamEvent {
  type: 'runtime_start';
  port?: number;
}

export interface RuntimeResultEvent extends BaseStreamEvent {
  type: 'runtime_result';
  statusCode: number;
  healthy: boolean;
  markerFound: boolean;
}

export interface VisualResultEvent extends BaseStreamEvent {
  type: 'visual_result';
  evidence: VisualVerificationEvidence;
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

export interface DoneEvent extends BaseStreamEvent {
  type: 'done';
  totalDurationMs: number;
  committed: boolean;
}

export type StreamEvent =
  | MessageStartEvent
  | IntentEvent
  | PlanEvent
  | TextDeltaEvent
  | ToolCallEvent
  | FileStartEvent
  | FileDeltaEvent
  | FileCompleteEvent
  | ValidationStartEvent
  | ValidationResultEvent
  | BuildStartEvent
  | BuildResultEvent
  | RuntimeStartEvent
  | RuntimeResultEvent
  | VisualResultEvent
  | CommitEvent
  | ErrorEvent
  | DoneEvent;

/**
 * Encodes a StreamEvent into Server-Sent Events (SSE) format or newline-delimited JSON.
 */
export function formatStreamEvent(event: StreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Robust stream parser for decoding event streams across arbitrary chunk boundaries.
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
      let dataStr = '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          dataStr = line.substring(6).trim();
        }
      }

      if (dataStr) {
        try {
          const parsed = JSON.parse(dataStr) as StreamEvent;
          // Filter duplicates or out-of-order duplicates
          if (parsed.sequenceId > this.lastSequenceId || parsed.sequenceId === 0) {
            this.lastSequenceId = parsed.sequenceId;
            events.push(parsed);
          }
        } catch (err) {
          console.warn('[StreamEventDecoder] Discarded malformed SSE event payload:', dataStr.slice(0, 100));
        }
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
