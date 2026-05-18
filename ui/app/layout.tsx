import type { Metadata } from 'next';
import './globals.css';
import Link from 'next/link';
import { headers } from 'next/headers';
import { ClerkProvider, Show, UserButton, SignInButton } from '@clerk/nextjs';

export const dynamic = 'force-dynamic';
import Providers from './providers';

export const metadata: Metadata = {
  title: 'Orkestai Voice',
  description: 'Gestión de campañas de voz',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers();
  const tenantId = headersList.get('x-tenant-id') ?? process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID ?? '';
  const tenantSlug = headersList.get('x-tenant-slug') ?? '';

  return (
    <html lang="es">
      <body className="min-h-screen bg-slate-50">
        <ClerkProvider>
          <Providers tenantId={tenantId} tenantSlug={tenantSlug}>
            <nav className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-6">
              <Link href="/" className="flex items-center gap-2 font-semibold text-slate-800">
                <span className="text-indigo-600 text-lg">◈</span>
                Orkestai Voice
              </Link>
              <Link href="/" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">
                Campañas
              </Link>
              <Link href="/contacts" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">
                Contactos
              </Link>
              <Link href="/analytics" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">
                Analytics
              </Link>
              <Link href="/settings" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">
                Configuración
              </Link>
              <div className="ml-auto flex items-center gap-3">
                {tenantSlug && (
                  <span className="text-xs bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full font-medium">
                    {tenantSlug}
                  </span>
                )}
                <Show when="signed-in">
                  <UserButton />
                </Show>
                <Show when="signed-out">
                  <SignInButton mode="modal">
                    <button className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">
                      Ingresar
                    </button>
                  </SignInButton>
                </Show>
              </div>
            </nav>
            <main className="max-w-6xl mx-auto px-6 py-8">
              {children}
            </main>
          </Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
