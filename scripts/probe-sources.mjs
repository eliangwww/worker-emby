/* eslint-disable */
// 临时探测：检查真实采集源的列表/详情/分类接口数据结构，
// 确认分集（选集）数据在哪里、格式如何。

const SOURCES = {
  hnzy: 'https://iqiyizyapi.com/api.php/provide/vod',
  lzzy: 'https://360zyzz.com/api.php/provide/vod',
  ffzy: 'https://ikunzyapi.com/api.php/provide/vod',
  ykzy: 'https://api.ukuapi88.com/api.php/provide/vod',
  bdzy: 'https://cj.rycjapi.com/api.php/provide/vod',
};

const H = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

async function j(url) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 12000);
  try {
    const r = await fetch(url, { headers: H, signal: c.signal });
    clearTimeout(t);
    if (!r.ok) return { __status: r.status };
    const txt = await r.text();
    try {
      return JSON.parse(txt);
    } catch {
      return { __notjson: txt.slice(0, 200) };
    }
  } catch (e) {
    clearTimeout(t);
    return { __err: String(e) };
  }
}

for (const [key, api] of Object.entries(SOURCES)) {
  console.log(`\n${'='.repeat(70)}\n[${key}] ${api}\n${'='.repeat(70)}`);

  // 1) 分类表
  const cat = await j(`${api}?ac=list`);
  if (Array.isArray(cat?.class)) {
    console.log(`分类 ${cat.class.length} 个:`,
      cat.class.slice(0, 8).map((c) => `${c.type_id}=${c.type_name}`).join(', '));
  } else {
    console.log('分类接口异常:', JSON.stringify(cat).slice(0, 150));
  }

  // 2) 搜索
  const s = await j(`${api}?ac=videolist&wd=${encodeURIComponent('庆余年')}`);
  const list = s?.list;
  console.log(`搜索返回 ${Array.isArray(list) ? list.length : 0} 条`);
  if (Array.isArray(list) && list.length) {
    const it = list[0];
    console.log(`  样本: vod_name="${it.vod_name}" vod_id=${it.vod_id}`);
    console.log(`  vod_pic: ${String(it.vod_pic).slice(0, 90)}`);
    console.log(`  vod_play_url 长度: ${String(it.vod_play_url || '').length}`);
    console.log(`  vod_play_url 前缀: ${String(it.vod_play_url || '').slice(0, 160)}`);
    const m3u8 = (String(it.vod_play_url || '').match(/\$(https?:\/\/[^"'\s]+?\.m3u8)/g) || []);
    console.log(`  正则提取 m3u8 分集数: ${m3u8.length}`);
    // 用 # 分割统计
    const seg = String(it.vod_play_url || '').split('$$$')[0].split('#');
    console.log(`  按#分割分集数(${seg.length}): ${seg.slice(0,3).map(x=>x.slice(0,60)).join(' | ')}`);
  }

  // 3) 详情（取搜索到的第一个 id）
  if (Array.isArray(list) && list.length) {
    const id = list[0].vod_id;
    const d = await j(`${api}?ac=videolist&ids=${id}`);
    const det = d?.list?.[0];
    if (det) {
      const playSources = String(det.vod_play_url || '').split('$$$');
      console.log(`  详情: 播放源组数=${playSources.length}`);
      playSources.slice(0, 3).forEach((ps, i) => {
        const eps = ps.split('#').filter(Boolean);
        console.log(`    源${i}: ${eps.length} 集, 首集=${eps[0]?.slice(0, 70)}`);
      });
    } else {
      console.log('  详情为空:', JSON.stringify(d).slice(0, 120));
    }
  }
}
