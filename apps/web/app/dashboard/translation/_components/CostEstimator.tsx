'use client';

import { FormEvent, useState } from 'react';
import { TranslationEstimate, TranslationMode, fmtInr, fmtNumber, getEstimate, translationErrorText } from '../../../lib/translation';
import { buttonCls, inputCls } from '../../_ui';
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
    <Card title="Cost estimator" subtitle="Estimate credits for translated calls at your current rates." testId="cost-estimator">
      <form onSubmit={run} noValidate className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5 w-44">
          <label htmlFor="est-mode" className="text-[13px] font-medium text-[#170B2E]">Mode</label>
          <select id="est-mode" className={selectCls} value={mode} onChange={(e) => setMode(e.target.value as TranslationMode)}>
            <option value="voice">Voice translation</option>
            <option value="captions">Captions</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5 w-44">
          <label htmlFor="est-listeners" className="text-[13px] font-medium text-[#170B2E]">People translating</label>
          <select id="est-listeners" className={selectCls} value={listeners} onChange={(e) => setListeners(e.target.value === '1' ? 1 : 2)}>
            <option value={1}>One side (1×)</option>
            <option value={2}>Both sides (2×)</option>
          </select>
        </div>
        <div className="flex w-36 flex-col gap-1.5">
          <label htmlFor="est-minutes" className="text-[13px] font-medium text-[#170B2E]">Minutes per call</label>
          <input id="est-minutes" type="number" min={1} className={inputCls} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </div>
        <div className="flex w-36 flex-col gap-1.5">
          <label htmlFor="est-calls" className="text-[13px] font-medium text-[#170B2E]">Calls</label>
          <input id="est-calls" type="number" min={1} className={inputCls} value={calls} onChange={(e) => setCalls(e.target.value)} />
        </div>
        <button type="submit" className={buttonCls('secondary')} disabled={loading}>Estimate</button>
      </form>
      {error && <p role="alert" className="text-sm text-red-600 mt-3">{error}</p>}
      {estimate && (
        <div className="mt-4 rounded-lg border border-[#ECE8F2] bg-white p-4 text-sm text-[#170B2E]" data-testid="estimate-result">
          <p>
            <strong className="font-semibold">{fmtNumber(estimate.creditsPerCall)} credits</strong> per call
            {estimate.approxInrPerCall != null && <> (≈ {fmtInr(estimate.approxInrPerCall)})</>} ·{' '}
            <strong className="font-semibold">{fmtNumber(estimate.totalCredits)} credits</strong> for {fmtNumber(Number(calls))} calls
            {estimate.approxInrTotal != null && <> (≈ {fmtInr(estimate.approxInrTotal)})</>}
          </p>
          <p className="mt-1 text-xs text-[#6B6478]">
            {fmtNumber(estimate.ratePerMinute)} credits per minute for each person translating.
            {estimate.note ? ` ${estimate.note}` : ''}
          </p>
        </div>
      )}
    </Card>
  );
}
