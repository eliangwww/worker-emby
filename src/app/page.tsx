'use client';

import { Check, Copy, Server, Smartphone, Tv } from 'lucide-react';
import { useState } from 'react';

import { useSite } from '@/components/SiteProvider';

/**
 * 落地页。
 *
 * 本项目是一个 Emby 兼容服务端：不提供网页播放，而是让主流
 * Emby 客户端连接使用。因此首页只做两件事：
 *   1. 告诉用户服务器地址
 *   2. 给出各客户端的接入步骤
 */
export default function HomePage() {
  const { siteName, announcement } = useSite();
  const [serverUrl, setServerUrl] = useState('');
  const [copied, setCopied] = useState(false);

  // 在浏览器端读取当前访问地址作为服务器地址
  if (typeof window !== 'undefined' && !serverUrl) {
    setServerUrl(window.location.origin);
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(serverUrl || window.location.origin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用时忽略
    }
  };

  const displayUrl = serverUrl || 'https://你的域名';

  return (
    <main className='mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-5 py-14'>
      <header className='text-center'>
        <div className='mb-3 flex justify-center'>
          <Server className='h-12 w-12 text-blue-500' />
        </div>
        <h1 className='text-3xl font-bold tracking-tight sm:text-4xl'>
          {siteName}
        </h1>
        <p className='mt-3 text-sm text-gray-500 dark:text-gray-400'>
          Emby 兼容影视聚合服务 · 连接你的播放器即可观看
        </p>
      </header>

      {/* 服务器地址 */}
      <section className='rounded-2xl border border-gray-200 bg-white/60 p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900/40'>
        <h2 className='mb-3 text-sm font-semibold text-gray-500 dark:text-gray-400'>
          服务器地址
        </h2>
        <div className='flex items-center gap-3'>
          <code className='flex-1 overflow-x-auto rounded-lg bg-gray-100 px-4 py-3 font-mono text-sm dark:bg-gray-800'>
            {displayUrl}
          </code>
          <button
            type='button'
            onClick={copy}
            className='flex shrink-0 items-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-blue-700'
          >
            {copied ? (
              <>
                <Check className='h-4 w-4' /> 已复制
              </>
            ) : (
              <>
                <Copy className='h-4 w-4' /> 复制
              </>
            )}
          </button>
        </div>
        <p className='mt-3 text-xs text-gray-500 dark:text-gray-400'>
          在 Emby 客户端中添加服务器时填入该地址，使用站点管理员账号登录。
        </p>
      </section>

      {/* 客户端接入 */}
      <section className='grid gap-4 sm:grid-cols-2'>
        <ClientCard
          icon={<Tv className='h-5 w-5 text-blue-500' />}
          title='电视 / 盒子'
          items={['Emby for Android TV', 'Kodi (Emby 插件)', 'Infuse (Apple TV)']}
        />
        <ClientCard
          icon={<Smartphone className='h-5 w-5 text-emerald-500' />}
          title='手机 / 平板'
          items={['Emby 官方 App', 'Infuse / Fileball', 'Yamby / Hills']}
        />
      </section>

      {/* 接入步骤 */}
      <section className='rounded-2xl border border-gray-200 p-6 dark:border-gray-800'>
        <h2 className='mb-4 text-base font-semibold'>接入步骤</h2>
        <ol className='space-y-3 text-sm text-gray-600 dark:text-gray-300'>
          {[
            '打开任意 Emby 客户端，选择「添加服务器」',
            `服务器地址填写：${displayUrl}`,
            '输入管理员用户名与密码完成登录',
            '在「我的媒体」中选择电影 / 电视剧浏览播放',
          ].map((step, i) => (
            <li key={i} className='flex gap-3'>
              <span className='flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white'>
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* 状态自检 */}
      <section className='rounded-2xl border border-gray-200 p-6 dark:border-gray-800'>
        <h2 className='mb-3 text-base font-semibold'>服务自检</h2>
        <p className='mb-4 text-sm text-gray-500 dark:text-gray-400'>
          以下接口用于确认服务是否正常，可直接在浏览器打开：
        </p>
        <ul className='space-y-2 text-sm'>
          {[
            ['/emby/System/Info/Public', '服务器信息（应返回包含 ServerName 的 JSON）'],
            ['/emby/Users/Public', '用户列表'],
          ].map(([path, desc]) => (
            <li key={path} className='flex flex-col gap-1'>
              <a
                href={path}
                target='_blank'
                rel='noreferrer'
                className='font-mono text-blue-600 hover:underline dark:text-blue-400'
              >
                {path}
              </a>
              <span className='text-xs text-gray-500 dark:text-gray-400'>
                {desc}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {announcement && (
        <p className='text-center text-xs text-gray-400 dark:text-gray-500'>
          {announcement}
        </p>
      )}
    </main>
  );
}

function ClientCard({
  icon,
  title,
  items,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
}) {
  return (
    <div className='rounded-2xl border border-gray-200 p-5 dark:border-gray-800'>
      <div className='mb-3 flex items-center gap-2'>
        {icon}
        <h3 className='text-sm font-semibold'>{title}</h3>
      </div>
      <ul className='space-y-1 text-sm text-gray-600 dark:text-gray-300'>
        {items.map((it) => (
          <li key={it}>· {it}</li>
        ))}
      </ul>
    </div>
  );
}
