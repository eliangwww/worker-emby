/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  console.log('server-config called: ', request.url);

  const config = await getConfig();
  const result = {
    SiteName: config.SiteConfig.SiteName,
    StorageType: 'd1',
    // Emby 客户端接入所需的服务器根地址
    EmbyServerUrl: request.headers.get('host')
      ? `${
          request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
          'https'
        }://${request.headers.get('host')}`
      : '',
  };
  return NextResponse.json(result);
}
