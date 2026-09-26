'use client';

import type { AuditLog } from '@dtrace/shared';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { DateTime } from '@/components/ui/date-time';
import { AuditChanges } from './audit-changes';
import { describeAction } from './action-label';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-3 border-b border-slate-100 py-2 last:border-0 dark:border-slate-800">
      <dt className="text-sm text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="col-span-2 min-w-0 text-sm break-words text-slate-800 dark:text-slate-200">
        {children}
      </dd>
    </div>
  );
}

/**
 * One audit record in full.
 *
 * The table shows a friendly label; this shows the record as stored — the raw
 * action code, the full id, the user agent. That is the version that counts as
 * evidence, so nothing here is abbreviated.
 */
export function AuditDetailDialog({ log, onClose }: { log: AuditLog | null; onClose: () => void }) {
  const action = log ? describeAction(log.action) : null;

  return (
    <Dialog
      open={log !== null}
      onClose={onClose}
      title="Detail kejadian"
      description="Catatan apa adanya, seperti yang tersimpan."
      size="lg"
    >
      {log && action && (
        <dl>
          <Row label="Waktu">
            <DateTime value={log.createdAt} />
          </Row>
          <Row label="Aksi">
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={action.tone}>{action.label}</Badge>
              <code className="font-mono text-xs text-slate-500">{log.action}</code>
            </span>
          </Row>
          <Row label="Pelaku">{log.actorEmail ?? 'Sistem'}</Row>
          <Row label="ID pelaku">
            <code className="font-mono text-xs">{log.actorId ?? '—'}</code>
          </Row>
          <Row label="Entity">{log.entity ?? '—'}</Row>
          <Row label="ID entity">
            <code className="font-mono text-xs">{log.entityId ?? '—'}</code>
          </Row>
          <Row label="IP">
            <code className="font-mono text-xs">{log.ip ?? '—'}</code>
          </Row>
          <Row label="User agent">{log.userAgent ?? '—'}</Row>
          <Row label="Perubahan">
            <AuditChanges
              before={log.before}
              after={log.after}
              // Records written before the snapshot columns existed have
              // neither side, which is not the same as "nothing changed".
              unavailable={log.before === null && log.after === null}
            />
          </Row>
          <Row label="Konteks">
            {log.metadata && Object.keys(log.metadata).length > 0 ? (
              <pre className="overflow-x-auto rounded-md bg-slate-50 p-3 font-mono text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {JSON.stringify(log.metadata, null, 2)}
              </pre>
            ) : (
              '—'
            )}
          </Row>
        </dl>
      )}
    </Dialog>
  );
}
