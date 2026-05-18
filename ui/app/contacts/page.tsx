import { listContacts } from '@/lib/api';
import { auth } from '@clerk/nextjs/server';
import { headers } from 'next/headers';
import ContactsClient from './ContactsClient';

export default async function ContactsPage() {
  const headersList = await headers();
  const tenantId = headersList.get('x-tenant-id') ?? process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID ?? '';
  const { getToken } = await auth();
  const token = (await getToken()) ?? '';

  let contacts = [];
  try {
    const data = await listContacts(tenantId, token);
    contacts = data.contacts;
  } catch {
    // show empty state
  }

  return <ContactsClient tenantId={tenantId} token={token} initialContacts={contacts} />;
}
