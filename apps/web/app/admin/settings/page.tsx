'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useCanWrite } from '../../lib/admin-access';
import { ErrorNote, Loading, PageHeader, Panel, Section, buttonCls, inputCls } from '../../dashboard/_ui';

type SettingsData = {
  maintenanceMode: boolean;
  announcement: string | null;
};

export default function AdminSettingsPage() {
  const canWrite = useCanWrite();
  const [data, setData] = useState<SettingsData | null>(null);
  const [maintenance, setMaintenance] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .get('/admin/settings')
      .then((res) => {
        setData(res.data);
        setMaintenance(res.data.maintenanceMode);
        setAnnouncement(res.data.announcement || '');
      })
      .catch((e) => setError(e?.response?.data?.message || e?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    await api.patch('/admin/settings', { maintenanceMode: maintenance, announcement });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const header = <PageHeader title="Platform settings" description="Manage maintenance mode and announcements" />;

  if (loading) {
    return (
      <>
        {header}
        <Loading label="Loading settings…" />
      </>
    );
  }

  if (error || !data) {
    return (
      <>
        {header}
        <ErrorNote message={error || 'Failed to load'} />
      </>
    );
  }

  return (
    <>
      {header}

      <Section title="Operations" description="Changes apply to every customer as soon as they are saved.">
        <Panel className="max-w-2xl">
          <fieldset disabled={!canWrite} className="space-y-5">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={maintenance}
                onChange={(e) => setMaintenance(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[#6D28D9]"
              />
              <span>
                <span className="block text-sm font-medium text-[#170B2E]">Enable Maintenance Mode</span>
                <span className="block text-[13px] text-[#6B6478]">Shows customers that the platform is under maintenance.</span>
              </span>
            </label>

            <div>
              <label htmlFor="announcement" className="mb-1.5 block text-sm font-medium text-[#170B2E]">
                Announcement
              </label>
              <textarea
                id="announcement"
                value={announcement}
                onChange={(e) => setAnnouncement(e.target.value)}
                placeholder="Broadcast a message to all users on the platform…"
                className={`${inputCls} resize-none`}
                rows={3}
              />
            </div>
          </fieldset>

          {canWrite && (
            <button type="button" onClick={save} className={buttonCls('primary', 'mt-5')}>
              {saved ? 'Saved' : 'Save Settings'}
            </button>
          )}
        </Panel>
      </Section>
    </>
  );
}
