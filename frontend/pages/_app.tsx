import '../styles/globals.css';
import type { AppProps } from 'next/app';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { Theme } from '@radix-ui/themes';
import '@radix-ui/themes/styles.css';
import { AuthProvider, useAuth } from '../src/authContext';

const PUBLIC_ROUTES = ['/login', '/signup'];

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { accessToken, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !accessToken && !PUBLIC_ROUTES.includes(router.pathname)) {
      router.replace('/login');
    }
  }, [loading, accessToken, router.pathname]);

  // While the silent refresh is in-flight, render nothing to avoid flicker
  if (loading) return null;

  return <>{children}</>;
}

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <Theme appearance="dark" accentColor="violet">
      <AuthProvider>
        <AuthGuard>
          <Component {...pageProps} />
        </AuthGuard>
      </AuthProvider>
    </Theme>
  );
}
