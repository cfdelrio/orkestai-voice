// Provides basic Node.js globals for TypeScript in Next.js server components
declare namespace NodeJS {
  interface ProcessEnv {
    readonly NODE_ENV: 'development' | 'production' | 'test';
    readonly DATABASE_URL?: string;
    readonly API_BASE_URL?: string;
    readonly NEXT_PUBLIC_API_URL?: string;
    readonly NEXT_PUBLIC_DEFAULT_TENANT_ID?: string;
    readonly NEXT_PUBLIC_BASE_DOMAIN?: string;
    readonly NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
    readonly CLERK_SECRET_KEY?: string;
    [key: string]: string | undefined;
  }
}

declare var process: {
  env: NodeJS.ProcessEnv;
};
