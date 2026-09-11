import { describe, expect, it } from 'vitest';
import { computeTwilioSignature, parseFormBody, renderTwiml, toTurnInput, validateTwilioSignature, escapeXml } from '../../src/domain/twilio.ts';
import type { TwilioVoiceOptions } from '../../src/domain/twilio.ts';
import type { TurnResult } from '../../src/domain/types.ts';
import { initialState } from '../../src/domain/dialog.ts';

const OPTS: TwilioVoiceOptions = {
  actionUrl: 'https://example.base44.app/api/apps/app1/functions/lunchVoiceWebhook',
  voice: 'Polly.Vicki', language: 'de-DE', silenceTimeoutSeconds: 10, hints: ['Schnitzel', 'ja', 'nein'], handoffNumber: '+493012345678', rate: '90%',
};
const turn = (over: Partial<TurnResult>): TurnResult => ({ state: initialState('2026-09-11'), say: ['Guten Tag & willkommen.'], action: 'gather', gatherMode: 'code', effects: [], ...over });

describe('renderTwiml', () => {
  it('gathers German speech (and keypad for the code) with a generous silence timeout', () => {
    const xml = renderTwiml(turn({}), OPTS);
    expect(xml).toContain('<Gather input="speech dtmf" language="de-DE"');
    expect(xml).toContain('timeout="10"');
    expect(xml).toContain('actionOnEmptyResult="true"');
    expect(xml).toContain('finishOnKey="#"');
    expect(xml).toContain('<Say voice="Polly.Vicki" language="de-DE"><prosody rate="90%">Guten Tag &amp; willkommen.</prosody></Say>');
    expect(xml).toContain('hints="Schnitzel, ja, nein"');
  });
  it('speech-only gather for the order', () => {
    expect(renderTwiml(turn({ gatherMode: 'speech' }), OPTS)).toContain('input="speech" ');
  });
  it('dials the restaurant for a handoff', () => {
    const xml = renderTwiml(turn({ action: 'dial', say: ['Ich verbinde.'] }), OPTS);
    expect(xml).toContain('<Dial timeout="30">+493012345678</Dial>');
    expect(xml).toContain('<Hangup/>');
  });
  it('hangs up when the call is over', () => {
    const xml = renderTwiml(turn({ action: 'hangup', say: ['Auf Wiederhören.'] }), OPTS);
    expect(xml).not.toContain('<Gather');
    expect(xml).toContain('<Hangup/>');
  });
  it('escapes XML', () => {
    expect(escapeXml('<a href="x">&\'')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;');
  });
});

describe('webhook parsing', () => {
  it('maps the Twilio form body to a turn input', () => {
    const body = parseFormBody('CallSid=CA1&From=%2B4917012345&SpeechResult=vier+zwei+sieben&Confidence=0.87');
    const t = toTurnInput(body, false);
    expect(t).toMatchObject({ utterance: 'vier zwei sieben', sttConfidence: 0.87, callerNumber: '+4917012345', digits: null });
  });
  it('treats the first webhook without speech as the call start, later ones as silence', () => {
    expect(toTurnInput({ CallSid: 'x' }, true).utterance).toBeNull();
    expect(toTurnInput({ CallSid: 'x' }, false).utterance).toBe('');
  });
  it('withholds a caller id that is not a phone number', () => {
    expect(toTurnInput({ From: 'anonymous' }, false).callerNumber).toBeNull();
  });
});

describe('Twilio signature', () => {
  const token = 'test-auth-token';
  const url = 'https://example.base44.app/api/apps/app1/functions/lunchVoiceWebhook';
  const params = { CallSid: 'CA1', From: '+4917012345', SpeechResult: 'ja' };
  it('accepts a valid signature and rejects a tampered body', async () => {
    const sig = await computeTwilioSignature(token, url, params);
    expect(await validateTwilioSignature(token, sig, [url], params)).toBe(true);
    expect(await validateTwilioSignature(token, sig, [url], { ...params, SpeechResult: 'nein' })).toBe(false);
    expect(await validateTwilioSignature('other', sig, [url], params)).toBe(false);
    expect(await validateTwilioSignature(token, null, [url], params)).toBe(false);
  });
  it('tolerates the :443 port difference behind a proxy', async () => {
    const sig = await computeTwilioSignature(token, url, params);
    expect(await validateTwilioSignature(token, sig, ['https://example.base44.app:443/api/apps/app1/functions/lunchVoiceWebhook'], params)).toBe(true);
  });
});
