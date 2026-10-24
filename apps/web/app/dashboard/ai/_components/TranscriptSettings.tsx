'use client';

import { useState } from 'react';
import { api } from '../../../lib/api';
import {
  AiAgent,
  DEFAULT_TRANSCRIPT_RETENTION_DAYS,
  TRANSCRIPT_RETENTION_DAYS,
  apiErrorMessages,
} from '../../../lib/ai';
import { Button } from '../../../components/ui/Button';
import { Checkbox, Select } from './fields';

interface Props {
  agent: AiAgent;
  onSaved: (agent: AiAgent, message: string) => void;
  onError: (message: string) => void;
}

/** Edited in place on the agent (no new version). */
export function TranscriptSettings({ agent, onSaved, onError }: Props) {
  const initialStore = agent.storeTranscript === true;
  const initialDays = agent.transcriptRetentionDays ?? DEFAULT_TRANSCRIPT_RETENTION_DAYS;
  const [store, setStore] = useState(initialStore);
  const [days, setDays] = useState(initialDays);
  const [saving, setSaving] = useState(false);

  const dirty = store !== initialStore || (store && days !== agent.transcriptRetentionDays);

  async function save() {
    // Turning storage off leaves the retention as is, so stored
    // transcripts still age out on the same schedule.
    const patch: Record<string, unknown> = { storeTranscript: store };
    if (store) patch.transcriptRetentionDays = days;
    setSaving(true);
    try {
      const res = await api.patch(`/ai/agents/${agent.id}`, patch);
      onSaved(res.data, store ? 'Transcripts will be stored' : 'Transcripts will no longer be stored');
    } catch (e) {
      onError(apiErrorMessages(e, 'Failed to save transcript settings')[0]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[#E7DFF5] p-5 flex flex-col gap-4" style={{ background: '#FFFFFF' }}>
      <div>
        <p className="text-sm font-semibold text-[#170B2E]">Transcripts</p>
        <p className="text-xs text-[#3D3650] mt-0.5">
          Card numbers, API keys and email addresses are redacted before anything is saved.
        </p>
      </div>
      <Checkbox
        label="Store call transcripts"
        checked={store}
        onChange={setStore}
        helper="Shown on each call in AI Calls. Turning this off stops storing new transcripts; ones already stored are deleted when their retention period ends."
      />
      {store && (
        <div className="max-w-xs">
          <Select
            id="transcript-retention"
            label="Keep transcripts for"
            value={String(days)}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {TRANSCRIPT_RETENTION_DAYS.map((d) => (
              <option key={d} value={d}>{d} days</option>
            ))}
          </Select>
        </div>
      )}
      <div>
        <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>
          Save transcript settings
        </Button>
      </div>
    </div>
  );
}
