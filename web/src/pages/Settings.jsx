import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import { buttonClass, ErrorNote, Field, inputClass, Loading, Modal, Panel, PageHeader, primaryButtonClass, Saved, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTimeDe } from '@/lib/dates';
import { useAuth } from '@/lib/auth';
import { t } from '@/i18n';

/** EINSTELLUNGEN: how the telephone behaves, what is kept and for how long, who may do what. */
export default function Settings() {
  const { role } = useOutletContext();
  const admin = role === 'ADMIN';
  const [settings, setSettings] = useState(null);
  const [voiceUrls, setVoiceUrls] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/api/settings').then((r) => { setSettings(r.settings); setVoiceUrls(r.voiceUrls); }).catch((e) => setError(e.message)); }, []);
  const set = (k, v) => { setSaved(false); setSettings((s) => ({ ...s, [k]: v })); };

  const save = async () => {
    setSaving(true); setError('');
    try {
      const r = await api.put('/api/settings', { ...settings, callRetentionDays: Number(settings.callRetentionDays), orderRetentionDays: Number(settings.orderRetentionDays), maxFailures: Number(settings.maxFailures), confidenceThreshold: Number(settings.confidenceThreshold) });
      setSettings(r.settings); setSaved(true); toast.success(t('common.saved'));
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  if (error && !settings) return <ErrorNote error={error} />;
  if (!settings) return <Loading />;
  return (
    <div>
      <PageHeader title={t('settings.title')} lead={admin ? '' : t('settings.onlyAdmin')}>
        {admin && <><Saved show={saved} /><button type="button" className={primaryButtonClass} onClick={save} disabled={saving}>{t('common.save')}</button></>}
      </PageHeader>
      <ErrorNote error={error} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={t('settings.general')}>
          <div className="space-y-4 p-4">
            <Field label={t('settings.restaurantName')}><input disabled={!admin} value={settings.restaurantName} onChange={(e) => set('restaurantName', e.target.value)} className={inputClass} /></Field>
            <Field label={t('settings.handoff')}><input disabled={!admin} value={settings.handoffNumber || ''} onChange={(e) => set('handoffNumber', e.target.value)} className={inputClass} placeholder="+49 30 …" /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('settings.deadline')}><input disabled={!admin} value={settings.orderDeadline || ''} onChange={(e) => set('orderDeadline', e.target.value)} className={inputClass} placeholder="10:30" /></Field>
              <Field label={t('settings.maxFailures')}><input disabled={!admin} type="number" min="2" max="6" value={settings.maxFailures} onChange={(e) => set('maxFailures', e.target.value)} className={inputClass} /></Field>
              <Field label={t('settings.confidence')}><input disabled={!admin} type="number" min="0.4" max="0.95" step="0.05" value={settings.confidenceThreshold} onChange={(e) => set('confidenceThreshold', e.target.value)} className={inputClass} /></Field>
            </div>
            <Toggle disabled={!admin} label={t('settings.allowAfterDeadline')} checked={settings.allowSameDayAfterDeadline} onChange={(v) => set('allowSameDayAfterDeadline', v)} />
            <Toggle disabled={!admin} label={t('settings.useCallerId')} checked={settings.useCallerId} onChange={(v) => set('useCallerId', v)} />
          </div>
        </Panel>
        <Panel title={t('settings.privacy')}>
          <div className="space-y-4 p-4">
            <Toggle disabled={!admin} label={t('settings.storeTranscripts')} checked={settings.storeTranscripts} onChange={(v) => set('storeTranscripts', v)} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('settings.callRetention')}><input disabled={!admin} type="number" min="1" value={settings.callRetentionDays} onChange={(e) => set('callRetentionDays', e.target.value)} className={inputClass} /></Field>
              <Field label={t('settings.orderRetention')}><input disabled={!admin} type="number" min="7" value={settings.orderRetentionDays} onChange={(e) => set('orderRetentionDays', e.target.value)} className={inputClass} /></Field>
            </div>
            {admin && <RetentionButton />}
          </div>
        </Panel>
        {admin && <Team />}
        <Health voiceUrls={voiceUrls} />
        {admin && <Audit />}
      </div>
    </div>
  );
}

