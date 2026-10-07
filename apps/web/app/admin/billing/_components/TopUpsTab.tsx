'use client';

import { FormEvent, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  createTopUp,
  listAdminTopUps,
  optionalInt,
  paiseToRupeesInput,
  rupeesToPaise,
  updateTopUp,
  type AdminTopUp,
  type TopUpInput,
} from '../../../lib/admin-billing';
import { formatCredits, formatDate, formatMoney } from '../../../lib/billing';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { ToastHost, type ToastState } from '../../../dashboard/billing/Toast';
import { Checkbox, ErrorText, Field, inputCls, linkBtn, Modal, Panel, rowCls, Spinner, StatusBadge, Table, tdCls, useAdminErrorHandler, useResource } from './ui';

type Status = AdminTopUp['status'];

export function TopUpsTab() {
  const handle = useAdminErrorHandler();
  const { data, loading, error, reload } = useResource(listAdminTopUps, []);
  const [editing, setEditing] = useState<AdminTopUp | 'new' | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const setStatus = async (t: AdminTopUp, status: Status) => {
    try {
      await updateTopUp(t.id, { status });
      setToast({ id: Date.now(), type: 'success', message: `${t.name} is now ${status.toLowerCase()}` });
      reload();
    } catch (e) {
      const m = handle(e, 'Failed to update');
      if (m) setToast({ id: Date.now(), type: 'error', message: m });
    }
  };

  if (loading) return <Spinner />;
  if (error || !data) return <ErrorText>{error || 'Failed to load top-ups'}</ErrorText>;

  return (
    <>
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
      <Panel
        title="Top-up packages"
        subtitle="One-time credit packages customers can buy any time. Price and credit changes apply to future purchases only."
        actions={
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus size={14} /> New top-up
          </Button>
        }
      >
        <Table headers={['Package', 'Price', 'Credits', 'Status', 'Order', 'Purchases', 'Updated', 'Actions']} empty={data.length === 0 ? 'No top-up packages yet.' : undefined}>
          {data.map((t) => (
            <tr key={t.id} className={rowCls}>
              <td className={tdCls}>
                <span className="font-medium text-[#170B2E]">{t.name}</span>
                {t.isPopular && <Badge variant="purple" className="ml-2">Popular</Badge>}
                {t.description && <div className="text-[11px]">{t.description}</div>}
              </td>
              <td className={`${tdCls} text-[#170B2E]`}>{formatMoney(t.pricePaise, t.currency)}</td>
              <td className={tdCls}>{formatCredits(t.credits)}</td>
              <td className={tdCls}><StatusBadge status={t.status} /></td>
              <td className={tdCls}>{t.displayOrder}</td>
              <td className={tdCls}>{t.purchases}</td>
              <td className={tdCls}>{formatDate(t.updatedAt)}</td>
              <td className={tdCls}>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  <button className={linkBtn} onClick={() => setEditing(t)}>Edit</button>
                  {t.status !== 'ACTIVE' && <button className={linkBtn} onClick={() => setStatus(t, 'ACTIVE')}>Activate</button>}
                  {t.status === 'ACTIVE' && <button className={linkBtn} onClick={() => setStatus(t, 'INACTIVE')}>Deactivate</button>}
                  {t.status !== 'ARCHIVED' && (
                    <button
                      className="text-xs font-medium text-red-600 hover:text-red-800"
                      onClick={() => window.confirm(`Archive "${t.name}"? Customers can no longer buy it; past purchases are unaffected.`) && setStatus(t, 'ARCHIVED')}
                    >
                      Archive
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </Panel>
      {editing && (
        <TopUpForm
          topUp={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setToast({ id: Date.now(), type: 'success', message: 'Top-up saved' });
            reload();
          }}
        />
      )}
    </>
  );
}

function TopUpForm({ topUp, onClose, onSaved }: { topUp: AdminTopUp | null; onClose: () => void; onSaved: () => void }) {
  const handle = useAdminErrorHandler();
  const [name, setName] = useState(topUp?.name ?? '');
  const [description, setDescription] = useState(topUp?.description ?? '');
  const [price, setPrice] = useState(topUp ? paiseToRupeesInput(topUp.pricePaise) : '');
  const [credits, setCredits] = useState(topUp ? String(topUp.credits) : '');
  const [status, setStatus] = useState<Status>(topUp?.status ?? 'ACTIVE');
  const [order, setOrder] = useState(String(topUp?.displayOrder ?? 0));
  const [popular, setPopular] = useState(topUp?.isPopular ?? false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const pricePaise = rupeesToPaise(price);
    const creditsN = optionalInt(credits);
    const orderN = Number(order);
    if (!name.trim()) return setError('Name is required.');
    if (Number.isNaN(pricePaise) || pricePaise <= 0) return setError('Enter a price above ₹0.');
    if (creditsN == null || Number.isNaN(creditsN) || creditsN <= 0) return setError('Credits must be a whole number above zero.');
    if (!Number.isInteger(orderN)) return setError('Display order must be a whole number.');
    const input: TopUpInput = {
      name: name.trim(),
      description: description.trim() || null,
      pricePaise,
      credits: creditsN,
      status,
      displayOrder: orderN,
      isPopular: popular,
    };
    setSaving(true);
    try {
      if (topUp) await updateTopUp(topUp.id, input);
      else await createTopUp({ ...input, currency: 'INR' });
      onSaved();
    } catch (err) {
      setError(handle(err, 'Failed to save top-up'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={topUp ? `Edit ${topUp.name}` : 'New top-up'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description">
          <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Price (₹)" hint="GST is added at checkout.">
            <input inputMode="decimal" className={inputCls} value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label="Credits">
            <input type="number" min={1} className={inputCls} value={credits} onChange={(e) => setCredits(e.target.value)} />
          </Field>
          <Field label="Status">
            <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </Field>
          <Field label="Display order">
            <input type="number" className={inputCls} value={order} onChange={(e) => setOrder(e.target.value)} />
          </Field>
        </div>
        <Checkbox label="Highlight as popular" checked={popular} onChange={setPopular} />
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          <Button type="submit" loading={saving}>Save</Button>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
