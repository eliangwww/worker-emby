import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';

import './globals.css';

import { getConfig } from '@/lib/config';

import { SiteProvider } from '../components/SiteProvider';
import { ThemeProvider } from '../components/ThemeProvider';

const inter = Inter({ subsets: ['latin'] });

/** 站点展示名 */
function defaultSiteName(): string {
  return process.env.SITE_NAME || 'KatelyaTV Emby';
}

export async function generateMetadata(): Promise<Metadata> {
  let siteName = defaultSiteName();

  try {
    const config = await getConfig();
    siteName = config.SiteConfig.SiteName || siteName;
  } catch {
    // D1 尚未初始化时回退到环境变量
  }

  return {
    title: siteName,
    description: 'Emby 兼容影视聚合服务',
    manifest: '/manifest.json',
  };
}

export const viewport: Viewport = {
  themeColor: '#000000',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let siteName = defaultSiteName();
  let announcement =
    process.env.ANNOUNCEMENT ||
    '本站为 Emby 兼容服务，内容均来自第三方，本站不存储任何视频资源。';

  try {
    const config = await getConfig();
    siteName = config.SiteConfig.SiteName || siteName;
    announcement = config.SiteConfig.Announcement || announcement;
  } catch {
    // 未初始化时使用默认值
  }

  // 注入运行时配置供客户端读取
  const runtimeConfig = {
    STORAGE_TYPE: 'd1',
    ENABLE_REGISTER: process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true',
  };

  return (
    <html lang='zh-CN' suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.RUNTIME_CONFIG = ${JSON.stringify(runtimeConfig)};`,
          }}
        />
      </head>
      <body
        className={`${inter.className} min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-200`}
      >
        <ThemeProvider
          attribute='class'
          defaultTheme='system'
          enableSystem
          disableTransitionOnChange
        >
          <SiteProvider siteName={siteName} announcement={announcement}>
            {children}
          </SiteProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
