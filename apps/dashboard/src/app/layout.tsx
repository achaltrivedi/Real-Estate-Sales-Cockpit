import { SampleDataBanner } from '@gsc/ui';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = { title: 'Sales Cockpit — Dashboard (sample data)' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <SampleDataBanner text="SAMPLE DATA · Fictional project and leads for demonstration only" />
        {children}
      </body>
    </html>
  );
}
