/**
 * The telephony layer: Twilio Programmable Voice, driven by TwiML.
 *
 * Twilio does the telephone call, German speech recognition
 * (`<Gather input="speech" language="de-DE">`) and German text-to-speech
 * (`<Say language="de-DE">`), and POSTs each result to our webhook. This file
 * turns a `TurnResult` into TwiML and a webhook body into a `TurnInput`, and
 * verifies the `X-Twilio-Signature` so nobody but Twilio can drive a call.
 */
import type { TurnInput, TurnResult } from './types.ts';

export interface TwilioVoiceOptions {
  /** Absolute URL of the webhook, used as the Gather `action`. */
  actionUrl: string;
  /** Polly voice, e.g. "Polly.Vicki" or "Polly.Vicki-Neural". */
  voice: string;
  language: string;
  /** Seconds of silence Twilio waits for input before posting an empty result. Elderly callers pause; keep this generous. */
  silenceTimeoutSeconds: number;
  /** Words that help the recogniser: dish names, "ja", "nein", digits. */
  hints: string[];
  /** Number to dial for a human handoff, E.164, or null. */
  handoffNumber: string | null;
  /** Caller id to present when dialling the restaurant (the Twilio number). */
  outboundCallerId?: string | null;
  /** Speaking rate for SSML prosody, e.g. "90%". */
  rate: string;
}

export function escapeXml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** One `<Say>` with slow prosody and a short pause between sentences. */
export function sayXml(texts: string[], o: TwilioVoiceOptions): string {
  if (!texts.length) return '';
  const body = texts.map((t) => escapeXml(t)).join(' <break time="500ms"/> ');
  return `<Say voice="${escapeXml(o.voice)}" language="${escapeXml(o.language)}"><prosody rate="${escapeXml(o.rate)}">${body}</prosody></Say>`;
}

/** Renders the TwiML for a finished turn. */
export function renderTwiml(turn: TurnResult, o: TwilioVoiceOptions): string {
  const parts: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<Response>'];
  const speech = sayXml(turn.say, o);

  if (turn.action === 'gather') {
    // `actionOnEmptyResult` makes silence reach the webhook so the assistant can reassure the caller instead of hanging up.
    const input = turn.gatherMode === 'speech' ? 'speech' : 'speech dtmf';
    const dtmf = turn.gatherMode === 'code' ? ' finishOnKey="#" numDigits="6"' : turn.gatherMode === 'confirm' ? ' numDigits="1"' : '';
    const hints = o.hints.length ? ` hints="${escapeXml(o.hints.join(', '))}"` : '';
    parts.push(
      `<Gather input="${input}" language="${escapeXml(o.language)}" action="${escapeXml(o.actionUrl)}" method="POST" ` +
      `speechTimeout="auto" timeout="${o.silenceTimeoutSeconds}" actionOnEmptyResult="true" enhanced="true" speechModel="phone_call"${dtmf}${hints}>`,
    );
    parts.push(speech);
    parts.push('</Gather>');
    // Reached only if Gather itself ends without posting (it will not, with actionOnEmptyResult), kept as a safety net.
    parts.push(`<Redirect method="POST">${escapeXml(o.actionUrl)}</Redirect>`);
  } else if (turn.action === 'dial' && o.handoffNumber) {
    parts.push(speech);
    const callerId = o.outboundCallerId ? ` callerId="${escapeXml(o.outboundCallerId)}"` : '';
    parts.push(`<Dial timeout="30"${callerId}>${escapeXml(o.handoffNumber)}</Dial>`);
    parts.push(sayXml(['Leider ist im Restaurant gerade niemand erreichbar. Ich habe Ihren Anruf notiert. Auf Wiederhören.'], o));
    parts.push('<Hangup/>');
  } else {
    parts.push(speech);
    parts.push('<Hangup/>');
  }
  parts.push('</Response>');
  return parts.join('');
}

export interface TwilioWebhookBody {
  CallSid?: string;
  From?: string;
  To?: string;
  CallStatus?: string;
  SpeechResult?: string;
  Confidence?: string;
  Digits?: string;
  CallDuration?: string;
  [k: string]: string | undefined;
}

export function parseFormBody(raw: string): TwilioWebhookBody {
  const out: TwilioWebhookBody = {};
  for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
  return out;
}

/** What the caller just did, as the dialog engine sees it. */
export function toTurnInput(body: TwilioWebhookBody, isFirstTurn: boolean, now: Date = new Date()): TurnInput {
  const speech = typeof body.SpeechResult === 'string' ? body.SpeechResult.trim() : '';
  const digits = typeof body.Digits === 'string' ? body.Digits.replace(/\D/g, '') : '';
  const conf = body.Confidence !== undefined ? Number(body.Confidence) : undefined;
  return {
    utterance: isFirstTurn && !speech && !digits ? null : speech,
    sttConfidence: Number.isFinite(conf) ? conf : undefined,
    digits: digits || null,
    callerNumber: body.From && /^\+?\d{5,}$/.test(body.From) ? body.From : null,
    now,
  };
}

// ── Signature ─────────────────────────────────────────────────────────

async function hmacSha1Base64(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  let bin = '';
  for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b);
  return btoa(bin);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The string Twilio signs: the full URL followed by the POST parameters sorted by key, concatenated. */
export function twilioSignedPayload(url: string, params: Record<string, string | undefined>): string {
  const keys = Object.keys(params).sort();
  let s = url;
  for (const k of keys) s += k + (params[k] ?? '');
  return s;
}

export async function computeTwilioSignature(authToken: string, url: string, params: Record<string, string | undefined>): Promise<string> {
  return hmacSha1Base64(authToken, twilioSignedPayload(url, params));
}

/**
 * Validates `X-Twilio-Signature`. Twilio signs the URL exactly as configured
 * in the console; behind a proxy the URL the function sees may differ, so
 * every candidate URL is tried (with and without the default port).
 */
export async function validateTwilioSignature(authToken: string, signature: string | null, candidateUrls: string[], params: Record<string, string | undefined>): Promise<boolean> {
  if (!authToken || !signature) return false;
  const urls = new Set<string>();
  for (const u of candidateUrls) {
    if (!u) continue;
    urls.add(u);
    try {
      const parsed = new URL(u);
      const isHttps = parsed.protocol === 'https:';
      const withPort = `${parsed.protocol}//${parsed.hostname}:${parsed.port || (isHttps ? 443 : 80)}${parsed.pathname}${parsed.search}`;
      const withoutPort = `${parsed.protocol}//${parsed.hostname}${parsed.pathname}${parsed.search}`;
      urls.add(withPort); urls.add(withoutPort);
    } catch { /* not a URL; skip */ }
  }
  for (const u of urls) {
    const expected = await hmacSha1Base64(authToken, twilioSignedPayload(u, params));
    if (safeEqual(expected, signature)) return true;
  }
  return false;
}
