import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Shell for the signed-out screens. The proxy already redirects an
 * authenticated visitor away from here, so this layout never renders for one.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-10">
      {/*
        The backdrop is two soft blue pools over a pale wash. It is decorative,
        so it sits behind everything and is hidden from assistive tech.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          backgroundImage:
            'radial-gradient(60% 55% at 12% 8%, #bfdbfe 0%, rgba(191, 219, 254, 0) 62%),' +
            'radial-gradient(55% 50% at 90% 88%, #c7d2fe 0%, rgba(199, 210, 254, 0) 60%),' +
            'linear-gradient(180deg, #eff6ff 0%, #f8fafc 55%, #eef2ff 100%)',
        }}
      />

      {/* The source PNG sits on a white plate; multiply blends it into the backdrop. */}
      <Link href="/" className="mb-6" aria-label="D-Trace">
        <Image
          src="/image.png"
          alt="D-Trace"
          width={1774}
          height={887}
          priority
          className="h-auto w-64 mix-blend-multiply"
        />
      </Link>

      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
