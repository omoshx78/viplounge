import { useEffect, useState } from 'react';
import { api } from '../api/client';

const empty = {
  passport_number: '', full_name: '', nationality: '', phone: '', email: '',
  direction: 'arrival', flight_number: '',
  sponsorship_type: 'individual', corporate_account_id: '',
  staff_consultant_id: '', department: '', branch_project: '', reference_number: '',
  payment_type: 'card',
  passport_image_data: '', staff_id_image_data: '',
  consent_accepted: false,
};

// Reads a File into a base64 data URL for upload — keeps this a pure front-end concern,
// no separate file-upload endpoint needed for this scaffold.
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const DATA_POLICY_TEXT = `We collect your name, passport/ID number, nationality, and contact
details to verify your lounge access and, where applicable, bill your sponsoring organisation.
If you upload a passport or staff ID photo, that image is used only to help lounge staff verify
your identity and is automatically deleted after 30 days — it is never shared outside the lounge
verification process. Your visit history (without document images) may be retained for longer to
support billing, reporting, and reconciliation with your travel agent or employer. You can ask the
lounge admin about your data at any time.`;

export default function CheckIn() {
  const [form, setForm] = useState(empty);
  const [corporateAccounts, setCorporateAccounts] = useState([]);
  const [returningNotice, setReturningNotice] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.listCorporateAccountsPublic().then(setCorporateAccounts).catch(() => {});
  }, []);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleFileChange(field, e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    update(field, dataUrl);
  }

  // Returning passenger: once they've typed a full passport number, look them up and
  // pre-fill everything so they only need to confirm flight details.
  async function handlePassportBlur() {
    if (!form.passport_number || form.passport_number.length < 5) return;
    try {
      const res = await api.lookupPassenger(form.passport_number);
      if (res.found) {
        setForm((f) => ({
          ...f,
          full_name: res.passenger.full_name,
          nationality: res.passenger.nationality || '',
          phone: res.passenger.phone || '',
          email: res.passenger.email || '',
          corporate_account_id: res.passenger.default_corporate_account_id || '',
          sponsorship_type: res.passenger.default_corporate_account_id ? 'corporate' : 'individual',
        }));
        setReturningNotice(true);
      } else {
        setReturningNotice(false);
      }
    } catch {
      // silent — lookup is a convenience, not a blocker
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await api.submitCheckin(form);
      setSubmitted(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="app-shell">
        <div className="card" style={{ textAlign: 'center' }}>
          <h1>You're checked in</h1>
          <p>Please proceed to the front desk — a member of staff will verify your passport and boarding pass to complete your entry.</p>
          <p style={{ color: 'var(--text-muted)' }}>Reference: {submitted.visit_id}</p>
          <button className="secondary" onClick={() => { setSubmitted(null); setForm(empty); setReturningNotice(false); }}>
            Check in another passenger
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="card">
        <h1>Lounge check-in</h1>
        <p style={{ color: 'var(--text-muted)' }}>Fill in your details below. This takes about a minute.</p>

        {returningNotice && (
          <div className="badge badge-success" style={{ marginBottom: 14 }}>
            Welcome back — we've pre-filled your details
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="grid grid-2">
            <div>
              <label>Passport / ID number</label>
              <input required value={form.passport_number} onBlur={handlePassportBlur}
                onChange={(e) => update('passport_number', e.target.value)} />
            </div>
            <div>
              <label>Full name</label>
              <input required value={form.full_name} onChange={(e) => update('full_name', e.target.value)} />
            </div>
            <div>
              <label>Nationality</label>
              <input value={form.nationality} onChange={(e) => update('nationality', e.target.value)} />
            </div>
            <div>
              <label>Phone</label>
              <input value={form.phone} onChange={(e) => update('phone', e.target.value)} />
            </div>
            <div>
              <label>Direction</label>
              <select value={form.direction} onChange={(e) => update('direction', e.target.value)}>
                <option value="arrival">Arriving</option>
                <option value="departure">Departing</option>
              </select>
            </div>
            <div>
              <label>Flight number</label>
              <input required value={form.flight_number} onChange={(e) => update('flight_number', e.target.value)} />
            </div>
          </div>

          <label>Sponsorship type</label>
          <select value={form.sponsorship_type} onChange={(e) => update('sponsorship_type', e.target.value)}>
            <option value="individual">Individual (I'll pay)</option>
            <option value="corporate">Corporate-sponsored</option>
          </select>

          {form.sponsorship_type === 'corporate' ? (
            <>
              <label>Company</label>
              <select required value={form.corporate_account_id} onChange={(e) => update('corporate_account_id', e.target.value)}>
                <option value="">Select your company...</option>
                {corporateAccounts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div className="grid grid-2">
                <div>
                  <label>Staff / consultant ID</label>
                  <input value={form.staff_consultant_id} onChange={(e) => update('staff_consultant_id', e.target.value)} />
                </div>
                <div>
                  <label>Department</label>
                  <input value={form.department} onChange={(e) => update('department', e.target.value)} />
                </div>
                <div>
                  <label>Branch / project</label>
                  <input value={form.branch_project} onChange={(e) => update('branch_project', e.target.value)} />
                </div>
                <div>
                  <label>Reference / PO number</label>
                  <input value={form.reference_number} onChange={(e) => update('reference_number', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-2">
                <div>
                  <label>Passport / ID photo (helps speed up verification)</label>
                  <input type="file" accept="image/*" capture="environment" onChange={(e) => handleFileChange('passport_image_data', e)} />
                  {form.passport_image_data && <p style={{ fontSize: 12, color: 'var(--success)' }}>Photo attached</p>}
                </div>
                <div>
                  <label>Staff / consultant ID card photo</label>
                  <input type="file" accept="image/*" capture="environment" onChange={(e) => handleFileChange('staff_id_image_data', e)} />
                  {form.staff_id_image_data && <p style={{ fontSize: 12, color: 'var(--success)' }}>Photo attached</p>}
                </div>
              </div>
            </>
          ) : (
            <>
              <label>Payment method</label>
              <select value={form.payment_type} onChange={(e) => update('payment_type', e.target.value)}>
                <option value="card">Card (pay at desk)</option>
                <option value="cash">Cash (pay at desk)</option>
              </select>
              <label>Passport / ID photo (optional)</label>
              <input type="file" accept="image/*" capture="environment" onChange={(e) => handleFileChange('passport_image_data', e)} />
              {form.passport_image_data && <p style={{ fontSize: 12, color: 'var(--success)' }}>Photo attached</p>}
            </>
          )}

          <details style={{ margin: '14px 0', fontSize: 13, color: 'var(--text-muted)' }}>
            <summary style={{ cursor: 'pointer', color: 'var(--text)' }}>Data policy / terms of use</summary>
            <p>{DATA_POLICY_TEXT}</p>
          </details>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <input
              type="checkbox"
              style={{ width: 'auto', marginBottom: 0 }}
              checked={form.consent_accepted}
              onChange={(e) => update('consent_accepted', e.target.checked)}
            />
            <span style={{ color: 'var(--text)' }}>I have read and accept the data policy / terms of use above</span>
          </label>

          {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
          <button type="submit" disabled={submitting || !form.consent_accepted}>{submitting ? 'Submitting...' : 'Submit check-in'}</button>
        </form>
      </div>
    </div>
  );
}
