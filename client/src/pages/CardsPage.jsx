import { useEffect, useState } from 'react';
import { apiRequest } from '../api.js';
import { InlineError, PageHeading } from '../components/BankingUI.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function CardsPage() {
  const { token } = useAuth();
  const [cards, setCards] = useState([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  async function loadCards() {
    try {
      const result = await apiRequest('/cards', { token });
      setCards(result.cards);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => { loadCards(); }, [token]);

  async function changeStatus(card, status) {
    setError('');
    setBusyId(card.id);
    try {
      const result = await apiRequest(`/cards/${card.id}`, { token, method: 'PATCH', body: { status } });
      setCards((items) => items.map((item) => item.id === card.id ? { ...item, status: result.card.status } : item));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeading eyebrow="CARD MANAGEMENT" title="Your cards">Manage your debit cards.</PageHeading>
      <InlineError>{error}</InlineError>
      <div className="cards-list">
        {cards.map((card, index) => (
          <article className="debit-card-row" key={card.id}>
            <div className={`debit-card-art card-art-${index % 2}`}><div className="card-art-top"><span>TEXAS TRUST</span><span>NOT VALID</span></div><div className="chip-mark" /><div className="card-number">•••• &nbsp;•••• &nbsp;•••• &nbsp;{card.last4}</div><div className="card-art-bottom"><span>BANK CARD</span><span>TEST</span></div></div>
            <div className="card-info"><div className="card-info-heading"><div><p className="eyebrow">{card.accountType === 'checking' ? 'EVERYDAY CHECKING' : 'GROWTH SAVINGS'}</p><h2>Debit card ending {card.last4}</h2></div><span className={`status status-${card.status}`}>{card.status}</span></div><p className="muted card-expiry">Expires {card.expiryDate}</p><div className="card-actions">{card.status !== 'lost' && <button className="button secondary" onClick={() => changeStatus(card, card.status === 'locked' ? 'active' : 'locked')} disabled={busyId === card.id}>{busyId === card.id ? 'Updating…' : card.status === 'locked' ? 'Unlock card' : 'Lock card'}</button>}{card.status !== 'lost' && <button className="button danger-outline" onClick={() => changeStatus(card, 'lost')} disabled={busyId === card.id}>Report lost</button>}</div></div>
          </article>
        ))}
        {!cards.length && <div className="empty-state">No cards found.</div>}
      </div>
    </>
  );
}