import { ImageReference } from '../vision/image-hardening';
import { VisualSpec } from '../vision/visual-spec';

export interface ProviderCapability {
  provider: 'gemini' | 'groq' | 'anthropic';
  model: string;
  supportsVision: boolean;
  supportsStreaming: boolean;
  maxContextTokens: number;
}

export interface ProviderSelection {
  provider: 'gemini' | 'groq' | 'anthropic';
  model: string;
  visionEnabled: boolean;
  visionDegraded: boolean;
  fallbackOccurred: boolean;
  fallbackReason?: string;
  visualSpecPreserved: boolean;
}

export const PROVIDER_CAPABILITIES: Record<string, ProviderCapability> = {
  'gemini-3.6-flash': {
    provider: 'gemini',
    model: 'gemini-3.6-flash',
    supportsVision: true,
    supportsStreaming: true,
    maxContextTokens: 1_000_000,
  },
  'gemini-flash-latest': {
    provider: 'gemini',
    model: 'gemini-flash-latest',
    supportsVision: true,
    supportsStreaming: true,
    maxContextTokens: 1_000_000,
  },
  'groq-gpt-oss-120b': {
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    supportsVision: false,
    supportsStreaming: true,
    maxContextTokens: 128_000,
  },
  'groq-qwen3.8-27b': {
    provider: 'groq',
    model: 'qwen/qwen3.8-27b',
    supportsVision: true,
    supportsStreaming: true,
    maxContextTokens: 128_000,
  },
};

/**
 * Selects an LLM provider and model while preserving semantic requirements.
 * Enforces that vision requests NEVER silently downgrade to text-only.
 * If fallback occurs, preserves VisualSpec and records provider metadata for evidence binding.
 */
export function resolveProvider(params: {
  preferredProvider?: 'gemini' | 'groq';
  hasImage: boolean;
  imageReference?: ImageReference;
  existingVisualSpec?: VisualSpec;
  geminiAvailable?: boolean;
  groqAvailable?: boolean;
}): ProviderSelection {
  const {
    preferredProvider = 'gemini',
    hasImage,
    imageReference,
    existingVisualSpec,
    geminiAvailable = Boolean(process.env.GEMINI_API_KEY),
    groqAvailable = Boolean(process.env.GROQ_API_KEY),
  } = params;

  // Case 1: Vision request with Gemini available
  if (hasImage && geminiAvailable) {
    return {
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      visionEnabled: true,
      visionDegraded: false,
      fallbackOccurred: false,
      visualSpecPreserved: Boolean(existingVisualSpec),
    };
  }

  // Case 2: Vision request with Gemini unavailable but Groq available
  if (hasImage && !geminiAvailable && groqAvailable) {
    // Check if Groq vision model is supported or if we must preserve VisualSpec
    return {
      provider: 'groq',
      model: 'qwen/qwen3.8-27b',
      visionEnabled: true,
      visionDegraded: false,
      fallbackOccurred: true,
      fallbackReason: 'Gemini unavailable; routed to Groq vision model',
      visualSpecPreserved: Boolean(existingVisualSpec),
    };
  }

  // Case 3: Vision request with NO vision provider available
  if (hasImage && !geminiAvailable && !groqAvailable) {
    return {
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      visionEnabled: false,
      visionDegraded: true,
      fallbackOccurred: true,
      fallbackReason: 'Vision capability lost: zero vision API keys configured',
      visualSpecPreserved: Boolean(existingVisualSpec),
    };
  }

  // Case 4: Text-only request with preferred provider
  if (preferredProvider === 'groq' && groqAvailable) {
    return {
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      visionEnabled: false,
      visionDegraded: false,
      fallbackOccurred: false,
      visualSpecPreserved: false,
    };
  }

  // Default to Gemini or fallback to Groq
  if (geminiAvailable) {
    return {
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      visionEnabled: false,
      visionDegraded: false,
      fallbackOccurred: false,
      visualSpecPreserved: false,
    };
  }

  if (groqAvailable) {
    return {
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      visionEnabled: false,
      visionDegraded: false,
      fallbackOccurred: true,
      fallbackReason: 'Gemini API key missing; routed to Groq fallback',
      visualSpecPreserved: false,
    };
  }

  // No keys configured
  return {
    provider: 'gemini',
    model: 'gemini-3.6-flash',
    visionEnabled: false,
    visionDegraded: false,
    fallbackOccurred: false,
    visualSpecPreserved: false,
  };
}
