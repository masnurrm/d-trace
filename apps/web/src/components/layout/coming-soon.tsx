import { Construction } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';

/**
 * Placeholder for a menu entry that exists in the navigation but has no feature
 * behind it yet. It says so plainly rather than showing an empty screen that
 * looks broken.
 */
export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      <Card>
        <CardBody className="flex flex-col items-center gap-3 py-16 text-center">
          <span className="rounded-full bg-slate-100 p-3 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <Construction className="h-6 w-6" aria-hidden />
          </span>
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            Halaman ini belum dibangun
          </p>
          <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
            Menunya sudah disiapkan supaya alurnya terlihat utuh. Isinya menyusul.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
