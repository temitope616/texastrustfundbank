import { useEffect, useState } from 'react';
import { apiRequest } from '../api.js';
import { InlineError, PageHeading } from '../components/BankingUI.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function ReviewQueuePage() {
  const { token } = useAuth();
  const [requests, setRequests] = useState([]);
  const [notes, setNotes] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadQueue() {
    setError('');
    try {
      const result = await apiRequest('/review/transfers', { token });
      setRequests(result.transfers);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadQueue(); }, [token]);

  async function decide(requestId, decision) {
    setBusyId(requestId);
    setError('');
    setNotice('');
    try {
      await apiRequest(`/review/transfers/${requestId}`, {
        token,
        method: 'PATCH',
        body: { decision, note: notes[requestId] || '' }
      });
      setNotice(decision === 'approved'
        ? 'Approved for simulated processing. No funds moved.'
        : 'Request rejected. No funds moved.');
      await loadQueue();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeading eyebrow="REVIEW OPERATIONS" title="Transfer review">Review requests submitted by customer accounts.</PageHeading>
      {error && <InlineError>{error}</InlineError>}
      {notice && <div className="inline-banner success-banner" role="status">{notice}</div>}
      <div className="request-safety-note"><span className="security-dot" /><span>Approvals only mark a request ready for simulated processing. This review console cannot move funds.</span></div>
      <section className="review-queue" aria-label="Pending transfer requests">
        {requests.map((item) => (
          <article className="review-item" key={item.id}>
            <div className="review-item-heading"><div><p className="eyebrow">{item.requestType} · REQUEST #{item.id}</p><h2>{item.customerName}</h2><span className="review-email">{item.customerEmail}</span></div><strong className="request-amount">${Number(item.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
            <div className="review-meta"><span>From {item.sourceType} ending {item.sourceLast4}</span><span>To {item.destinationName}</span><span>{item.destinationInstitution}</span><span>{item.frequency === 'once' ? 'One time' : 'Recurring'} · {item.scheduledDate}</span></div>
            <label className="field review-note-field"><span>Decision note <span className="muted">(optional, max 240 characters)</span></span><textarea rows="2" maxLength="240" value={notes[item.id] || ''} onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Add context for the audit history" /></label>
            <div className="review-actions"><button className="button secondary" disabled={busyId === item.id} onClick={() => decide(item.id, 'rejected')}>{busyId === item.id ? 'Saving…' : 'Reject request'}</button><button className="button primary" disabled={busyId === item.id} onClick={() => decide(item.id, 'approved')}>{busyId === item.id ? 'Saving…' : 'Approve for simulation'}</button></div>
          </article>
        ))}
        {!loading && !requests.length && <div className="empty-state">No pending requests to review.</div>}
      </section>
    </>
  );
}