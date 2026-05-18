import { auth } from '@clerk/nextjs/server';
import { headers } from 'next/headers';
import SettingsClient from './SettingsClient';

export default async function SettingsPage() {
  const headersList = await headers();
  const tenantId = headersList.get('x-tenant-id') ?? process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID ?? '';
  const { getToken } = await auth();
  const token = (await getToken()) ?? '';

  return <SettingsClient tenantId={tenantId} token={token} />;
}
