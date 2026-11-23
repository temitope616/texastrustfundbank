import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { FieldError, InlineError } from '../components/BankingUI.jsx';
import BrandLockup from '../components/BrandLockup.jsx';

export default function LoginPage() {
  const { login, register, verifyTwoFactor } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState('credentials');
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '' });
  const [registration, setRegistration] = useState({ displayName: '', email: '', password: '', confirmPassword: '' });
  const [challengeId, setChallengeId] = useState('');
  const [demoCode, setDemoCode] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  async function submitCredentials(event) {
    event.preventDefault();
    const errors = {};
    if (!/^\S+@\S+\.\S+$/.test(form.email)) errors.email = 'Enter a valid email address.';
    if (!form.password) errors.password = 'Enter your password.';
    setFieldErrors(errors);
    setError('');
    if (Object.keys(errors).length) return;

    setBusy(true);
    try {
      const result = await login(form);
      if (result.token) {
        navigate('/dashboard', { replace: true });
        return;
      }
      setChallengeId(result.challengeId);
      setDemoCode(result.demoCode || '');
      setCode('');
      setStep('verification');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event) {
    event.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(code)) {
      setFieldErrors({ code: 'Enter the six-digit verification code.' });
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      await verifyTwoFactor({ challengeId, code });
      navigate('/dashboard', { replace: true });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitRegistration(event) {
    event.preventDefault();
    const errors = {};
    if (registration.displayName.trim().length < 2) errors.displayName = 'Enter your name (at least 2 characters).';
    if (!/^[a-z0-9._%+-]+@texas-trust\.test$/i.test(registration.email.trim())) {
      errors.registrationEmail = 'Use an email address ending in @texas-trust.test.';
    }
    if (registration.password.length < 12 || !/[a-z]/.test(registration.password) || !/[A-Z]/.test(registration.password) || !/\d/.test(registration.password) || !/[^A-Za-z0-9]/.test(registration.password)) {
      errors.registrationPassword = 'Use 12+ characters with uppercase, lowercase, a number, and a symbol.';
    }
    if (registration.password !== registration.confirmPassword) errors.confirmPassword = 'Passwords do not match.';
    setFieldErrors(errors);
    setError('');
    setNotice('');
    if (Object.keys(errors).length) return;

    setBusy(true);
    try {
      const result = await register({
        displayName: registration.displayName,
        email: registration.email,
        password: registration.password
      });
      const normalizedEmail = registration.email.trim().toLowerCase();
      setForm({ email: normalizedEmail, password: '' });
      setRegistration({ displayName: '', email: '', password: '', confirmPassword: '' });
      setMode('login');
      setNotice(result.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-story">
        <div className="login-brand"><BrandLockup inverse /></div>
        <div className="story-copy">
          <p className="eyebrow light">BANKING, CLEARLY</p>
          <h1>Your money.<br />In good order.</h1>
          <p>Everyday banking with a clearer view of what matters.</p>
        </div>
        <div className="story-foot"><span>PRIVATE BY DESIGN</span><span>01 / 08</span></div>
      </section>
      <section className="login-panel">
        <div className="login-form-wrap">
          <p className="eyebrow">INDEPENDENT PROTOTYPE</p>
          <h2>{step === 'verification' ? 'Verify it’s you' : mode === 'register' ? 'Open an account' : 'Welcome back'}</h2>
          <p className="login-intro">{step === 'verification' ? 'Enter the six-digit verification code to finish signing in.' : mode === 'register' ? 'Create your profile to open a view-only checking account.' : 'Sign in to securely access your accounts.'}</p>
          <div className="prototype-disclosure" role="note">Texas Legal Trust Fund Bank is a concept prototype, not a bank or trust company. No real accounts or funds are connected.</div>
          {notice && <div className="inline-banner success-banner" role="status">{notice}</div>}
          <InlineError>{error}</InlineError>
          {step === 'verification' ? (
            <form className="form-stack" onSubmit={submitCode} noValidate>
              {demoCode && <div className="inline-banner success-banner" role="status">Prototype: no text or email is sent. Your one-time code is <strong>{demoCode}</strong> (expires in 5 minutes).</div>}
              <label className="field"><span>Six-digit code</span><input className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /> <FieldError>{fieldErrors.code}</FieldError></label>
              <button className="button primary full" disabled={busy}>{busy ? 'Verifying…' : 'Verify and sign in'}</button>
              <button type="button" className="text-button centered" onClick={() => { setStep('credentials'); setCode(''); setFieldErrors({}); setError(''); }}>Back to sign in</button>
            </form>
          ) : mode === 'register' ? (
            <form className="form-stack" onSubmit={submitRegistration} noValidate>
              <label className="field"><span>Name</span><input autoComplete="name" maxLength={80} value={registration.displayName} onChange={(event) => setRegistration({ ...registration, displayName: event.target.value })} /><FieldError>{fieldErrors.displayName}</FieldError></label>
              <label className="field"><span>Email address</span><input type="email" autoComplete="email" placeholder="yourname@texas-trust.test" value={registration.email} onChange={(event) => setRegistration({ ...registration, email: event.target.value })} /><small className="field-hint">Use a made-up address ending in @texas-trust.test. Real email addresses are not accepted.</small><FieldError>{fieldErrors.registrationEmail}</FieldError></label>
              <label className="field"><span>Password</span><input type="password" autoComplete="new-password" value={registration.password} onChange={(event) => setRegistration({ ...registration, password: event.target.value })} /><FieldError>{fieldErrors.registrationPassword}</FieldError></label>
              <label className="field"><span>Confirm password</span><input type="password" autoComplete="new-password" value={registration.confirmPassword} onChange={(event) => setRegistration({ ...registration, confirmPassword: event.target.value })} /><FieldError>{fieldErrors.confirmPassword}</FieldError></label>
              <button className="button primary full" disabled={busy}>{busy ? 'Creating account…' : 'Create view-only account'}</button>
              <button type="button" className="text-button centered" onClick={() => { setMode('login'); setFieldErrors({}); setError(''); }}>Back to sign in</button>
            </form>
          ) : (
            <form className="form-stack" onSubmit={submitCredentials} noValidate>
              <label className="field"><span>Email address</span><input type="email" autoComplete="username" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /> <FieldError>{fieldErrors.email}</FieldError></label>
              <label className="field"><span>Password</span><input type="password" autoComplete="current-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /> <FieldError>{fieldErrors.password}</FieldError></label>
              <button className="button primary full" disabled={busy}>{busy ? 'Signing in…' : 'Continue'}</button>
              <button type="button" className="text-button centered" onClick={() => { setMode('register'); setNotice(''); setError(''); setFieldErrors({}); }}>Open an account</button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}