import { useEffect, useState } from 'react';
import { apiRequest } from '../api.js';
import { AccountSelect, FieldError, InlineError, PageHeading, formatMoney, localDate } from '../components/BankingUI.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBanking } from '../contexts/BankingContext.jsx';

export default function TransferPage() {
  const today = localDate();
  const { token } = useAuth();
  const { accounts, refreshAccounts } = useBanking();
  const [payees, setPayees] = useState([]);
  const [fromAccountId, setFromAccountId] = useState('');
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState('once');
  const [scheduledDate, setScheduledDate] = useState(today);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiRequest('/payees', { token }).then((result) => setPayees(result.payees)).catch(() => setPayees([]));
  }, [token]);

  const source = accounts.find((account) => String(account.id) === fromAccountId);
  const sourceIsViewOnly = source?.status === 'view-only';
  const internalAccounts = accounts.filter((account) => String(account.id) !== fromAccountId);

  function validate() {
    const errors = {};
    if (!fromAccountId) errors.fromAccountId = 'Select a source account.';
    if (!destination) errors.destination = 'Select a destination.';
    if (destination.startsWith('account:') && destination.slice(8) === fromAccountId) errors.destination = 'Choose a different destination account.';
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) errors.amount = 'Enter an amount greater than zero.';
    else if (source && Number(amount) > Number(source.available_balance)) errors.amount = 'This exceeds your available balance.';
    if (!scheduledDate) errors.scheduledDate = 'Choose a transfer date.';
    else if (scheduledDate < today) errors.scheduledDate = 'Choose today or a future date.';
    return errors;
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    const [destinationType, destinationId] = destination.split(':');
    const body = {
      fromAccountId: Number(fromAccountId),
      amount: Number(amount),
      frequency,
      scheduledDate,
      ...(destinationType === 'account' ? { toAccountId: Number(destinationId) } : { payeeId: Number(destinationId) })
    };
    setBusy(true);
    try {
      const result = await apiRequest('/transfers', { token, method: 'POST', body });
      setSuccess(result.transfer.message);
      setAmount('');
      setDestination('');
      await refreshAccounts();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeading eyebrow="MOVE MONEY" title="Transfer money">Submit a mock transfer request for review. Money movement is disabled.</PageHeading>
      <div className="form-layout">
        <form className="form-panel form-stack" onSubmit={submit} noValidate>
          <InlineError>{error}</InlineError>
          {sourceIsViewOnly && <InlineError> Withdrawals and transfers are disabled.</InlineError>}
          {success && <div className="inline-banner success-banner" role="status">{success}</div>}
          <div><AccountSelect accounts={accounts} value={fromAccountId} onChange={(value) => { setFromAccountId(value); setFieldErrors({ ...fieldErrors, fromAccountId: '', amount: '' }); }} label="From account" /><FieldError>{fieldErrors.fromAccountId}</FieldError></div>
          <label className="field"><span>To</span><select value={destination} onChange={(event) => setDestination(event.target.value)} required><option value="">Choose a destination</option><optgroup label="My accounts">{internalAccounts.map((account) => <option value={`account:${account.id}`} key={account.id}>{account.type === 'checking' ? 'Checking' : 'Savings'} •••• {account.last4}</option>)}</optgroup><optgroup label="External accounts">{payees.map((payee) => <option value={`payee:${payee.id}`} key={payee.id}>{payee.name} · {payee.bankName}</option>)}</optgroup></select><FieldError>{fieldErrors.destination}</FieldError></label>
          <label className="field"><span>Amount</span><span className="input-prefix"><span>$</span><input inputMode="decimal" type="number" min="0.01" step="0.01" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} /></span><FieldError>{fieldErrors.amount}</FieldError>{source && <small className="field-hint">Available: {formatMoney(source.available_balance)}</small>}</label>
          <div className="field-row"><label className="field"><span>Frequency</span><select value={frequency} onChange={(event) => setFrequency(event.target.value)}><option value="once">One time</option><option value="recurring">Recurring</option></select></label><label className="field"><span>Date</span><input type="date" min={today} value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)} /><FieldError>{fieldErrors.scheduledDate}</FieldError></label></div>
          <div className="form-actions"><button className="button primary" disabled={busy || sourceIsViewOnly || (internalAccounts.length === 0 && payees.length === 0)}>{busy ? 'Submitting…' : 'Submit transfer request'}</button><span className="secure-label"><span className="security-dot" /> Security review</span></div>
        </form>
        <aside className="form-aside"><span className="aside-symbol">↗</span><p className="eyebrow">TRANSFER DETAILS</p><h2>Pending review</h2><ul><li>Every transfer request remains pending; no money moves out of either account.</li><li>Approvals only mark a request ready for processing.</li><li>Do not enter full account or routing numbers.</li></ul></aside>
      </div>
    </>
  );
}