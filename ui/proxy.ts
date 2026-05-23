import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)', '/public/(.*)', '/internal/(.*)']);

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

async function getUserTenantSlug(token: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/api/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const { user } = await res.json();
    return user?.tenant?.slug ?? null;
  } catch {
    return null;
  }
}

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }

  // Public and internal routes don't need tenant resolution or subdomain redirects
  if (req.nextUrl.pathname.startsWith('/public/') || req.nextUrl.pathname.startsWith('/internal/')) {
    return NextResponse.next();
  }

  const host = req.headers.get('host') ?? '';
  const hostname = host.split(':')[0];
  const requestHeaders = new Headers(req.headers);

  const tenant = await resolveTenantSlug(host);
  if (tenant) {
    requestHeaders.set('x-tenant-id', tenant.id);
    requestHeaders.set('x-tenant-slug', tenant.slug);
  } else if (hostname === BASE_DOMAIN) {
    // Solo redirigir desde el dominio base — nunca desde un subdominio
    // (evita loops si el backend está momentáneamente caído)
    const { userId, getToken } = await auth();
    if (userId) {
      const token = await getToken();
      if (token) {
        const slug = await getUserTenantSlug(token);
        if (slug) {
          // Tiene tenant → redirigir al subdominio
          const url = req.nextUrl.clone();
          url.host = `${slug}.${BASE_DOMAIN}`;
          url.port = '';
          return NextResponse.redirect(url);
        } else if (!req.nextUrl.pathname.startsWith('/onboarding')) {
          // Sin tenant → onboarding
          const url = req.nextUrl.clone();
          url.pathname = '/onboarding';
          return NextResponse.redirect(url);
        }
      }
    }
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}, { debug: false });

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
