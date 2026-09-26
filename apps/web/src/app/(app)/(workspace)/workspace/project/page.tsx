import type { Metadata } from 'next';
import { ComingSoon } from '@/components/layout/coming-soon';

export const metadata: Metadata = { title: 'Project' };

export default function Page() {
  return <ComingSoon title="Project" description="Project yang Anda tangani di workspace ini." />;
}
