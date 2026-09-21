'use client';

import { ArrowLeft, Github, Server } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { useSite } from '@/components/SiteProvider';
import { ThemeToggle } from '@/components/ThemeToggle';

/**
 * 管理后台的外层布局。
 *
 * 本项目聚焦 Emby 服务，网页端只保留管理功能，
 * 因此布局只提供：标题栏 + 返回首页 + 主题切换。
 */
export default function AdminLayout({
  children,
  title = '管理员设置',
}: {
  children: React.ReactNode;
  title?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { siteName } = useSite();

  return (
    <div className='min-h-screen bg-gray-50 text-gray-900 dark:bg-black dark:text-gray-100'>
      <header className='sticky top-0 z-20 border-b border-gray-200 bg-white/80 backdrop-blur dark:border-gray-800 dark:bg-black/70'>
        <div className='mx-auto flex max-w-6xl items-center gap-3 px-4 py-3'>
          {pathname !== '/' && (
            <button
              type='button'
              onClick={() => router.back()}
              aria-label='返回'
              className='rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 dark:hover:bg-gray-800'
            >
              <ArrowLeft className='h-4 w-4' />
            </button>
          )}

          <Link href='/' className='flex items-center gap-2'>
            <Server className='h-5 w-5 text-blue-500' />
            <span className='text-sm font-semibold'>{siteName}</span>
          </Link>

          <span className='text-xs text-gray-400'>· {title}</span>

          <div className='ml-auto flex items-center gap-2'>
            <a
              href='/emby/System/Info/Public'
              target='_blank'
              rel='noreferrer'
              className='hidden rounded-lg px-3 py-1.5 text-xs text-gray-500 transition hover:bg-gray-100 sm:block dark:hover:bg-gray-800'
            >
              服务自检
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className='mx-auto max-w-6xl px-4 py-6'>{children}</div>

      <footer className='mx-auto max-w-6xl px-4 pb-8 text-center text-xs text-gray-400'>
        <a
          href='https://github.com/katelya77/KatelyaTV'
          target='_blank'
          rel='noreferrer'
          className='inline-flex items-center gap-1 hover:underline'
        >
          <Github className='h-3 w-3' /> KatelyaTV Emby
        </a>
      </footer>
    </div>
  );
}
