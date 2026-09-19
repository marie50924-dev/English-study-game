/**
 * 読み上げ（Web Speech API）と効果音（Web Audio API）。
 * かるたの「読み手」は Speech、札を取る音や拍子木は Sfx が担当する。
 */
const Speech = (() => {
  const synth = window.speechSynthesis || null;
  let enVoice = null, jaVoice = null, ready = false;

  function pickVoice() {
    if (!synth) return;
    const voices = synth.getVoices();
    if (!voices.length) return;
    enVoice =
      voices.find((v) => v.lang === 'en-US' && /google|samantha|natural/i.test(v.name)) ||
      voices.find((v) => v.lang === 'en-US') ||
      voices.find((v) => v.lang && v.lang.startsWith('en')) ||
      null;
    jaVoice =
      voices.find((v) => v.lang === 'ja-JP' && /google|kyoko|natural/i.test(v.name)) ||
      voices.find((v) => v.lang && v.lang.replace('_', '-').startsWith('ja')) ||
      null;
    ready = true;
  }

  if (synth) {
    pickVoice();
    synth.addEventListener('voiceschanged', pickVoice);
  }

  return {
    supported: !!synth,

    /** 日本語の音声があるか（無い場合は読み札の文字だけで読む） */
    hasJa() {
      if (!ready) pickVoice();
      return !!jaVoice;
    },

    /**
     * 読み上げる。
     * @param {string} text 読む文字列
     * @param {object} opts { lang: 'en' | 'ja', rate }
     */
    say(text, opts = {}) {
      if (!synth || !text) return false;
      if (!ready) pickVoice();
      const ja = opts.lang === 'ja';
      if (ja && !jaVoice) return false;
      try {
        synth.cancel(); // 続けて読むときに前の声を止める
        const u = new SpeechSynthesisUtterance(text);
        u.lang = ja ? 'ja-JP' : 'en-US';
        const v = ja ? jaVoice : enVoice;
        if (v) u.voice = v;
        u.rate = opts.rate != null ? opts.rate : Settings.get('rate');
        u.pitch = 1;
        u.volume = 1;
        synth.speak(u);
        return true;
      } catch (e) {
        return false;
      }
    },

    stop() { if (synth) synth.cancel(); }
  };
})();

const Sfx = (() => {
  let ctx = null;
  let noiseBuf = null;

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /** 札がこすれる音・拍子木の芯に使うホワイトノイズ */
  function noise(dur, gain, filterHz, delay = 0) {
    if (!Settings.get('sfx')) return;
    const a = ac();
    if (!a) return;
    if (!noiseBuf) {
      noiseBuf = a.createBuffer(1, a.sampleRate * 0.5, a.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t0 = a.currentTime + delay;
    const src = a.createBufferSource();
    src.buffer = noiseBuf;
    const bp = a.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = filterHz;
    bp.Q.value = 0.9;
    const g = a.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp).connect(g).connect(a.destination);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

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
    unlock() { ac(); },

    /** 拍子木「カン！」 */
    hyoshigi(delay = 0) {
      noise(0.08, 0.5, 2200, delay);
      tone(1500, 0.07, 'square', 0.05, delay);
    },
    tap() { tone(520, 0.06, 'triangle', 0.06); },

    /** 札を取る「パシッ」 */
    take(combo = 0) {
      noise(0.09, 0.42, 3000);
      const base = 700 + Math.min(combo, 8) * 40;
      tone(base, 0.09, 'sine', 0.1, 0.02);
      tone(base * 1.5, 0.12, 'sine', 0.07, 0.08);
    },

    /** 相手に取られた音（低く鈍い） */
    stolen() {
      noise(0.1, 0.3, 900);
      tone(240, 0.22, 'sine', 0.09, 0.03);
    },

    /** お手つき */
    otetsuki() {
      tone(150, 0.26, 'sawtooth', 0.1);
      tone(110, 0.3, 'sawtooth', 0.09, 0.07);
      noise(0.14, 0.2, 500, 0.02);
    },

    /** 勝ちの和風ファンファーレ（都節の音階） */
    win() {
      [523, 587, 784, 880, 1046].forEach((f, i) => tone(f, 0.26, 'sine', 0.11, i * 0.1));
      this.hyoshigi(0.55);
    },
    lose() {
      [440, 392, 330, 262].forEach((f, i) => tone(f, 0.32, 'triangle', 0.1, i * 0.15));
    },
    tick() { tone(880, 0.05, 'square', 0.04); }
  };
})();
