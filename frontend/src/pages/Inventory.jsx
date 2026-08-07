import { useEffect, useState, useCallback } from 'react';
import { api, getCurrentUser, openPrintableDocument } from '../api/client';

const LOUNGE_NAME = 'Juba International Airport VIP Lounge';

const CATEGORY_LABELS = {
  food: 'Food',
  non_alcoholic: 'Non-alcoholic drinks',
  alcoholic: 'Alcoholic drinks',
  supplies: 'VIP supplies',
};
const CATEGORY_ORDER = ['food', 'non_alcoholic', 'alcoholic', 'supplies'];

function printStockList(items) {
  const rowsHtml = items.map(item => `
    <tr>
      <td>${CATEGORY_LABELS[item.category]}</td>
      <td>${item.name}</td>
      <td>${Number(item.current_stock)} ${item.unit}</td>
      <td>${Number(item.reorder_level)} ${item.unit}</td>
      <td>${Number(item.current_stock) <= 0 ? 'Out of stock' : item.low_stock ? 'Low stock' : 'OK'}</td>
    </tr>
  `).join('');
  const html = `
    <div class="doc-header">
      <div><div class="eyebrow">Stock list</div><h1>${LOUNGE_NAME}</h1></div>
      <div class="doc-meta">Generated ${new Date().toLocaleString()}<br />${items.length} items</div>
    </div>
    <table>
      <thead><tr><th>Category</th><th>Item</th><th>Current stock</th><th>Reorder level</th><th>Status</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
  openPrintableDocument('Stock list', html);
}

function printMovements(item, transactions) {
  const rowsHtml = transactions.map(t => `
    <tr>
      <td>${new Date(t.created_at).toLocaleString()}</td>
      <td>${t.reason}</td>
      <td>${Number(t.change_amount) > 0 ? '+' : ''}${Number(t.change_amount)} ${item.unit}</td>
      <td>${t.created_by_name || '—'}</td>
      <td>${t.notes || '—'}</td>
    </tr>
  `).join('');
  const html = `
    <div class="doc-header">
      <div><div class="eyebrow">Stock movements</div><h1>${item.name}</h1></div>
      <div class="doc-meta">${LOUNGE_NAME}<br />Generated ${new Date().toLocaleString()}</div>
    </div>
    <table>
      <thead><tr><th>Date</th><th>Reason</th><th>Amount</th><th>By</th><th>Notes</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
  openPrintableDocument(`Movements — ${item.name}`, html);
}

function AddItemForm({ onCreated, onCancel }) {
  const [form, setForm] = useState({ name: '', category: 'food', unit: 'pcs', current_stock: '', reorder_level: '', unit_cost: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.createInventoryItem({
        ...form,
        current_stock: Number(form.current_stock || 0),
        reorder_level: Number(form.reorder_level || 0),
        unit_cost: form.unit_cost ? Number(form.unit_cost) : null,
      });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="card no-print" style={{ marginBottom: 12 }}>
      <label>Item name</label>
      <input required value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} />
      <label>Category</label>
      <select value={form.category} onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}>
        {CATEGORY_ORDER.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
      </select>
      <div className="grid grid-2">
        <div>
          <label>Unit (pcs, bottle, tot, kg...)</label>
          <input value={form.unit} onChange={(e) => setForm(f => ({ ...f, unit: e.target.value }))} />
        </div>
        <div>
          <label>Starting stock</label>
          <input type="number" step="0.01" value={form.current_stock} onChange={(e) => setForm(f => ({ ...f, current_stock: e.target.value }))} />
        </div>
        <div>
          <label>Reorder level</label>
          <input type="number" step="0.01" value={form.reorder_level} onChange={(e) => setForm(f => ({ ...f, reorder_level: e.target.value }))} />
        </div>
        <div>
          <label>Unit cost ($, optional)</label>
          <input type="number" step="0.01" value={form.unit_cost} onChange={(e) => setForm(f => ({ ...f, unit_cost: e.target.value }))} />
        </div>
      </div>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      <button type="submit" disabled={saving}>{saving ? 'Adding...' : 'Add item'}</button>{' '}
      <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
    </form>
  );
}

