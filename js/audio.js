/**
 * 発音（Web Speech API）と効果音（Web Audio API）。
 * どちらもブラウザ内蔵機能なので音声ファイルの用意は不要。
 */
const Speech = (() => {
  const synth = window.speechSynthesis || null;
  let voice = null;
  let ready = false;

  /** 英語の音声を選ぶ。en-US を最優先、無ければ英語系、それも無ければ既定音声。 */
  function pickVoice() {
    if (!synth) return;
    const voices = synth.getVoices();
    if (!voices.length) return;
    voice =
      voices.find((v) => v.lang === 'en-US' && /google|samantha|natural/i.test(v.name)) ||
      voices.find((v) => v.lang === 'en-US') ||
      voices.find((v) => v.lang && v.lang.startsWith('en')) ||
      null;
    ready = true;
  }

  if (synth) {
    pickVoice();
    synth.addEventListener('voiceschanged', pickVoice);
  }

  return {
    supported: !!synth,

    /** 英単語を読み上げる。rate は Settings から取得。 */
    say(text, opts = {}) {
      if (!synth || !text) return;
      if (!ready) pickVoice();
      try {
        synth.cancel(); // 連続プレイで詰まらないよう前の発話は止める
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'en-US';
        if (voice) u.voice = voice;
        u.rate = opts.rate != null ? opts.rate : Settings.get('rate');
        u.pitch = 1;
        u.volume = 1;
        synth.speak(u);
      } catch (e) {
        /* 読み上げ非対応環境では何もしない */
      }
    },

    stop() {
      if (synth) synth.cancel();
    }
  };
})();

const Sfx = (() => {
  let ctx = null;

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /** 単音を鳴らす */
  function tone(freq, dur, type = 'sine', gain = 0.12, delay = 0) {
    if (!Settings.get('sfx')) return;
    const a = ac();
    if (!a) return;
    const t0 = a.currentTime + delay;
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(a.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  return {
    /** 画面タップ時に AudioContext を起こす（モバイル対策） */
    unlock() { ac(); },
    tap() { tone(520, 0.07, 'triangle', 0.07); },
    flip() { tone(380, 0.08, 'triangle', 0.06); },
    correct(combo = 0) {
      const base = 660 + Math.min(combo, 8) * 45;
      tone(base, 0.1, 'sine', 0.12);
      tone(base * 1.5, 0.14, 'sine', 0.09, 0.07);
    },
    wrong() {
      tone(180, 0.18, 'sawtooth', 0.09);
      tone(120, 0.22, 'sawtooth', 0.08, 0.06);
    },
    clear() {
      [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'sine', 0.11, i * 0.09));
    },
    gameover() {
      [440, 370, 294, 220].forEach((f, i) => tone(f, 0.3, 'triangle', 0.1, i * 0.14));
    },
    tick() { tone(880, 0.05, 'square', 0.045); }
  };
})();
