import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)']);

const BASE_DOMAIN = process.env.NEXT_PUBLIC_BASE_DOMAIN ?? 'voice.orkestai.com.ar';
const API_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';

async function resolveTenantSlug(host: string): Promise<{ id: string; slug: string } | null> {
  const hostname = host.split(':')[0];
  if (hostname === BASE_DOMAIN || !hostname.endsWith('.' + BASE_DOMAIN)) return null;

  const slug = hostname.slice(0, hostname.length - BASE_DOMAIN.length - 1);
  if (!slug || slug === 'www') return null;

  try {
    const res = await fetch(`${API_URL}/api/tenants/slug/${encodeURIComponent(slug)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const { tenant } = await res.json();
    return { id: tenant.id, slug };
  } catch {
    return null;
  }
}

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }

  const host = req.headers.get('host') ?? '';
  const requestHeaders = new Headers(req.headers);

  const tenant = await resolveTenantSlug(host);
  if (tenant) {
    requestHeaders.set('x-tenant-id', tenant.id);
    requestHeaders.set('x-tenant-slug', tenant.slug);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
