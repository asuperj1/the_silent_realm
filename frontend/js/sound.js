/**
 * sound.js — 程序化游戏音效（Web Audio API，零外部资源）
 * 提供：掷骰 / 攻击命中 / 治疗 / 事件提示 / KP 播报提示
 * 暴露：window.Sfx = { dice, hit, heal, alert, kp, toggleMute, isMuted }
 */
(function () {
  'use strict';
  let ctx = null;
  let _muted = false;
  let _volume = 0.8; // ★ 主音量（0~1）
  try { _muted = localStorage.getItem('coc_sfx_muted') === '1'; } catch (e) { /* ignore */ }
  try { const v = parseFloat(localStorage.getItem('coc_sfx_volume')); if (v >= 0 && v <= 1) _volume = v; } catch (e) { /* ignore */ }

  function ac() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { ctx = null; }
    }
    if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* ignore */ } }
    return ctx;
  }
  /** 单音：频率/时长/波形/音量/延迟 */
  function tone(freq, dur, type, vol, delay) {
    const c = ac(); if (!c) return;
    const t0 = c.currentTime + (delay || 0);
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime((vol || 0.1) * _volume, t0); // ★ 应用主音量
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  /** 噪声：时长/音量/延迟（用于攻击/骰子质感） */
  function noise(dur, vol, delay) {
    const c = ac(); if (!c) return;
    const t0 = c.currentTime + (delay || 0);
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const g = c.createGain(); g.gain.setValueAtTime((vol || 0.1) * _volume, t0); // ★ 应用主音量
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start(t0);
  }

  window.Sfx = {
    /** 🎲 掷骰：一连串轻响 + 落定音 */
    dice() { if (_muted) return; for (let i = 0; i < 4; i++) noise(0.045, 0.07, i * 0.04); tone(220, 0.06, 'triangle', 0.05, 0.16); },
    /** ⚔ 攻击命中：低沉撞击 */
    hit() { if (_muted) return; noise(0.1, 0.14); tone(110, 0.09, 'square', 0.07); },
    /** 💚 治疗/回复：上行双音 */
    heal() { if (_muted) return; tone(520, 0.1, 'sine', 0.09); tone(660, 0.14, 'sine', 0.08, 0.08); },
    /** ⚠️ 事件/系统提示：双音警示 */
    alert() { if (_muted) return; tone(880, 0.12, 'triangle', 0.1); tone(660, 0.16, 'triangle', 0.08, 0.1); },
    /** 📢 KP 播报到达：柔和提示 */
    kp() { if (_muted) return; tone(440, 0.1, 'sine', 0.07); tone(550, 0.12, 'sine', 0.06, 0.09); },
    /** 静音开关 */
    toggleMute() { _muted = !_muted; try { localStorage.setItem('coc_sfx_muted', _muted ? '1' : '0'); } catch (e) { /* ignore */ } return _muted; },
    isMuted() { return _muted; },
    /** 主音量（0~1，持久化） */
    setVolume(v) { _volume = Math.max(0, Math.min(1, Number(v) || 0)); try { localStorage.setItem('coc_sfx_volume', String(_volume)); } catch (e) { /* ignore */ } return _volume; },
    getVolume() { return _volume; }
  };
})();
