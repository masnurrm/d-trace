'use client';

import { useEffect } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * Error boundary for the whole app.
 *
 * It shows `digest`, not the message: in production Next replaces the real
 * error text with that digest so nothing internal leaks to the browser, and
 * the digest is what matches the server log entry.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
      <Alert tone="danger" title="Terjadi kesalahan" className="max-w-md">
        <p>Halaman ini gagal dimuat.</p>
        {error.digest && (
          <p className="mt-2 font-mono text-xs">Kode rujukan: {error.digest}</p>
        )}
      </Alert>
      <Button variant="secondary" onClick={reset}>
        Coba lagi
      </Button>
    </div>
  );
}
