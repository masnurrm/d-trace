import { PlugZap } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/card';

/**
 * Shown when the API never answered — the process is down, the port is wrong,
 * or something in between is blocking it.
 *
 * This is a *state*, not a crash: the page says which address was tried and how
 * to bring it back, instead of printing a `fetch failed` stack trace that tells
 * the reader nothing actionable.
 */
export function ApiUnreachable({ apiBaseUrl }: { apiBaseUrl: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <Card className="max-w-lg">
        <CardBody className="space-y-4 py-10 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            <PlugZap className="h-6 w-6" aria-hidden />
          </span>

          <div className="space-y-1">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
              API tidak dapat dihubungi
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Aplikasi web berjalan, tetapi backend di{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                {apiBaseUrl}
              </code>{' '}
              tidak merespons.
            </p>
          </div>

          <div className="space-y-2 rounded-lg bg-slate-50 px-4 py-3 text-left text-sm dark:bg-slate-800/60">
            <p className="font-medium text-slate-900 dark:text-slate-100">Coba periksa:</p>
            <ol className="list-decimal space-y-1 pl-5 text-slate-600 dark:text-slate-400">
              <li>
                Jalankan keduanya sekaligus dengan{' '}
                <code className="font-mono text-xs">npm run dev</code> dari akar repo.
              </li>
              <li>
                Pastikan database hidup:{' '}
                <code className="font-mono text-xs">npm run docker:up</code>.
              </li>
              <li>
                Periksa <code className="font-mono text-xs">API_URL</code> di{' '}
                <code className="font-mono text-xs">apps/web/.env.local</code> dan{' '}
                <code className="font-mono text-xs">PORT</code> di{' '}
                <code className="font-mono text-xs">apps/api/.env</code>.
              </li>
            </ol>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400">
            Halaman ini akan bekerja kembali begitu API menyala — cukup muat ulang.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
