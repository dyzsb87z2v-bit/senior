import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Phone, PhoneOff, Send } from 'lucide-react';
import { buttonClass, Empty, ErrorNote, Field, inputClass, LiveDot, Loading, Panel, PageHeader, primaryButtonClass } from '@/components/ui';
import { useLiveConnection, useLiveQuery } from '@/lib/useLive';
import { api } from '@/lib/api';
import { dateTimeDe } from '@/lib/dates';
import { t } from '@/i18n';

/** ANRUFE: every call with its outcome and transcript, and a text simulator that runs the real dialog. */
export default function Calls() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('call');
  const live = useLiveConnection();
  const calls = useLiveQuery('/api/calls?limit=200', ['call', 'order'], (d) => d.calls || []);
  const selected = (calls.data || []).find((c) => c.id === selectedId) || null;

  return (
    <div>
      <PageHeader title={t('calls.title')}><LiveDot live={live} /></PageHeader>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ErrorNote error={calls.error} onRetry={calls.reload} />
          {calls.data === null && <Loading />}
          {calls.data && calls.data.length === 0 && <Empty title={t('calls.empty')} />}
          <div className="space-y-3">
            {(calls.data || []).map((c) => (
              <button key={c.id} type="button" onClick={() => setParams({ call: c.id })} className={`block w-full rounded-lg border-2 bg-white p-4 text-left ${selectedId === c.id ? 'border-neutral-900' : 'border-neutral-200 hover:border-neutral-400'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-lg font-bold">{c.customerCode ? `#${c.customerCode}` : '—'} <span className="font-normal text-neutral-600">· {dateTimeDe(c.startedAt || c.createdAt)}{c.provider === 'simulator' ? ' · Test' : ''}</span></p>
                  <span className={`rounded-md border-2 px-2 py-0.5 text-sm font-bold ${c.callStatus === 'completed' ? 'border-emerald-500 text-emerald-800' : c.callStatus === 'handoff' ? 'border-red-400 text-red-800' : 'border-neutral-300 text-neutral-700'}`}>{t(`calls.status.${c.callStatus || 'in_progress'}`)}</span>
                </div>
                {c.detectedOrder?.itemName && <p className="mt-1 text-base">{t('calls.detected')}: {c.detectedOrder.quantity > 1 ? `${c.detectedOrder.quantity} × ` : ''}{c.detectedOrder.itemName}{c.detectedOrder.modifications?.length ? ` · ${c.detectedOrder.modifications.join(', ')}` : ''}</p>}
                {c.handoffReason && <p className="mt-1 text-base text-red-800">{t('calls.reason')}: {c.handoffReason}</p>}
              </button>
            ))}
          </div>
          {selected && <CallDetail call={selected} />}
        </div>
        <Simulator onTurn={calls.reload} />
      </div>
    </div>
  );
}

function CallDetail({ call }) {
  const conf = call.detectedOrder?.confidence;
  return (
    <Panel title={`${t('calls.transcript')} — ${dateTimeDe(call.startedAt || call.createdAt)}`} className="mt-6">
      <div className="space-y-2 p-4">
        <p className="text-base text-neutral-700">
          {call.callerNumber && <span>{t('calls.callerNumber')}: {call.callerNumber} · </span>}
          {call.durationSeconds ? <span>{t('calls.duration')}: {call.durationSeconds}s · </span> : null}
          {conf && <span>{t('calls.confidence')}: {t('common.customer')} {Math.round((conf.customer || 0) * 100)}% · {t('calls.order')} {Math.round((conf.order || 0) * 100)}% · Speiseplan {Math.round((conf.menuMatch || 0) * 100)}%</span>}
        </p>
        {(!call.transcript || call.transcript.length === 0) && <p className="text-base text-neutral-600">{t('calls.noTranscript')}</p>}
        {(call.transcript || []).map((line, i) => (
          <p key={i} className={`rounded-md px-3 py-2 text-lg ${line.role === 'customer' ? 'ml-8 bg-neutral-900 text-white' : 'mr-8 bg-neutral-100'}`}>
            {line.text}{typeof line.confidence === 'number' && <span className="ml-2 text-sm opacity-70">({Math.round(line.confidence * 100)}%)</span>}
          </p>
        ))}
      </div>
    </Panel>
  );
}

/** The dialog engine, typed. Same engine, same records, same Fable; only the telephone is missing. */
function Simulator({ onTurn }) {
  const [callId, setCallId] = useState(null);
  const [lines, setLines] = useState([]);
  const [text, setText] = useState('');
  const [caller, setCaller] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ended, setEnded] = useState(false);
  const [model, setModel] = useState(null);
  const bottom = useRef(null);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }); }, [lines]);

  const run = async (utterance) => {
    setBusy(true); setError('');
    try {
      const r = await api.post('/api/voice/simulate', { ...(callId ? { callId } : {}), ...(utterance !== undefined ? { utterance } : {}), callerNumber: caller });
      setCallId(r.callId); setModel(r.model);
      setLines((l) => [...l, ...(utterance !== undefined ? [{ role: 'customer', text: utterance || '(Stille)' }] : []), ...r.say.map((s) => ({ role: 'assistant', text: s }))]);
      if (r.action !== 'gather') setEnded(true);
      if (onTurn) onTurn();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const start = () => { setLines([]); setEnded(false); setCallId(null); run(undefined); };
  const send = (e) => { e.preventDefault(); const u = text; setText(''); run(u); };

  return (
    <Panel title={t('calls.simulator')}>
      <div className="p-4">
        <p className="mb-3 text-sm text-neutral-600">{t('calls.simulatorHint')}{model ? ` · Modell: ${model}` : ''}</p>
        <ErrorNote error={error} />
        {!callId && (
          <div className="space-y-3">
            <Field label={t('calls.callerNumber')}><input value={caller} onChange={(e) => setCaller(e.target.value)} placeholder="+49 …" className={inputClass} /></Field>
            <button type="button" className={primaryButtonClass} onClick={start} disabled={busy}><Phone size={18} /> {t('calls.start')}</button>
          </div>
        )}
        {callId && (
          <>
            <div className="max-h-[420px] space-y-2 overflow-y-auto rounded-md border-2 border-neutral-200 p-3">
              {lines.map((l, i) => <p key={i} className={`rounded-md px-3 py-2 text-base ${l.role === 'customer' ? 'ml-6 bg-neutral-900 text-white' : 'mr-6 bg-neutral-100'}`}>{l.text}</p>)}
              <div ref={bottom} />
            </div>
            {!ended ? (
              <form onSubmit={send} className="mt-3 flex gap-2">
                <input value={text} onChange={(e) => setText(e.target.value)} className={`${inputClass} mt-0`} placeholder="Vier zwei sieben" autoFocus />
                <button type="submit" className={primaryButtonClass} disabled={busy} aria-label={t('calls.send')}><Send size={18} /></button>
              </form>
            ) : (
              <p className="mt-3 inline-flex items-center gap-2 text-base font-semibold text-neutral-700"><PhoneOff size={18} /> {t('calls.status.completed')}</p>
            )}
            <button type="button" className={`${buttonClass} mt-3`} onClick={start} disabled={busy}>{t('calls.start')}</button>
          </>
        )}
      </div>
    </Panel>
  );
}
