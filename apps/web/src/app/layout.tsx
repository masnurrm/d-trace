import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Geist } from 'next/font/google';
import { QueryProvider } from '@/lib/query/provider';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});
const mono = JetBrains_Mono({ variable: '--font-mono', subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'D-Trace', template: '%s · D-Trace' },
  description: 'Traceability platform: accounts, roles and an append-only audit trail.',
  // This app is private by nature; keep it out of search indexes.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#f8fafc',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={cn("h-full", "antialiased", mono.variable, "font-sans", geist.variable)}>
      <body className="min-h-full bg-slate-50 font-sans text-slate-900">
        <QueryProvider>{children}</QueryProvider>
        <Toaster />
      </body>
    </html>
  );
}
