import '../styles/globals.css';
import type { AppProps } from 'next/app';
import { Theme } from '@radix-ui/themes';
import '@radix-ui/themes/styles.css';

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <Theme appearance="dark" accentColor="violet">
      <Component {...pageProps} />
    </Theme>
  );
}
