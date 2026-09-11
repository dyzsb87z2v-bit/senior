import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { buttonClass, Empty, ErrorNote, Field, inputClass, Loading, Modal, PageHeader, primaryButtonClass } from '@/components/ui';
import { useLiveQuery } from '@/lib/useLive';
import { api } from '@/lib/api';
import { t } from '@/i18n';

/** KUNDEN: the directory. Code, name, room, active. Search by anything. */
export default function Customers() {
  const customers = useLiveQuery('/api/customers?inactive=1', ['customer'], (d) => d.customers || []);
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState(null); // null | {} (new) | customer

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (customers.data || [])
      .filter((c) => showInactive || c.active)
      .filter((c) => !needle || `${c.customerCode} ${c.firstName || ''} ${c.lastName || ''} ${c.roomNumber || ''} ${c.phoneNumber || ''}`.toLowerCase().includes(needle));
  }, [customers.data, q, showInactive]);

  return (
    <div>
      <PageHeader title={t('customers.title')}>
        <button type="button" className={primaryButtonClass} onClick={() => setEditing({})}><Plus size={18} /> {t('customers.add')}</button>
      </PageHeader>
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <label className="relative block w-full max-w-md">
          <Search size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${t('common.search')}: ${t('customers.code')}, Name, ${t('common.room')}`} className="min-h-[48px] w-full rounded-md border-2 border-neutral-300 pl-11 pr-3 text-lg" />
        </label>
        <label className="flex items-center gap-2 text-lg"><input type="checkbox" className="h-6 w-6 accent-neutral-900" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> {t('customers.inactive')} anzeigen</label>
      </div>
      <ErrorNote error={customers.error} onRetry={customers.reload} />
      {customers.data === null && <Loading />}
      {customers.data !== null && list.length === 0 && <Empty title={customers.data.length ? t('customers.notFound') : t('customers.empty')} />}
      {list.length > 0 && (
        <div className="overflow-x-auto rounded-lg border-2 border-neutral-200 bg-white">
          <table className="w-full text-left text-lg">
            <thead className="bg-neutral-100 text-sm uppercase tracking-wide text-neutral-600">
              <tr><th className="px-4 py-3">{t('customers.code')}</th><th className="px-4 py-3">Name</th><th className="px-4 py-3">{t('common.room')}</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr>
            </thead>
            <tbody className="divide-y-2 divide-neutral-100">
              {list.map((c) => (
                <tr key={c.id} className={!c.active ? 'text-neutral-500' : ''}>
                  <td className="px-4 py-3 text-2xl font-bold">#{c.customerCode}</td>
                  <td className="px-4 py-3"><Link to={`/mittag/kunden/${c.id}`} className="font-semibold underline underline-offset-4">{c.salutation} {c.firstName} {c.lastName}</Link>{c.notes && <p className="text-sm text-neutral-600">{c.notes}</p>}</td>
                  <td className="px-4 py-3">{c.roomNumber || '—'}</td>
                  <td className="px-4 py-3">{!c.active ? t('customers.inactive') : t('customers.active')}</td>
                  <td className="px-4 py-3 text-right"><button type="button" className={buttonClass} onClick={() => setEditing(c)}>{t('common.edit')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <CustomerForm customer={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); customers.reload(); }} />}
    </div>
  );
}

export function CustomerForm({ customer, onClose, onSaved }) {
  const isNew = !customer.id;
  const [form, setForm] = useState({ customerCode: customer.customerCode || '', firstName: customer.firstName || '', lastName: customer.lastName || '', salutation: customer.salutation || '', phoneNumber: customer.phoneNumber || '', roomNumber: customer.roomNumber || '', notes: customer.notes || '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (isNew) api.get('/api/customers/next-code').then((r) => setForm((f) => (f.customerCode ? f : { ...f, customerCode: r.customerCode }))).catch(() => {});
  }, [isNew]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async (e) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      if (isNew) await api.post('/api/customers', form); else await api.patch(`/api/customers/${customer.id}`, form);
      toast.success(t('common.saved')); onSaved();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  return (
    <Modal title={isNew ? t('customers.add') : `${t('customers.edit')} #${customer.customerCode}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <ErrorNote error={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('customers.code')} hint={t('customers.codeHint')}><input required pattern="\d{1,6}" inputMode="numeric" value={form.customerCode} onChange={(e) => set('customerCode', e.target.value.replace(/\D/g, ''))} className={`${inputClass} text-2xl font-bold`} /></Field>
          <Field label={t('customers.salutation')}>
            <select value={form.salutation} onChange={(e) => set('salutation', e.target.value)} className={inputClass}><option value="">—</option><option>Frau</option><option>Herr</option></select>
          </Field>
          <Field label={t('customers.firstName')}><input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} className={inputClass} /></Field>
          <Field label={t('customers.lastName')}><input required value={form.lastName} onChange={(e) => set('lastName', e.target.value)} className={inputClass} /></Field>
          <Field label={t('customers.room')}><input value={form.roomNumber} onChange={(e) => set('roomNumber', e.target.value)} className={inputClass} /></Field>
          <Field label={t('customers.phone')} hint={t('customers.phoneHint')}><input value={form.phoneNumber} onChange={(e) => set('phoneNumber', e.target.value)} placeholder="+49 …" className={inputClass} /></Field>
        </div>
        <Field label={t('customers.notes')}><textarea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} className={inputClass} /></Field>
        <div className="flex justify-end gap-3">
          <button type="button" className={buttonClass} onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className={primaryButtonClass} disabled={saving}>{t('common.save')}</button>
        </div>
      </form>
    </Modal>
  );
}
