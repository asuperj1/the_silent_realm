/**
 * make-obelisk-webp.js —— 原生 WebP 动画封装器
 * 
 * sharp 不支持直接输出动态 WebP（ANIM/ANMF），
 * 但可以将每帧编码为独立 WebP。
 * 本脚本解析每帧的 VP8/VP8L/ALPH 块，手动拼装 RIFF→VP8X→ANIM→ANMF×N 容器。
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const FRAME_COUNT = 8;
const CYCLE_MS = 4000;
const FRAME_DELAY_MS = Math.round(CYCLE_MS / FRAME_COUNT); // 500ms

// ─── RIFF / WebP 二进制工具 ───────────────────────────────────────

function u32LE(n) {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32LE(n, 0);
  return b;
}

function readU32LE(buf, off) { return buf.readUInt32LE(off); }
function readFourCC(buf, off) { return buf.toString('ascii', off, off + 4); }

/**
 * 解析单帧 WebP buffer，提取非 RIFF/VP8X 的数据块。
 * 返回 { chunks: Buffer[], width, height }
 * sharp 输出的单帧 WebP 结构通常为：
 *   RIFF(12) + VP8X(10B, optional) + [ICCP|EXIF|XMP|ALPH] + VP8 或 VP8L
 */
function parseWebP(buf) {
  if (readFourCC(buf, 0) !== 'RIFF' || readFourCC(buf, 8) !== 'WEBP') {
    throw new Error('不是合法的 WebP 文件');
  }

  let width = 512, height = 512;
  const chunks = [];
  let off = 12; // 跳过 RIFF 头

  while (off < buf.length) {
    const fourCC = readFourCC(buf, off);
    const size = readU32LE(buf, off + 4);
    const dataStart = off + 8;
    const dataEnd = dataStart + size;

    if (fourCC === 'VP8X') {
      const w24 = buf.readUIntLE(dataStart + 4, 3);
      const h24 = buf.readUIntLE(dataStart + 7, 3);
      width = (w24 & 0xFFFFFF) + 1;
      height = (h24 & 0xFFFFFF) + 1;
    } else if (
      fourCC === 'VP8 ' || fourCC === 'VP8L' ||
      fourCC === 'ALPH' || fourCC === 'ICCP' ||
      fourCC === 'EXIF' || fourCC === 'XMP '
    ) {
      chunks.push(buf.slice(off, dataEnd + (size % 2)));
    }

    off = dataEnd + (size % 2);
  }

  return { chunks, width, height };
}

/**
 * 组装完整的动态 WebP
 */
function buildAnimatedWebP(frameChunks, width, height, delays) {
  const parts = [];

  // flags: bit1=animation(0x02), bit4=alpha(0x10)
  const vp8xFlags = 0x02 | 0x10;

  // ── RIFF header（file_size 占位，最后回填）──
  parts.push(Buffer.from('RIFF'));
  parts.push(u32LE(0)); // 占位
  parts.push(Buffer.from('WEBP'));

  // ── VP8X chunk ──
  parts.push(Buffer.from('VP8X'));
  parts.push(u32LE(10)); // chunk size = 10
  const vp8xBody = Buffer.allocUnsafe(10);
  vp8xBody.writeUInt32LE(vp8xFlags, 0);
  vp8xBody.writeUIntLE(width - 1, 4, 3);
  vp8xBody.writeUIntLE(height - 1, 7, 3);
  parts.push(vp8xBody);

  // ── ANIM chunk ──
  parts.push(Buffer.from('ANIM'));
  parts.push(u32LE(6)); // chunk size
  const animBody = Buffer.allocUnsafe(6);
  animBody.writeUInt32LE(0x00000000, 0); // bg_color BGRA — 透明黑
  animBody.writeUInt16LE(0, 4);          // loop_count — 0=无限
  parts.push(animBody);

  // ── ANMF chunks ──
  for (let i = 0; i < frameChunks.length; i++) {
    const { chunks } = frameChunks[i];
    const delay = delays[i] || FRAME_DELAY_MS;

    let frameDataSize = 0;
    for (const c of chunks) frameDataSize += c.length;

    parts.push(Buffer.from('ANMF'));
    parts.push(u32LE(16 + frameDataSize));

    const header = Buffer.allocUnsafe(16);
    header.writeUIntLE(0, 0, 3);                     // frame_x
    header.writeUIntLE(0, 3, 3);                     // frame_y
    header.writeUIntLE(Math.max(1, width), 6, 3);    // frame_width
    header.writeUIntLE(Math.max(1, height), 9, 3);   // frame_height
    header.writeUIntLE(delay, 12, 3);                // frame_duration (ms)
    header.writeUInt8(0x01, 15);                     // flags: alpha, lossy
    parts.push(header);

    for (const c of chunks) parts.push(c);
  }

  // ── 回填 RIFF file_size ──
  const totalSize = parts.reduce((s, b) => s + b.length, 0);
  parts[1] = u32LE(totalSize - 8);

  return Buffer.concat(parts);
}

// ─── 主流程 ────────────────────────────────────────────────────────

async function main() {
  const frameDir = path.join(__dirname, '..', 'assets', 'obsidian');

  const framePaths = [];
  for (let i = 4; i <= 11; i++) {
    const p = path.join(frameDir, `obsidian_${i}.png`);
    if (!fs.existsSync(p)) { console.error('缺失:', p); process.exit(1); }
    framePaths.push(p);
  }

  console.log('编码帧 (sharp→WebP)...');
  const frameData = [];
  let canvasW = 512, canvasH = 512;

  for (let i = 0; i < framePaths.length; i++) {
    const webpBuf = await sharp(framePaths[i])
      .ensureAlpha()
      .webp({ quality: 85, alphaQuality: 90, lossless: false })
      .toBuffer();

    const parsed = parseWebP(webpBuf);
    canvasW = parsed.width;
    canvasH = parsed.height;
    frameData.push(parsed);
    console.log(`  帧 ${i + 4}: ${webpBuf.length} B → chunks=${parsed.chunks.length}`);
  }

  console.log(`\n组装动图: ${canvasW}×${canvasH}, ${FRAME_COUNT}帧, ${FRAME_DELAY_MS}ms/帧`);
  const animated = buildAnimatedWebP(frameData, canvasW, canvasH,
    Array(FRAME_COUNT).fill(FRAME_DELAY_MS));

  const outputPath = path.join(frameDir, 'obelisk_anim.webp');
  fs.writeFileSync(outputPath, animated);

  const stat = fs.statSync(outputPath);
  console.log(`\n✓ 输出: ${outputPath}`);
  console.log(`  大小: ${(stat.size / 1024).toFixed(1)} KB`);

  const hex = animated.toString('hex');
  console.log(`  ANIM: ${hex.includes('414e494d')}  ANMF: ${hex.includes('414e4d46')}`);
}

main().catch(e => { console.error('失败:', e); process.exit(1); });

