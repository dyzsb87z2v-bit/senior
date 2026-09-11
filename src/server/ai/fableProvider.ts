/**
 * OrderUnderstandingProvider backed by Claude Fable 5.1 through the official
 * Anthropic SDK. The request itself is built in domain/fableRequest.ts, which
 * is plain TypeScript and unit-tested.
 *
 * Latency matters more than anything here: Twilio waits at most 15 seconds
 * for the webhook, so the call gets a hard timeout and no retries. When the
 * model is slow or unavailable the composite provider falls back to asking
 * the caller again — it never guesses.
 */
import Anthropic from '@anthropic-ai/sdk';
import { buildFableRequest, mapFableOutput, DEFAULT_FABLE_MODEL } from '../../domain/fableRequest.ts';
import type { OrderUnderstandingProvider, RawUnderstanding, UnderstandInput } from '../../domain/types.ts';

export interface FableProviderOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  effort?: 'low' | 'medium' | 'high';
  log?: (event: string, data: Record<string, unknown>) => void;
}

export class FableUnderstanding implements OrderUnderstandingProvider {
  readonly name = 'fable';
  private client: Anthropic;
  private model: string;
  private effort: 'low' | 'medium' | 'high';
  private log: (event: string, data: Record<string, unknown>) => void;

  constructor(o: FableProviderOptions) {
    this.client = new Anthropic({ apiKey: o.apiKey, timeout: o.timeoutMs ?? 9000, maxRetries: 0 });
    this.model = o.model || DEFAULT_FABLE_MODEL;
    this.effort = o.effort || 'low';
    this.log = o.log || (() => {});
  }

  async understand(input: UnderstandInput): Promise<RawUnderstanding> {
    const params = buildFableRequest(input, this.model, this.effort);
    const started = Date.now();
    const response = await this.client.messages.create(params);
    const ms = Date.now() - started;

    if (response.stop_reason === 'refusal') {
      this.log('fable.refusal', { ms, category: response.stop_details?.category ?? null });
      return { intent: 'unclear', items: [], confidence: 0, source: 'fable' };
    }
    const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { json = null; }
    this.log('fable.response', {
      ms, model: response.model, stop_reason: response.stop_reason,
      input_tokens: response.usage?.input_tokens, output_tokens: response.usage?.output_tokens, cache_read_input_tokens: response.usage?.cache_read_input_tokens,
      parsed: json !== null,
    });
    if (json === null) return { intent: 'unclear', items: [], confidence: 0, source: 'fable' };
    return { ...mapFableOutput(json), source: 'fable' };
  }
}
