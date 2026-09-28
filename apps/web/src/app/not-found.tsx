import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="font-mono text-sm text-slate-500">404</p>
      <h1 className="text-2xl font-semibold">Halaman ini tidak ada</h1>
      <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
        Tautannya mungkin sudah usang, atau datanya sudah dihapus.
      </p>
      <Link href="/dashboard">
        <Button variant="secondary">Kembali ke dashboard</Button>
      </Link>
    </div>
  );
}
