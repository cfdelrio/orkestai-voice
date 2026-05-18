'use client';

import { createContext, useContext } from 'react';

interface TenantContextValue {
  tenantId: string;
  tenantSlug: string;
}

const TenantContext = createContext<TenantContextValue>({ tenantId: '', tenantSlug: '' });

export function useTenant(): TenantContextValue {
  return useContext(TenantContext);
}

export default function Providers({
  tenantId,
  tenantSlug,
  children,
}: {
  tenantId: string;
  tenantSlug: string;
  children: React.ReactNode;
}) {
  return (
    <TenantContext.Provider value={{ tenantId, tenantSlug }}>
      {children}
    </TenantContext.Provider>
  );
}
