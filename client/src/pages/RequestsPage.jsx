import { useEffect, useState } from 'react';
import { apiRequest } from '../api.js';
import { formatDate, InlineError, PageHeading } from '../components/BankingUI.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function RequestsPage() {
  const { token } = useAuth();
  const [requests, setRequests] = useState([]);
  const [eventsByRequest, setEventsByRequest] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('all');

  async function loadRequests() {
    const result = await apiRequest('/transfers', { token });
    setRequests(result.transfers);
  }

  useEffect(() => {
    loadRequests().catch((requestError) => setError(requestError.message));
  }, [token]);

  async function toggleHistory(requestId) {
    if (expandedId === requestId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(requestId);
    if (eventsByRequest[requestId]) return;
    try {
      const result = await apiRequest(`/transfers/${requestId}/history`, { token });
      setEventsByRequest((current) => ({ ...current, [requestId]: result.events }));
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function cancelRequest(requestId) {
    setBusyId(requestId);
    setError('');
    setNotice('');
    try {
      await apiRequest(`/transfers/${requestId}/cancel`, { token, method: 'PATCH', body: {} });
      setNotice('Request cancelled. No funds moved.');
      setEventsByRequest((current) => ({ ...current, [requestId]: null }));
      await loadRequests();
      const history = await apiRequest(`/transfers/${requestId}/history`, { token });
      setEventsByRequest((current) => ({ ...current, [requestId]: history.events }));
      setExpandedId(requestId);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyId(null);
    }
  }

  const filters = [
    { value: 'all', label: 'All' },
    { value: 'pending', label: 'Pending' },
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'cancelled', label: 'Cancelled' }
  ];
  const visibleRequests = filter === 'all' ? requests : requests.filter((item) => item.status === filter);
  const statusLabel = (status) => status === 'pending'
    ? 'pending review'
    : status === 'approved' ? 'approved for simulation' : status;

  return (
    <>
      <PageHeading eyebrow="REQUEST ACTIVITY" title="Transfer requests">Track submissions, review events, and cancel requests that are still pending.</PageHeading>
      {error && <InlineError>{error}</InlineError>}
      {notice && <div className="inline-banner success-banner" role="status">{notice}</div>}
      <div className="request-safety-note"><span className="security-dot" /><span>Review outcomes are simulated. No requests move funds; external recipients are unverified.</span></div>
      <div className="request-filters" role="group" aria-label="Filter requests by status">
        {filters.map((item) => {
          const count = item.value === 'all' ? requests.length : requests.filter((request) => request.status === item.value).length;
          return <button type="button" className={filter === item.value ? 'request-filter active' : 'request-filter'} aria-pressed={filter === item.value} key={item.value} onClick={() => setFilter(item.value)}>{item.label}<span>{count}</span></button>;
        })}
      </div>
      <section className="request-list" aria-label="Transfer and payment requests">
        {visibleRequests.map((item) => (
          <article className="request-row" key={item.id}>
            <div className="request-main">
              <span className="request-type-mark">{item.requestType === 'Bill payment' ? 'B' : 'T'}</span>
              <div className="request-details">
                <div className="request-title-line"><h2>{item.requestType}</h2><span className={`status status-${item.status}`}>{statusLabel(item.status)}</span></div>
                <p>From {item.sourceType} ending {item.sourceLast4} to {item.destinationName}{item.destinationInstitution !== 'Your bank' ? ` · ${item.destinationInstitution}` : ''}</p>
                <div className="request-meta"><span>Requested {formatDate(item.createdAt.slice(0, 10))}</span><span>{item.frequency === 'once' ? 'One time' : 'Recurring'} · for {formatDate(item.scheduledDate)}</span></div>
                {item.reviewNote && <p className="request-review-note">Review note: {item.reviewNote}</p>}
              </div>
              <div className="request-amount">${Number(item.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
            <div className="request-actions">
              <button type="button" className="text-button" onClick={() => toggleHistory(item.id)}>{expandedId === item.id ? 'Hide history' : 'View history'}</button>
              {item.status === 'pending' && <button type="button" className="button danger-outline" disabled={busyId === item.id} onClick={() => cancelRequest(item.id)}>{busyId === item.id ? 'Cancelling…' : 'Cancel request'}</button>}
            </div>
            {expandedId === item.id && (
              <div className="request-history">
                <p className="eyebrow">AUDIT HISTORY</p>
                {(eventsByRequest[item.id] || []).map((event, index) => (
                  <div className="request-event" key={`${event.eventType}-${event.createdAt}-${index}`}>
                    <span className={`event-marker event-${event.eventType}`} />
                    <div><strong>{event.eventType === 'submitted' ? 'Request submitted' : event.eventType === 'cancelled' ? 'Request cancelled' : event.eventType === 'approved' ? 'Approved for simulation' : 'Request rejected'}</strong><p>{event.note}</p></div>
                    <time>{event.createdAt.replace('T', ' ').slice(0, 16)}</time>
                  </div>
                ))}
                {!eventsByRequest[item.id] && <span className="muted">Loading history…</span>}
              </div>
            )}
          </article>
        ))}
        {requests.length > 0 && !visibleRequests.length && <div className="empty-state">No {filter} requests.</div>}
        {!requests.length && <div className="empty-state">No transfer or bill payment requests yet.</div>}
      </section>
    </>
  );
}