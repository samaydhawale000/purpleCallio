'use client';

import { FormEvent, useState } from 'react';
import { Plus } from 'lucide-react';
import { listAdminFeatures, upsertFeature, type AdminFeature } from '../../../lib/admin-billing';
import { Button } from '../../../components/ui/Button';
import { ToastHost, type ToastState } from '../../../dashboard/billing/Toast';
import { Checkbox, ErrorText, Field, inputCls, linkBtn, Modal, Panel, rowCls, Spinner, StatusBadge, Table, tdCls, useAdminErrorHandler, useResource } from './ui';

export function FeaturesTab() {
  const { data, loading, error, reload } = useResource(listAdminFeatures, []);
  const [editing, setEditing] = useState<AdminFeature | 'new' | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  if (loading) return <Spinner />;
  if (error || !data) return <ErrorText>{error || 'Failed to load features'}</ErrorText>;

  return (
    <>
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
      <Panel
        title="Feature registry"
        subtitle="Features plans can include. Plans reference features by key; inactive features stay on existing plans but can't be newly offered."
        actions={
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus size={14} /> Add feature
          </Button>
        }
      >
        <Table headers={['Key', 'Name', 'Category', 'Order', 'Status', 'Visibility', '']} empty={data.length === 0 ? 'No features yet.' : undefined}>
          {data.map((f) => (
            <tr key={f.key} className={rowCls}>
              <td className={`${tdCls} font-mono text-xs`}>{f.key}</td>
              <td className={tdCls}>
                <span className="text-[#170B2E]">{f.name}</span>
                {f.description && <div className="text-[11px]">{f.description}</div>}
              </td>
              <td className={tdCls}>{f.category ?? '—'}</td>
              <td className={tdCls}>{f.displayOrder}</td>
              <td className={tdCls}><StatusBadge status={f.isActive ? 'ACTIVE' : 'INACTIVE'} /></td>
              <td className={tdCls}>{f.isPublic ? 'Public' : 'Hidden'}</td>
              <td className={tdCls}>
                <button className={linkBtn} onClick={() => setEditing(f)}>Edit</button>
              </td>
            </tr>
          ))}
        </Table>
      </Panel>
      {editing && (
        <FeatureForm
          feature={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setToast({ id: Date.now(), type: 'success', message: 'Feature saved' });
            reload();
          }}
        />
      )}
    </>
  );
}

function FeatureForm({ feature, onClose, onSaved }: { feature: AdminFeature | null; onClose: () => void; onSaved: () => void }) {
  const handle = useAdminErrorHandler();
  const [key, setKey] = useState(feature?.key ?? '');
  const [name, setName] = useState(feature?.name ?? '');
  const [description, setDescription] = useState(feature?.description ?? '');
  const [category, setCategory] = useState(feature?.category ?? '');
  const [order, setOrder] = useState(String(feature?.displayOrder ?? 0));
  const [active, setActive] = useState(feature?.isActive ?? true);
  const [isPublic, setIsPublic] = useState(feature?.isPublic ?? true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const k = key.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,62}$/.test(k)) return setError('Key must be UPPER_SNAKE_CASE (e.g. CALL_RECORDING).');
    if (!name.trim()) return setError('Name is required.');
    if (!Number.isInteger(Number(order))) return setError('Display order must be a whole number.');
    setSaving(true);
    try {
      await upsertFeature({
        key: k,
        name: name.trim(),
        description: description.trim() || null,
        category: category.trim() || null,
        displayOrder: Number(order),
        isActive: active,
        isPublic,
      });
      onSaved();
    } catch (err) {
      setError(handle(err, 'Failed to save feature'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={feature ? `Edit ${feature.name}` : 'Add feature'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Key" hint={feature ? 'Keys cannot change — plans reference them.' : 'UPPER_SNAKE_CASE. Cannot be changed later.'}>
          <input className={`${inputCls} font-mono`} value={key} disabled={!!feature} onChange={(e) => setKey(e.target.value.toUpperCase())} />
        </Field>
        <Field label="Name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description">
          <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Category">
            <input className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)} />
          </Field>
          <Field label="Display order">
            <input type="number" className={inputCls} value={order} onChange={(e) => setOrder(e.target.value)} />
          </Field>
        </div>
        <Checkbox label="Active" checked={active} onChange={setActive} />
        <Checkbox label="Public (listed on the pricing page)" checked={isPublic} onChange={setIsPublic} />
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          <Button type="submit" loading={saving}>Save</Button>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
