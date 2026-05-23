import { auth } from '@clerk/nextjs/server';
import { headers } from 'next/headers';
import SettingsClient from './SettingsClient';
import IntegrationsClient from './IntegrationsClient';

export default async function SettingsPage() {
  const headersList = await headers();
  const tenantId = headersList.get('x-tenant-id') ?? process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID ?? '';
  await auth();

  return (
    <div className="space-y-10">
      <SettingsClient tenantId={tenantId} />
      <hr className="border-slate-200" />
      <IntegrationsClient tenantId={tenantId} />
    </div>
  );
}