function ItemDetail({ item, onAdjusted }) {
  const [transactions, setTransactions] = useState([]);
  const [form, setForm] = useState({ change_amount: '', reason: 'consumption', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadTransactions = useCallback(() => {
    api.itemTransactions(item.id).then(setTransactions).catch(() => setTransactions([]));
  }, [item.id]);

  useEffect(loadTransactions, [loadTransactions]);

  async function submitAdjust(e) {
    e.preventDefault();
    setError('');
    const rawAmount = Number(form.change_amount);
    if (!rawAmount) { setError('Enter a non-zero amount'); return; }
    // Consumption/waste are always a deduction — let the person type a positive number and we
    // apply the sign, so "log 5 samosas consumed" doesn't require them to type -5.
    const signedAmount = ['consumption', 'waste'].includes(form.reason) ? -Math.abs(rawAmount) : Math.abs(rawAmount);
    setSaving(true);
    try {
      await api.adjustInventoryItem(item.id, { change_amount: signedAmount, reason: form.reason, notes: form.notes });
      setForm({ change_amount: '', reason: form.reason, notes: '' });
      loadTransactions();
      onAdjusted();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const outOfStock = Number(item.current_stock) <= 0;
  const lowStock = item.low_stock && !outOfStock;

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: 0 }}>{item.name}</h2>
            <p style={{ color: 'var(--text-muted)', margin: '4px 0 0', fontSize: 13 }}>{CATEGORY_LABELS[item.category]}</p>
          </div>
          {outOfStock && <span className="badge badge-danger">Out of stock</span>}
          {lowStock && <span className="badge badge-warning">Below reorder level</span>}
        </div>

        <div className="grid grid-2" style={{ marginTop: 16 }}>
          <div className={`stat-card ${outOfStock || lowStock ? 'stat-alert' : ''}`}>
            <div className="stat-value">{Number(item.current_stock).toFixed(item.unit === 'kg' || item.unit === 'liter' ? 2 : 0)} {item.unit}</div>
            <div className="stat-label">Current stock</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{Number(item.reorder_level).toFixed(item.unit === 'kg' || item.unit === 'liter' ? 2 : 0)} {item.unit}</div>
            <div className="stat-label">Reorder level</div>
          </div>
        </div>
      </div>

      <div className="card no-print">
        <h3>Log a stock movement</h3>
        <form onSubmit={submitAdjust} className="grid grid-3" style={{ alignItems: 'end' }}>
          <div>
            <label>Reason</label>
            <select value={form.reason} onChange={(e) => setForm(f => ({ ...f, reason: e.target.value }))}>
              <option value="consumption">Consumption (used in service)</option>
              <option value="waste">Waste / spoilage</option>
              <option value="restock">Restock (delivery received)</option>
              <option value="adjustment">Correction / stocktake adjustment</option>
            </select>
          </div>
          <div>
            <label>Amount ({item.unit})</label>
            <input required type="number" step="0.01" min="0.01" value={form.change_amount} onChange={(e) => setForm(f => ({ ...f, change_amount: e.target.value }))} />
          </div>
          <div>
            <label>Notes (optional)</label>
            <input value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Log movement'}</button>
        </form>
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Recent movements</h3>
          <button className="secondary no-print" style={{ padding: '5px 12px', fontSize: 12 }} onClick={() => printMovements(item, transactions)}>Print</button>
        </div>
        <table>
          <thead><tr><th>Date</th><th>Reason</th><th>Amount</th><th>By</th><th>Notes</th></tr></thead>
          <tbody>
            {transactions.map(t => (
              <tr key={t.id}>
                <td>{new Date(t.created_at).toLocaleString()}</td>
                <td>{t.reason}</td>
                <td style={{ color: Number(t.change_amount) < 0 ? 'var(--danger)' : 'var(--success)' }}>
                  {Number(t.change_amount) > 0 ? '+' : ''}{Number(t.change_amount)} {item.unit}
                </td>
                <td>{t.created_by_name || '—'}</td>
                <td>{t.notes || '—'}</td>
              </tr>
            ))}
            {transactions.length === 0 && <tr><td colSpan={5}>No movements logged yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Inventory() {
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const user = getCurrentUser();
  const isAdmin = user?.role === 'lounge_admin';

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    api.listInventoryItems()
      .then((data) => {
        setItems(data);
        if (!selectedId && data.length) setSelectedId(data[0].id);
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, [selectedId]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedItem = items.find(i => i.id === selectedId);
  const grouped = CATEGORY_ORDER.map(cat => ({ cat, items: items.filter(i => i.category === cat) })).filter(g => g.items.length);

  return (
    <div className="app-shell">
      <h1>Inventory</h1>
      <p style={{ color: 'var(--text-muted)' }}>Stock levels for food, drinks, and VIP supplies. Items below their reorder level are flagged automatically.</p>

      <div className="toolbar no-print" style={{ marginTop: -8 }}>
        <button className="secondary" onClick={() => printStockList(items)}>Print stock list</button>
      </div>

      {loadError && (
        <p style={{ color: 'var(--danger)' }}>Couldn't load inventory: {loadError} <button className="secondary" onClick={load}>Retry</button></p>
      )}

      {loading ? <p>Loading...</p> : (
        <div className="inventory-layout">
          <div className="inventory-menu">
            {isAdmin && (
              showAddForm ? (
                <AddItemForm onCreated={() => { setShowAddForm(false); load(); }} onCancel={() => setShowAddForm(false)} />
              ) : (
                <button className="secondary no-print" style={{ marginBottom: 12, width: '100%' }} onClick={() => setShowAddForm(true)}>+ Add item</button>
              )
            )}
            <div className="card" style={{ padding: 10 }}>
              {grouped.map(({ cat, items: catItems }) => (
                <div key={cat}>
                  <div className="inventory-category-label">{CATEGORY_LABELS[cat]}</div>
                  {catItems.map(item => {
                    const outOfStock = Number(item.current_stock) <= 0;
                    const lowStock = item.low_stock && !outOfStock;
                    return (
                      <div
                        key={item.id}
                        className={`inventory-item-row ${item.id === selectedId ? 'active' : ''} ${outOfStock ? 'out-of-stock' : lowStock ? 'low-stock' : ''}`}
                        onClick={() => setSelectedId(item.id)}
                      >
                        <span>{item.name}<br /><span className="inventory-item-unit">{Number(item.current_stock)} {item.unit}</span></span>
                        {outOfStock && <span className="stock-pill out">OUT</span>}
                        {lowStock && <span className="stock-pill low">LOW</span>}
                      </div>
                    );
                  })}
                </div>
              ))}
              {items.length === 0 && <p style={{ padding: 10, color: 'var(--text-muted)' }}>No items yet.</p>}
            </div>
          </div>

          <div className="inventory-detail">
            {selectedItem ? (
              <ItemDetail item={selectedItem} onAdjusted={load} />
            ) : (
              <div className="card">Select an item on the left to see its stock detail.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
