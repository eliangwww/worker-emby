#!/usr/bin/env node
/* eslint-disable */
/**
 * 将 config.json 转换为 src/lib/runtime.ts。
 *
 * 用途：Cloudflare Workers / Pages 没有可读写的文件系统，
 * 因此资源站配置在构建期内联进产物。修改 config.json 后
 * 需要重新构建部署才会生效。
 *
 * 用法：node scripts/convert-config.js
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const configPath = path.join(projectRoot, 'config.json');
const libDir = path.join(projectRoot, 'src', 'lib');
const runtimePath = path.join(libDir, 'runtime.ts');

// 读取 config.json
let config;
try {
  const raw = fs.readFileSync(configPath, 'utf8');
  config = JSON.parse(raw);
} catch (err) {
  // 缺少或损坏的 config.json 不应中断构建，
  // 生成一个空配置让站点仍可启动并在后台配置源。
  console.warn(
    `[gen:runtime] 无法读取或解析 ${configPath}：${err.message}\n` +
      `[gen:runtime] 将生成空的 api_site 配置。`
  );
  config = { cache_time: 7200, api_site: {} };
}

if (!config.api_site || typeof config.api_site !== 'object') {
  config.api_site = {};
}
if (typeof config.cache_time !== 'number') {
  config.cache_time = 7200;
}

const tsContent =
  `// 该文件由 scripts/convert-config.js 自动生成，请勿手动修改。\n` +
  `// 修改 config.json 后重新运行：pnpm gen:runtime\n` +
  `/* eslint-disable */\n\n` +
  `export const config = ${JSON.stringify(config, null, 2)} as const;\n\n` +
  `export type RuntimeConfig = typeof config;\n\n` +
  `export default config;\n`;

if (!fs.existsSync(libDir)) {
  fs.mkdirSync(libDir, { recursive: true });
}

try {
  fs.writeFileSync(runtimePath, tsContent, 'utf8');
  const count = Object.keys(config.api_site).length;
  console.log(`[gen:runtime] 已生成 src/lib/runtime.ts（${count} 个资源站）`);
} catch (err) {
  console.error('[gen:runtime] 写入 runtime.ts 失败:', err);
  process.exit(1);
}
