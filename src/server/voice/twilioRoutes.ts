import type { FastifyInstance } from 'fastify';
import { initialState, runTurn } from '../../domain/dialog.ts';
import { renderTwiml, toTurnInput, validateTwilioSignature, type TwilioVoiceOptions, type TwilioWebhookBody } from '../../domain/twilio.ts';
import { todayInBerlin } from '../../domain/dates.ts';
import { P } from '../../domain/prompts.ts';
import type { TurnResult } from '../../domain/types.ts';
import { closeCall, createAlert, findCallBySid, persistTurn, stateFromRow } from '../services/calls.ts';
import { applyEffects, buildDialogContext, handoffNumber, hintsFor, type VoiceDeps } from './context.ts';

/**
 * Twilio Programmable Voice webhooks.
 *
 *   POST /api/voice/twilio          — "A call comes in" and every Gather result
 *   POST /api/voice/twilio/status   — call status callback (completed, …)
 *
 * Both verify X-Twilio-Signature with TWILIO_AUTH_TOKEN before reading
 * anything. Point the Twilio number at PUBLIC_URL + these paths.
 */
export function voiceUrls(publicUrl: string, config: { LUNCH_PUBLIC_VOICE_URL: string; LUNCH_PUBLIC_STATUS_URL: string }) {
  return {
    voice: config.LUNCH_PUBLIC_VOICE_URL || `${publicUrl}/api/voice/twilio`,
    status: config.LUNCH_PUBLIC_STATUS_URL || `${publicUrl}/api/voice/twilio/status`,
  };
}

export default async function twilioRoutes(app: FastifyInstance, deps: VoiceDeps) {
  const { config, log, db } = deps;
  const urls = voiceUrls(config.PUBLIC_URL, config);

  async function verified(req: { headers: Record<string, unknown>; body: unknown; url: string }, configuredUrl: string): Promise<TwilioWebhookBody | null> {
    const body = (req.body || {}) as TwilioWebhookBody;
    if (config.allowUnsignedWebhooks) return body;
    if (!config.TWILIO_AUTH_TOKEN) return null;
    const signature = typeof req.headers['x-twilio-signature'] === 'string' ? (req.headers['x-twilio-signature'] as string) : null;
    const seen = `${config.PUBLIC_URL}${req.url}`;
    const ok = await validateTwilioSignature(config.TWILIO_AUTH_TOKEN, signature, [configuredUrl, seen], body as Record<string, string>);
    return ok ? body : null;
  }

  const twiml = (xml: string) => ({ headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' }, xml });

  app.post('/api/voice/twilio', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req, reply) => {
    const started = Date.now();
    let callSid = '';
    try {
      if (!config.TWILIO_AUTH_TOKEN && !config.allowUnsignedWebhooks) {
        log.error({ missing: 'TWILIO_AUTH_TOKEN' }, 'voice.unconfigured');
        return reply.code(503).send('Voice webhook is not configured');
      }
      const body = await verified(req as never, urls.voice);
      if (!body) { log.warn({ url: req.url }, 'voice.bad_signature'); return reply.code(403).send('Forbidden'); }
      callSid = body.CallSid || '';
      if (!callSid) return reply.code(400).send('Missing CallSid');

      const now = new Date();
      const today = todayInBerlin(now);
      const existing = await findCallBySid(db, callSid);
      const input = toTurnInput(body, !existing, now);
      const state = (existing && stateFromRow(existing)) || initialState(today, input.callerNumber || null);
      const { ctx, settings, menu, fableActive } = await buildDialogContext(deps, today, callSid);
      if (!existing && !fableActive) log.warn({ callSid }, 'voice.no_model: ANTHROPIC_API_KEY not set; rule-based understanding only');

      const turn = await runTurn(state, input, ctx);
      const row = await persistTurn(db, existing, callSid, 'twilio', turn, settings.storeTranscripts, now);
      await applyEffects(deps, turn.effects, row.id, turn.state);

      const opts: TwilioVoiceOptions = {
        actionUrl: urls.voice, voice: config.LUNCH_TTS_VOICE, language: 'de-DE', silenceTimeoutSeconds: 10, hints: hintsFor(menu),
        handoffNumber: handoffNumber(config, settings) || null, outboundCallerId: config.TWILIO_PHONE_NUMBER || null, rate: '90%',
      };
      const out = twiml(renderTwiml(turn, opts));
      log.info({ callSid, callId: row.id, stage: turn.state.stage, action: turn.action, ms: Date.now() - started }, 'voice.turn');
      return reply.headers(out.headers).send(out.xml);
    } catch (err) {
      log.error({ err, callSid, ms: Date.now() - started }, 'voice.error');
      try { await createAlert(db, { type: 'system_error', severity: 'critical', message: `Technischer Fehler im Sprachdialog (${callSid || 'ohne CallSid'}): ${(err as Error).message}` }); } catch { /* best-effort */ }
      const number = config.LUNCH_HANDOFF_NUMBER || '';
      const fallback: TurnResult = { state: initialState(todayInBerlin()), say: [P.systemError()], action: number ? 'dial' : 'hangup', gatherMode: 'speech', effects: [] };
      const out = twiml(renderTwiml(fallback, { actionUrl: urls.voice, voice: config.LUNCH_TTS_VOICE, language: 'de-DE', silenceTimeoutSeconds: 10, hints: [], handoffNumber: number || null, rate: '90%' }));
      return reply.code(200).headers(out.headers).send(out.xml);
    }
  });

  app.post('/api/voice/twilio/status', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req, reply) => {
    try {
      const body = await verified(req as never, urls.status);
      if (!body) return reply.code(403).send('Forbidden');
      const callSid = body.CallSid || '';
      if (!callSid) return reply.code(400).send('Missing CallSid');
      const duration = body.CallDuration ? Number(body.CallDuration) : null;
      const row = await closeCall(db, callSid, body.CallStatus || '', Number.isFinite(duration) ? duration : null);
      if (row) {
        deps.events.publish({ type: 'call', action: 'update', id: row.id });
        log.info({ callId: row.id, callSid, twilioStatus: body.CallStatus, callStatus: row.callStatus }, 'call.status');
      }
      return reply.code(204).send();
    } catch (err) {
      log.error({ err }, 'call.status.error');
      return reply.code(204).send();
    }
  });
}