function RetentionButton() {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { const r = await api.post('/api/retention/run'); toast.success(`${r.deleted?.calls ?? 0} Anrufe, ${r.deleted?.orders ?? 0} Bestellungen gelöscht`); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return <button type="button" className={buttonClass} onClick={run} disabled={busy}>{t('settings.runRetention')}</button>;
}

function Team() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState(null);
  const load = () => api.get('/api/users').then((r) => setUsers(r.users)).catch((e) => { setError(e.message); setUsers([]); });
  useEffect(() => { load(); }, []);
  const patch = async (u, body) => {
    try { await api.patch(`/api/users/${u.id}`, body); load(); } catch (e) { toast.error(e.message); }
  };
  return (
    <Panel title={t('settings.team')} action={<button type="button" className={buttonClass} onClick={() => setAdding(true)}><UserPlus size={18} /> {t('settings.addUser')}</button>}>
      <div className="p-4">
        <ErrorNote error={error} />
        {users === null && <Loading />}
        <div className="divide-y-2 divide-neutral-100">
          {(users || []).map((u) => {
            const self = me && u.id === me.id;
            return (
              <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0"><p className="truncate text-lg font-semibold">{u.name || u.email}{self ? ' (Sie)' : ''}</p><p className="truncate text-sm text-neutral-600">{u.email}{!u.active ? ` · ${t('settings.locked')}` : ''}</p></div>
                <div className="flex flex-wrap items-center gap-2">
                  <select value={u.role} disabled={self} onChange={(e) => patch(u, { role: e.target.value })} className="min-h-[44px] rounded-md border-2 border-neutral-300 bg-white px-3 text-base disabled:opacity-60" aria-label={`Rolle für ${u.email}`}>
                    <option value="ADMIN">{t('app.role.ADMIN')}</option>
                    <option value="STAFF">{t('app.role.STAFF')}</option>
                    <option value="KITCHEN">{t('app.role.KITCHEN')}</option>
                  </select>
                  {!self && <button type="button" className={buttonClass} onClick={() => patch(u, { active: !u.active })}>{u.active ? t('settings.locked') : t('settings.active')}</button>}
                  <button type="button" className={buttonClass} onClick={() => setResetting(u)}>{t('settings.newPassword')}</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {adding && <UserForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      {resetting && <PasswordForm user={resetting} onClose={() => setResetting(null)} onSaved={() => { setResetting(null); load(); }} />}
    </Panel>
  );
}

function UserForm({ onClose, onSaved }) {
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'STAFF' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api.post('/api/users', form); toast.success(t('common.saved')); onSaved(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={t('settings.addUser')} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <ErrorNote error={error} />
        <Field label={t('login.email')}><input type="email" required value={form.email} onChange={(e) => set('email', e.target.value)} className={inputClass} /></Field>
        <Field label={t('settings.name')}><input value={form.name} onChange={(e) => set('name', e.target.value)} className={inputClass} /></Field>
        <Field label={t('settings.password')}><input type="password" required minLength={10} autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} className={inputClass} /></Field>
        <Field label={t('settings.role')}>
          <select value={form.role} onChange={(e) => set('role', e.target.value)} className={inputClass}>
            <option value="ADMIN">{t('app.role.ADMIN')}</option><option value="STAFF">{t('app.role.STAFF')}</option><option value="KITCHEN">{t('app.role.KITCHEN')}</option>
          </select>
        </Field>
        <div className="flex justify-end gap-3">
          <button type="button" className={buttonClass} onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className={primaryButtonClass} disabled={busy}>{t('common.save')}</button>
        </div>
      </form>
    </Modal>
  );
}

function PasswordForm({ user, onClose, onSaved }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api.patch(`/api/users/${user.id}`, { password }); toast.success(t('common.saved')); onSaved(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`${t('settings.newPassword')} — ${user.email}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <ErrorNote error={error} />
        <Field label={t('settings.password')}><input type="password" required minLength={10} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} /></Field>
        <div className="flex justify-end gap-3">
          <button type="button" className={buttonClass} onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className={primaryButtonClass} disabled={busy}>{t('common.save')}</button>
        </div>
      </form>
    </Modal>
  );
}

function Health({ voiceUrls }) {
  const [health, setHealth] = useState(null);
  useEffect(() => { fetch('/health').then((r) => r.json()).then(setHealth).catch((e) => setHealth({ error: e.message })); }, []);
  const Row = ({ label, ok, extra }) => (
    <div className="flex items-center justify-between py-2 text-lg"><span>{label}</span><span className={`font-bold ${ok ? 'text-emerald-700' : 'text-red-700'}`}>{ok ? t('settings.ok') : t('settings.missing')}{extra ? ` · ${extra}` : ''}</span></div>
  );
  return (
    <Panel title={t('settings.system')}>
      <div className="p-4">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-neutral-600">{t('settings.health')}</h3>
        {health === null && <Loading />}
        {health && health.error && <ErrorNote error={health.error} />}
        {health && !health.error && (
          <div className="divide-y-2 divide-neutral-100">
            <Row label={t('settings.integrations.database')} ok={health.database === 'ok'} extra={`${health.menuItemsToday} Gerichte heute`} />
            <Row label={t('settings.integrations.twilio')} ok={health.integrations?.twilio} />
            <Row label={t('settings.integrations.fable')} ok={health.integrations?.fable} extra={health.integrations?.fableModel} />
          </div>
        )}
        <h3 className="mb-2 mt-6 text-sm font-bold uppercase tracking-wide text-neutral-600">{t('settings.webhooks')}</h3>
        <p className="text-sm text-neutral-600">{t('settings.voiceUrl')}</p>
        <code className="block break-all rounded-md bg-neutral-100 px-3 py-2 text-sm">{voiceUrls?.voice || '…'}</code>
        <p className="mt-2 text-sm text-neutral-600">{t('settings.statusUrl')}</p>
        <code className="block break-all rounded-md bg-neutral-100 px-3 py-2 text-sm">{voiceUrls?.status || '…'}</code>
      </div>
    </Panel>
  );
}

function Audit() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get('/api/audit').then((r) => setRows(r.entries || [])).catch(() => setRows([])); }, []);
  return (
    <Panel title={t('settings.audit')} className="lg:col-span-2">
      <div className="divide-y-2 divide-neutral-100 p-4">
        {rows === null && <Loading />}
        {(rows || []).map((r) => (
          <p key={r.id} className="py-2 text-base"><span className="text-sm text-neutral-600">{dateTimeDe(r.createdAt)} · {r.actorEmail || 'system'}</span><br />{r.summary || r.action}</p>
        ))}
        {rows && rows.length === 0 && <p className="text-base text-neutral-600">—</p>}
      </div>
    </Panel>
  );
}
