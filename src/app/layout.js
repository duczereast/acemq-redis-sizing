import localFont from 'next/font/local';
import './globals.css';

const skModernist = localFont({
  src: [
    {
      path: './fonts/Sk-Modernist-Regular.otf',
      weight: '400',
      style: 'normal',
    },
  ],
  display: 'swap',
  variable: '--font-sk-modernist',
});

export const metadata = {
  title: 'AceMQ — Redis Enterprise Sizing Tool',
  description:
    'Size your Redis Enterprise deployment with AceMQ. Tell us about your environments and we’ll generate accurate pricing.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={skModernist.className} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
