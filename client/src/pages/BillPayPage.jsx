import { useEffect, useState } from 'react';
import { apiRequest } from '../api.js';
import { AccountSelect, FieldError, InlineError, PageHeading, localDate } from '../components/BankingUI.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBanking } from '../contexts/BankingContext.jsx';

export default function BillPayPage() {
  const today = localDate();
  const { token } = useAuth();
  const { accounts, refreshAccounts } = useBanking();
  const [payees, setPayees] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [payeeId, setPayeeId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [frequency, setFrequency] = useState('once');
  const [newPayee, setNewPayee] = useState({ name: '', accountLast4: '', bankName: '' });
  const [formErrors, setFormErrors] = useState({});
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [addingPayee, setAddingPayee] = useState(false);

  async function loadPayees() {
    const result = await apiRequest('/payees', { token });
    setPayees(result.payees);
  }

  useEffect(() => { loadPayees().catch((requestError) => setError(requestError.message)); }, [token]);

  async function addPayee(event) {
    event.preventDefault();
    const errors = {};
    if (newPayee.name.trim().length < 2) errors.name = 'Enter the payee name.';
    if (!/^\d{4}$/.test(newPayee.accountLast4)) errors.accountLast4 = 'Enter four digits.';
    if (newPayee.bankName.trim().length < 2) errors.bankName = 'Enter the bank name.';
    setFormErrors(errors);
    setError('');
    setNotice('');
    if (Object.keys(errors).length) return;
    setAddingPayee(true);
    try {
      const result = await apiRequest('/payees', { token, method: 'POST', body: newPayee });
      setPayees((items) => [...items, result.payee].sort((a, b) => a.name.localeCompare(b.name)));
      setPayeeId(String(result.payee.id));
      setNewPayee({ name: '', accountLast4: '', bankName: '' });
      setNotice('Payee added.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setAddingPayee(false);
    }
  }

  async function schedulePayment(event) {
    event.preventDefault();
    const errors = {};
    if (!accountId) errors.accountId = 'Choose a payment account.';
    if (!payeeId) errors.payeeId = 'Choose a payee.';
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) errors.amount = 'Enter an amount greater than zero.';
    if (!date) errors.date = 'Choose a payment date.';
    else if (date < today) errors.date = 'Choose today or a future date.';
    setFormErrors(errors);
    setError('');
    setNotice('');
    if (Object.keys(errors).length) return;
    setBusy(true);
    try {
      await apiRequest('/billpay', { token, method: 'POST', body: { accountId: Number(accountId), payeeId: Number(payeeId), amount: Number(amount), scheduledDate: date, frequency } });
      setNotice('Payment is pending review. No funds have moved.');
      setAmount('');
      await refreshAccounts();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeading eyebrow="PAYMENTS" title="Bill pay">Schedule mock payments for review; no funds leave your account.</PageHeading>
      {error && <InlineError>{error}</InlineError>}{notice && <div className="inline-banner success-banner" role="status">{notice}</div>}
      <section className="section-block payee-section">
        <div className="section-title-row"><div><p className="eyebrow">SAVED PAYEES</p><h2>Payees</h2></div><span className="small-count">{payees.length} saved</span></div>
        <div className="payee-list">{payees.map((payee) => <div className="payee-row" key={payee.id}><span className="payee-avatar">{payee.name[0].toUpperCase()}</span><span><strong>{payee.name}</strong><small>{payee.bankName} · •••• {payee.accountLast4}</small></span><button className="text-button" onClick={() => { setPayeeId(String(payee.id)); document.getElementById('schedule-payment')?.scrollIntoView({ behavior: 'smooth' }); }}>Pay</button></div>)}{!payees.length && <div className="empty-state">No saved payees yet.</div>}</div>
      </section>
      <div className="billpay-grid">
        <form className="form-panel form-stack" id="schedule-payment" onSubmit={schedulePayment} noValidate>
          <p className="eyebrow">NEW PAYMENT</p><h2>Schedule a payment</h2>
          <div><AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} label="Pay from" /><FieldError>{formErrors.accountId}</FieldError></div>
          <label className="field"><span>Payee</span><select value={payeeId} onChange={(event) => setPayeeId(event.target.value)}><option value="">Select a payee</option>{payees.map((payee) => <option key={payee.id} value={payee.id}>{payee.name} · {payee.bankName}</option>)}</select><FieldError>{formErrors.payeeId}</FieldError></label>
          <label className="field"><span>Amount</span><span className="input-prefix"><span>$</span><input type="number" min="0.01" step="0.01" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} /></span><FieldError>{formErrors.amount}</FieldError></label>
          <div className="field-row"><label className="field"><span>Frequency</span><select value={frequency} onChange={(event) => setFrequency(event.target.value)}><option value="once">One time</option><option value="recurring">Recurring</option></select></label><label className="field"><span>Payment date</span><input type="date" min={today} value={date} onChange={(event) => setDate(event.target.value)} /><FieldError>{formErrors.date}</FieldError></label></div>
          <button className="button primary" disabled={busy || !payees.length}>{busy ? 'Scheduling…' : 'Schedule payment'}</button>
        </form>
        <form className="form-panel form-stack add-payee-form" onSubmit={addPayee} noValidate>
          <p className="eyebrow">DIRECTORY</p><h2>Add a payee</h2>
          <label className="field"><span>Payee name</span><input value={newPayee.name} onChange={(event) => setNewPayee({ ...newPayee, name: event.target.value })} /><FieldError>{formErrors.name}</FieldError></label>
          <label className="field"><span>Account last four</span><input inputMode="numeric" maxLength={4} value={newPayee.accountLast4} onChange={(event) => setNewPayee({ ...newPayee, accountLast4: event.target.value.replace(/\D/g, '').slice(0, 4) })} /><FieldError>{formErrors.accountLast4}</FieldError></label>
          <label className="field"><span>Bank name</span><input value={newPayee.bankName} onChange={(event) => setNewPayee({ ...newPayee, bankName: event.target.value })} /><FieldError>{formErrors.bankName}</FieldError></label>
          <button className="button secondary" disabled={addingPayee}>{addingPayee ? 'Adding…' : 'Add payee'}</button>
        </form>
      </div>
    </>
  );
}