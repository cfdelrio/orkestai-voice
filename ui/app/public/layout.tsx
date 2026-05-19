import type { Metadata } from 'next';
import '../globals.css';

export const metadata: Metadata = {
  title: 'Orkestai Voice — Feed público',
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-slate-950">
        {children}
      </body>
    </html>
  );
}
