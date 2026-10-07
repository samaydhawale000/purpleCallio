'use client';

import type { AdminFeature } from '../../../lib/admin-billing';
import { Checkbox, inputCls } from './ui';

export function FeatureChecklist({
  features,
  selected,
  onChange,
}: {
  features: AdminFeature[];
  selected: string[];
  onChange: (keys: string[]) => void;
}) {
  if (features.length === 0) {
    return <p className="text-sm text-[#3D3650]">No features in the registry yet. Add them in the Features tab.</p>;
  }
  const groups = new Map<string, AdminFeature[]>();
  for (const f of features) {
    const g = f.category || 'Other';
    groups.set(g, [...(groups.get(g) ?? []), f]);
  }
  // Keep selected keys that are no longer in the registry visible so they can be removed.
  const orphaned = selected.filter((k) => !features.some((f) => f.key === k));
  const toggle = (key: string, on: boolean) => onChange(on ? [...selected, key] : selected.filter((k) => k !== key));
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {[...groups.entries()].map(([group, items]) => (
        <div key={group}>
          <p className="text-[11px] font-mono uppercase tracking-widest text-[#3D3650] mb-2">{group}</p>
          <div className="space-y-2">
            {items.map((f) => (
              <Checkbox
                key={f.key}
                checked={selected.includes(f.key)}
                onChange={(v) => toggle(f.key, v)}
                label={
                  <>
                    {f.name}
                    {!f.isActive && <span className="ml-1 text-[10px] text-amber-700">(inactive)</span>}
                  </>
                }
                hint={f.description ?? undefined}
              />
            ))}
          </div>
        </div>
      ))}
      {orphaned.length > 0 && (
        <div>
          <p className="text-[11px] font-mono uppercase tracking-widest text-amber-700 mb-2">Not in registry</p>
          {orphaned.map((k) => (
            <Checkbox key={k} checked onChange={() => toggle(k, false)} label={<span className="font-mono">{k}</span>} />
          ))}
        </div>
      )}
    </div>
  );
}
