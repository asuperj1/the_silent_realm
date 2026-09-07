/**
 * compress_images.js — P3 素材压缩工具（基于 sharp）
 *
 * 用法：
 *   node tools/compress_images.js            # 压缩 assets/ 下 >150KB 的图片
 *   node tools/compress_images.js --min 100  # 自定义阈值（KB）
 *   node tools/compress_images.js --q 70     # 自定义 webp 质量
 *
 * 行为：
 *   - 扫描 assets/ 下所有 png/jpg，找出体积超过阈值的
 *   - 用 sharp 转 webp（质量可调）输出到 assets/optimized/（保持目录结构）
 *   - 不覆盖原图、不改动运行时代码；压缩结果供部署前替换引用使用
 *   - 打印每张图节省百分比与总节省量
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..', 'assets');
const OUT = path.join(__dirname, '..', 'assets', 'optimized');

// 参数解析
const args = process.argv.slice(2);
let MIN_KB = 150;
let QUALITY = 75;
args.forEach((a, i) => {
  if (a === '--min' && args[i + 1]) MIN_KB = parseInt(args[i + 1], 10) || 150;
  if (a === '--q' && args[i + 1]) QUALITY = parseInt(args[i + 1], 10) || 75;
});
const MIN_BYTES = MIN_KB * 1024;
const SKIP_DIRS = new Set(['optimized']);

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(p, out);
    } else if (/\.(png|jpe?g)$/i.test(name) && st.size > MIN_BYTES) {
      out.push(p);
    }
  }
  return out;
}

(async () => {
  if (!fs.existsSync(ROOT)) { console.error('未找到 assets 目录:', ROOT); process.exit(1); }
  const files = walk(ROOT);
  if (!files.length) { console.log(`没有超过 ${MIN_KB}KB 的图片（共扫描 assets/）`); return; }
  console.log(`扫描到 ${files.length} 张图片（>${MIN_KB}KB），开始压缩为 webp(q${QUALITY})…\n`);
  let saved = 0, count = 0, failed = 0;
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    const outFile = path.join(OUT, rel.replace(/\.(png|jpe?g)$/i, '.webp'));
    try {
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      const before = fs.statSync(f).size;
      await sharp(f).webp({ quality: QUALITY }).toFile(outFile);
      const after = fs.statSync(outFile).size;
      const pct = (100 * (before - after) / before).toFixed(1);
      saved += (before - after);
      count++;
      console.log(`${pct.padStart(5)}%  ${(before / 1024).toFixed(0).padStart(5)}KB → ${(after / 1024).toFixed(0).padStart(4)}KB  ${rel}`);
    } catch (e) {
      failed++;
      console.warn('[skip]', rel, '->', e.message);
    }
  }
  console.log(`\n完成：压缩 ${count} 张（失败 ${failed}），共节省 ${(saved / 1024 / 1024).toFixed(2)} MB`);
  console.log(`输出目录：${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
