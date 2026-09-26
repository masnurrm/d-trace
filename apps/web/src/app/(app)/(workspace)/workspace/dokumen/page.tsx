import type { Metadata } from 'next';
import { ComingSoon } from '@/components/layout/coming-soon';

export const metadata: Metadata = { title: 'Dokumen' };

export default function Page() {
  return (
    <ComingSoon
      title="Dokumen"
      description="Dokumen yang dihasilkan dari master template dan diisi di sini."
    />
  );
}
