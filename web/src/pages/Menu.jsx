import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { buttonClass, Empty, ErrorNote, Field, inputClass, Loading, PageHeader, primaryButtonClass, Saved, splitList, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import { addDays, formatDateDe, todayBerlin, weekdayDe } from '@/lib/dates';
import { t } from '@/i18n';

const CATEGORIES = ['main', 'vegetarian', 'soup', 'dessert', 'special'];
const POSITION_WORDS = ['', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun'];
const blank = (position) => ({ position, nameDe: '', descriptionDe: '', category: 'main', available: true, components: '', allergens: '', ingredients: '', allowedModifications: '', aliases: '' });
const toForm = (row) => ({ id: row.id, position: row.position, nameDe: row.nameDe || '', descriptionDe: row.descriptionDe || '', category: row.category || 'main', available: row.available !== false, components: (row.components || []).join(', '), allergens: (row.allergens || []).join(', '), ingredients: (row.ingredients || []).join(', '), allowedModifications: (row.allowedModifications || []).join(', '), aliases: (row.aliases || []).join(', ') });

/** SPEISEPLAN: the day's dishes, in the order the telephone reads them. */
export default function Menu() {
  const [date, setDate] = useState(todayBerlin());
  const [day, setDay] = useState({ published: true, orderDeadline: '', note: '' });
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setItems(null); setError('');
    try {
      const r = await api.get(`/api/menu/${date}`);
      const d = r.day;
      setDay({ published: d ? d.published !== false : true, orderDeadline: d?.orderDeadline || '', note: d?.note || '' });
      setItems((r.items || []).map(toForm));
    } catch (e) { setError(e.message); setItems([]); }
  }, [date]);
  useEffect(() => { setSaved(false); load(); }, [load]);

  const update = (i, k, v) => { setSaved(false); setItems((list) => list.map((it, j) => (j === i ? { ...it, [k]: v } : it))); };
  const add = () => setItems((list) => [...list, blank((list.length ? Math.max(...list.map((i) => Number(i.position) || 0)) : 0) + 1)]);
  const remove = (i) => setItems((list) => list.filter((_, j) => j !== i).map((it, j) => ({ ...it, position: j + 1 })));

  const save = async () => {
    setSaving(true); setError('');
    try {
      const payload = items.map((it) => ({ ...it, position: Number(it.position), components: splitList(it.components), allergens: splitList(it.allergens), ingredients: splitList(it.ingredients), allowedModifications: splitList(it.allowedModifications), aliases: splitList(it.aliases) }));
      await api.put(`/api/menu/${date}`, { published: day.published, orderDeadline: day.orderDeadline, note: day.note, items: payload });
      setSaved(true); toast.success(t('common.saved')); load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  const duplicate = async () => {
    setSaving(true); setError('');
    try { await api.post(`/api/menu/${date}/duplicate`, {}); toast.success(t('common.saved')); load(); } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  return (
    <div>
      <PageHeader title={t('menu.title')} lead={`${weekdayDe(date)}, ${formatDateDe(date)}`}>
        <Saved show={saved} />
        <button type="button" className={primaryButtonClass} onClick={save} disabled={saving || items === null}>{t('common.save')}</button>
      </PageHeader>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass} onClick={() => setDate(addDays(date, -1))} aria-label={t('common.yesterday')}><ChevronLeft size={20} /></button>
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="min-h-[48px] rounded-md border-2 border-neutral-300 px-3 text-lg" />
        <button type="button" className={buttonClass} onClick={() => setDate(addDays(date, 1))} aria-label={t('common.tomorrow')}><ChevronRight size={20} /></button>
        <button type="button" className={buttonClass} onClick={() => setDate(todayBerlin())}>{t('common.today')}</button>
        {items && items.length === 0 && <button type="button" className={buttonClass} onClick={duplicate} disabled={saving}><Copy size={18} /> {t('menu.duplicate')}</button>}
      </div>
      <ErrorNote error={error} />
      {items === null && <Loading />}
      {items && (
        <>
          <div className="mb-5 grid gap-4 rounded-lg border-2 border-neutral-200 bg-white p-4 sm:grid-cols-3">
            <Toggle label={day.published ? t('menu.published') : t('menu.draft')} checked={day.published} onChange={(v) => { setSaved(false); setDay((d) => ({ ...d, published: v })); }} />
            <Field label={t('menu.deadline')}><input value={day.orderDeadline} onChange={(e) => setDay((d) => ({ ...d, orderDeadline: e.target.value }))} placeholder="10:30" className={inputClass} /></Field>
            <Field label={t('menu.note')}><input value={day.note} onChange={(e) => setDay((d) => ({ ...d, note: e.target.value }))} className={inputClass} /></Field>
          </div>
          {items.length === 0 && <Empty title={t('menu.empty')} action={<button type="button" className={primaryButtonClass} onClick={add}><Plus size={18} /> {t('menu.addItem')}</button>} />}
          <div className="space-y-4">
            {items.map((it, i) => (
              <div key={it.id || `new-${i}`} className={`rounded-lg border-2 bg-white p-4 ${it.available ? 'border-neutral-300' : 'border-red-300 bg-red-50'}`}>
                <div className="flex flex-wrap items-end gap-4">
                  <Field label={t('menu.position')}><input type="number" min="1" max="20" value={it.position} onChange={(e) => update(i, 'position', e.target.value)} className={`${inputClass} w-24 text-2xl font-bold`} /></Field>
                  <div className="min-w-[260px] flex-1"><Field label={t('menu.name')}><input value={it.nameDe} onChange={(e) => update(i, 'nameDe', e.target.value)} className={`${inputClass} text-xl font-semibold`} placeholder="Schnitzel mit Kartoffeln und Gemüse" /></Field></div>
                  <Field label={t('menu.category')}>
                    <select value={it.category} onChange={(e) => update(i, 'category', e.target.value)} className={inputClass}>{CATEGORIES.map((c) => <option key={c} value={c}>{t(`menu.categories.${c}`)}</option>)}</select>
                  </Field>
                  <Toggle label={it.available ? t('menu.available') : t('menu.unavailable')} checked={it.available} onChange={(v) => update(i, 'available', v)} />
                  <button type="button" className={buttonClass} onClick={() => remove(i)} aria-label={t('menu.remove')}><Trash2 size={18} /></button>
                </div>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <Field label={t('menu.components')}><input value={it.components} onChange={(e) => update(i, 'components', e.target.value)} className={inputClass} placeholder="Kartoffeln, Gemüse" /></Field>
                  <Field label={t('menu.allowedModifications')}><input value={it.allowedModifications} onChange={(e) => update(i, 'allowedModifications', e.target.value)} className={inputClass} placeholder="ohne Zwiebeln, Reis statt Kartoffeln" /></Field>
                  <Field label={t('menu.allergens')}><input value={it.allergens} onChange={(e) => update(i, 'allergens', e.target.value)} className={inputClass} placeholder="Gluten, Ei" /></Field>
                  <Field label={t('menu.ingredients')}><input value={it.ingredients} onChange={(e) => update(i, 'ingredients', e.target.value)} className={inputClass} /></Field>
                  <Field label={t('menu.aliases')}><input value={it.aliases} onChange={(e) => update(i, 'aliases', e.target.value)} className={inputClass} placeholder="Nudeln" /></Field>
                  <Field label={t('menu.description')}><input value={it.descriptionDe} onChange={(e) => update(i, 'descriptionDe', e.target.value)} className={inputClass} /></Field>
                </div>
              </div>
            ))}
          </div>
          {items.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <button type="button" className={buttonClass} onClick={add}><Plus size={18} /> {t('menu.addItem')}</button>
              <button type="button" className={primaryButtonClass} onClick={save} disabled={saving}>{t('common.save')}</button>
            </div>
          )}
          {items.length > 0 && (
            <p className="mt-6 rounded-md border-2 border-neutral-200 bg-white px-4 py-3 text-base text-neutral-700">
              <strong>{t('menu.voiceHint')}</strong> „Heute haben wir: {items.filter((i) => i.available && i.nameDe).map((i) => `Nummer ${POSITION_WORDS[Number(i.position)] || i.position}: ${i.nameDe}`).join('. ')}.“
            </p>
          )}
        </>
      )}
    </div>
  );
}
