import type { Metadata } from 'next';
import { ComingSoon } from '@/components/layout/coming-soon';

export const metadata: Metadata = { title: 'Bantuan' };

export default function Page() {
  return <ComingSoon title="Bantuan" description="Dokumentasi internal penggunaan D-Trace." />;
}
