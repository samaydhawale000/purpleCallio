'use client';

import { FormEvent, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { TranslationEstimate, TranslationMode, fmtInr, fmtNumber, getEstimate, translationErrorText } from '../../../lib/translation';
import { Card, selectCls } from './shared';
import { whole } from './settings-form';

/** "What will this cost?" using GET /translation/estimate (applies the customer's own rates). */
export function CostEstimator({ defaultMinutes }: { defaultMinutes?: string }) {
  const [mode, setMode] = useState<TranslationMode>('voice');
  const [minutes, setMinutes] = useState(defaultMinutes && whole(defaultMinutes) ? defaultMinutes : '10');
  const [calls, setCalls] = useState('100');
  const [listeners, setListeners] = useState<1 | 2>(2);
  const [estimate, setEstimate] = useState<TranslationEstimate | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const run = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!whole(minutes) || Number(minutes) < 1 || !whole(calls) || Number(calls) < 1) {
      return setError('Enter whole numbers of at least 1 for minutes and calls.');
    }
    setLoading(true);
    try {
      setEstimate(await getEstimate({ mode, minutes: Number(minutes), calls: Number(calls), listeners }));
    } catch (err) {
      setEstimate(null);
      setError(translationErrorText(err, 'Could not calculate an estimate. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="CostGuard estimator" subtitle="Estimate credits for translated calls at your current rates." testId="cost-estimator">
      <form onSubmit={run} noValidate className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5 w-44">
          <label htmlFor="est-mode" className="text-sm font-medium text-[#3D3650]">Mode</label>
          <select id="est-mode" className={selectCls} value={mode} onChange={(e) => setMode(e.target.value as TranslationMode)}>
            <option value="voice">Voice translation</option>
            <option value="captions">Captions</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5 w-44">
          <label htmlFor="est-listeners" className="text-sm font-medium text-[#3D3650]">People translating</label>
          <select id="est-listeners" className={selectCls} value={listeners} onChange={(e) => setListeners(e.target.value === '1' ? 1 : 2)}>
            <option value={1}>One side (1×)</option>
            <option value={2}>Both sides (2×)</option>
          </select>
        </div>
        <div className="w-36">
          <Input label="Minutes per call" type="number" min={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </div>
        <div className="w-36">
          <Input label="Calls" type="number" min={1} value={calls} onChange={(e) => setCalls(e.target.value)} />
        </div>
        <Button type="submit" variant="secondary" loading={loading}>Estimate</Button>
      </form>
      {error && <p role="alert" className="text-sm text-red-600 mt-3">{error}</p>}
      {estimate && (
        <div className="mt-4 rounded-xl border border-[#E7DFF5] bg-[#F8F4FD] p-4 text-sm text-[#170B2E]" data-testid="estimate-result">
          <p>
            <strong>{fmtNumber(estimate.creditsPerCall)} credits</strong> per call
            {estimate.approxInrPerCall != null && <> (≈ {fmtInr(estimate.approxInrPerCall)})</>} ·{' '}
            <strong>{fmtNumber(estimate.totalCredits)} credits</strong> for {fmtNumber(Number(calls))} calls
            {estimate.approxInrTotal != null && <> (≈ {fmtInr(estimate.approxInrTotal)})</>}
          </p>
          <p className="text-xs text-[#3D3650] mt-1">
            {fmtNumber(estimate.ratePerMinute)} credits per minute for each person translating.
            {estimate.note ? ` ${estimate.note}` : ''}
          </p>
        </div>
      )}
    </Card>
  );
}
