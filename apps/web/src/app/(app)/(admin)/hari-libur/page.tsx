import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/page-header';
import { HolidaysPanel } from '@/components/holidays/holidays-panel';

export const metadata: Metadata = { title: 'Hari Libur' };
export const dynamic = 'force-dynamic';

/**
 * The non-working calendar. Only a SUPER_ADMIN reaches this route group, which
 * is the right gate: a holiday added here moves the schedule of every project.
 */
export default function HolidaysPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Hari Libur"
        description="Hari libur nasional dan cuti bersama yang dilewati saat menjadwalkan project."
      />
      <HolidaysPanel initialYear={new Date().getFullYear()} />
    </div>
  );
}
