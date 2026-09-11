import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { ErrorNote, Field, inputClass, primaryButtonClass } from '@/components/ui';
import { t } from '@/i18n';

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const returnTo = new URLSearchParams(location.search).get('returnTo');
  const target = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/mittag';
  if (user) return <Navigate to={target} replace />;

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await login(email, password); navigate(target, { replace: true }); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-lg border-2 border-neutral-200 bg-white p-8" style={{ fontSize: '18px' }}>
        <h1 className="mb-1 text-3xl font-bold">{t('app.title')}</h1>
        <p className="mb-6 text-base text-neutral-600">{t('app.subtitle')}</p>
        <ErrorNote error={error} />
        <div className="space-y-4">
          <Field label={t('login.email')}><input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} /></Field>
          <Field label={t('login.password')}><input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} /></Field>
          <button type="submit" className={`${primaryButtonClass} w-full`} disabled={busy}><LogIn size={20} /> {t('login.submit')}</button>
        </div>
      </form>
    </main>
  );
}
