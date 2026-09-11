/**
 * Sends one real request to Claude Fable 5.1 with the exact request the voice
 * pipeline builds, and prints the structured answer.
 *
 *   ANTHROPIC_API_KEY=sk-ant-… node scripts/fable-smoke.mjs "Ich hätte gerne Schnitzel mit Reis statt Kartoffeln"
 */
import Anthropic from '@anthropic-ai/sdk';
import { buildFableRequest, mapFableOutput } from '../src/domain/fableRequest.ts';
import { validateUnderstanding } from '../src/domain/understanding.ts';

const utterance = process.argv.slice(2).join(' ') || 'Ich hätte gerne Schnitzel mit Reis statt Kartoffeln.';
const menu = [
  { id: 'm1', date: '2026-09-11', position: 1, nameDe: 'Schnitzel mit Kartoffeln und Gemüse', available: true, components: ['Kartoffeln', 'Gemüse'], allowedModifications: ['ohne Zwiebeln', 'Reis statt Kartoffeln'] },
  { id: 'm2', date: '2026-09-11', position: 2, nameDe: 'Fisch mit Reis und Salat', available: true, components: ['Reis', 'Salat'], allowedModifications: ['ohne Salat'] },
  { id: 'm3', date: '2026-09-11', position: 3, nameDe: 'Vegetarische Pasta', category: 'vegetarian', available: true, components: ['Pasta', 'Tomatensoße'], allowedModifications: [] },
];
if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY is not set.'); process.exit(2); }
const client = new Anthropic({ timeout: 20000, maxRetries: 0 });
const params = buildFableRequest({ utterance, stage: 'order', menu, draft: null, hasPreviousOrder: false }, process.env.LUNCH_AI_MODEL || undefined);
console.log('model:', params.model);
const started = Date.now();
const res = await client.messages.create(params);
console.log('latency ms:', Date.now() - started, '| stop_reason:', res.stop_reason, '| usage:', res.usage);
if (res.stop_reason === 'refusal') { console.log('refused:', res.stop_details); process.exit(1); }
const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
console.log('raw:', text);
console.log('validated:', JSON.stringify(validateUnderstanding(mapFableOutput(JSON.parse(text)), menu, 'fable'), null, 2));
