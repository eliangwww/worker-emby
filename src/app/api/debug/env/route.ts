/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function GET() {
  try {
    // D1 绑定才是管理员配置可用性的唯一依据
    const hasDB = !!(globalThis as any).DB || !!process.env.DB;
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      runtime: 'edge',
      // 保留原字段便于对照；仅供参考，判断请用 hasDB
      storageType: hasDB ? 'd1' : 'unavailable',
      legacyStorageTypeEnv:
        process.env.NEXT_PUBLIC_STORAGE_TYPE || '(未设置)',
      hasDB,
      adminStorageAvailable: hasDB,
      nodeEnv: process.env.NODE_ENV
    });
  } catch (error) {
    return NextResponse.json({
      error: 'Debug failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
