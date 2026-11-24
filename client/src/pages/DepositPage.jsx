import { useState } from 'react';
import { apiRequest } from '../api.js';
import { AccountSelect, FieldError, InlineError, PageHeading } from '../components/BankingUI.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBanking } from '../contexts/BankingContext.jsx';

function ImagePicker({ label, file, onChange, error }) {
  return (
    <label className="upload-field">
      <span className="upload-side">{label}</span>
      <span className="upload-title">{file?.name || `Add ${label.toLowerCase()} image`}</span>
      <span className="upload-help">JPG or PNG · up to 10 MB</span>
      <input type="file" accept="image/jpeg,image/png" onChange={(event) => onChange(event.target.files?.[0] || null)} />
      <FieldError>{error}</FieldError>
    </label>
  );
}

export default function DepositPage() {
  const { token } = useAuth();
  const { accounts, refreshAccounts } = useBanking();
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [frontFile, setFrontFile] = useState(null);
  const [backFile, setBackFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const selectedAccount = accounts.find((account) => String(account.id) === accountId);

  async function submit(event) {
    event.preventDefault();
    const nextErrors = {};
    if (!accountId) nextErrors.accountId = 'Choose an account.';
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) nextErrors.amount = 'Enter a deposit amount greater than zero.';
    if (!frontFile) nextErrors.frontFile = 'Add the front image of the check.';
    if (!backFile) nextErrors.backFile = 'Add the back image of the check.';
    for (const [key, file] of [['frontFile', frontFile], ['backFile', backFile]]) {
      if (file && !['image/jpeg', 'image/png'].includes(file.type)) nextErrors[key] = 'Choose a JPG or PNG image.';
      else if (file && file.size > 10 * 1024 * 1024) nextErrors[key] = 'Image must be 10 MB or smaller.';
    }
    setErrors(nextErrors);
    setMessage('');
    if (Object.keys(nextErrors).length) return;

    setBusy(true);
    try {
      await apiRequest('/deposits', {
        token,
        method: 'POST',
        body: { accountId: Number(accountId), amount: Number(amount), frontImageName: frontFile.name, backImageName: backFile.name }
      });
      setMessage('Deposit submitted. It will appear as pending while it is reviewed.');
      setAmount('');
      setFrontFile(null);
      setBackFile(null);
      event.target.reset();
      await refreshAccounts();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeading eyebrow="MOBILE DEPOSIT" title="Deposit a check">Check deposits are deposited after you snap it.</PageHeading>
      <div className="form-layout">
        <form className="form-panel form-stack" onSubmit={submit} noValidate>
          {message && <div className={message.startsWith('Deposit submitted') ? 'inline-banner success-banner' : 'inline-banner error-banner'} role="status">{message}</div>}
          {selectedAccount?.status === 'view-only' && <div className="inline-banner error-banner" role="status">Deposits are disabled for this new view-only account. No funds can be accepted.</div>}
          <div className="field-row upload-row"><div><ImagePicker label="Front" file={frontFile} onChange={setFrontFile} error={errors.frontFile} /></div><div><ImagePicker label="Back" file={backFile} onChange={setBackFile} error={errors.backFile} /></div></div>
          <div><AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} label="Deposit to" /><FieldError>{errors.accountId}</FieldError></div>
          <label className="field"><span>Check amount</span><span className="input-prefix"><span>$</span><input type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} /></span><FieldError>{errors.amount}</FieldError></label>
          <button className="button primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit deposit'}</button>
        </form>
        <aside className="form-aside"><span className="aside-symbol">▤</span><p className="eyebrow">CHECK DEPOSIT</p><h2>Image guidance</h2><ul><li>Place the check on a flat, well-lit surface.</li><li>Keep all four edges visible and the text in focus.</li><li>Write “For mobile deposit” on the back before endorsing.</li></ul><p className="aside-disclaimer">This process check images if it is correct.</p></aside>
      </div>
    </>
  );
}