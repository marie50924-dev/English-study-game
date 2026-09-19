/**
 * 英単語かるた のゲーム本体。
 *
 * 流れ:
 *   読み手が札を1枚読む（英語なら音声、日本語なら文字＋音声）
 *     → プレイヤーは畳に散らした取り札から正しい1枚を探して取る
 *     → 対戦モードでは相手も一定時間後に取りにくる（早い者勝ち）
 *     → 違う札を取ると「お手つき」で持ち札を1枚相手に渡す
 */
const Karuta = (() => {
  const $ = (sel) => document.querySelector(sel);

  const HINT_DELAY = 2600;      // 決まり字ヒントが出るまで
  const OTETSUKI_FREEZE = 1200; // お手つき後に手が止まる時間
  const NEXT_DELAY = 950;       // 次の札を読むまでの間

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  let s = null;
  let onEnd = () => {};
  let rafId = null;
  let hintTimer = null, cpuTimer = null, nextTimer = null, freezeTimer = null;
  let fieldEl = null;

  /* ---------- 出題プール ---------- */

  /** 苦手モードがONなら、間違えた単語を優先して札にする */
  function buildPool(level) {
    const base = VOCAB[level].words;
    if (!Settings.get('weakMode')) return shuffle(base);
    const weak = Store.weakWords().map((w) => ({ en: w.en, ja: w.ja }));
    const MIN = 16;
    if (weak.length >= MIN) return shuffle(weak);
    const fill = shuffle(base.filter((b) => !weak.some((w) => w.en === b.en)));
    return shuffle(weak).concat(fill.slice(0, MIN - weak.length));
  }

  /** 取り札の面（ja=日本語の札 / en=英語の札）を決める */
  function faceFor(style) {
    if (style === 'en') return 'ja';
    if (style === 'ja') return 'en';
    return Math.random() < 0.5 ? 'ja' : 'en';
  }

  /** 取り札が日本語なら英語読み、英語なら日本語読み */
  function readStyleOf(card) {
    return card.face === 'ja' ? 'en' : 'ja';
  }

  /* ---------- 記録 ---------- */

  function recordWord(word, ok) {
    const i = s.learnedIndex[word.en];
    if (i == null) {
      s.learnedIndex[word.en] = s.learned.length;
      s.learned.push({ en: word.en, ja: word.ja, ok, miss: ok ? 0 : 1 });
    } else {
      const rec = s.learned[i];
      if (ok) rec.ok = true; else rec.miss++;
    }
  }

  /* ---------- 表示 ---------- */

  function renderHud() {
    $('#scoreMine').textContent = s.mine;
    $('#scoreTheirs').textContent = s.theirs;
    $('#hudOtetsuki').textContent = s.otetsuki;
    $('#hudScore').textContent = s.score.toLocaleString();
    $('#hudLeft').textContent = s.field.filter((c) => !c.taken).length;
    $('#hudCombo').textContent = s.combo >= 2 ? s.combo + '枚 連取り！' : '';
    $('#hudCombo').classList.toggle('on', s.combo >= 2);
    $('#oppPanel').hidden = s.mode !== 'taisen';
  }

  function renderRace() {
    const bar = $('#raceBar');
    const label = $('#raceLabel');
    if (s.timed) {
      const ratio = Math.max(0, s.timeLeft / s.timeMax);
      bar.style.transform = 'scaleX(' + ratio + ')';
      bar.classList.toggle('warning', s.timeLeft <= 10);
      label.textContent = '残り ' + Math.ceil(Math.max(0, s.timeLeft)) + ' 秒';
      return;
    }
    // 対戦では「相手が取りにいくまで」のバーになる
    if (!s.target || !s.cpuAt) {
      bar.style.transform = 'scaleX(0)';
      label.textContent = '';
      return;
    }
    const now = performance.now();
    const ratio = Math.max(0, (s.cpuAt - now) / (s.cpuAt - s.readAt));
    bar.style.transform = 'scaleX(' + ratio + ')';
    bar.classList.toggle('warning', ratio < 0.34);
    label.textContent = OPPONENTS[s.opp].icon + ' ' + OPPONENTS[s.opp].label + ' が狙っています';
  }

  /** 読み札（見台の上の札）を描く */
  function renderYomi() {
    const box = $('#yomiBody');
    const hint = $('#yomiHint');
    box.innerHTML = '';
    hint.textContent = '';
    hint.classList.remove('on');

    const card = s.target;
    if (!card) return;
    const style = readStyleOf(card);

    if (style === 'en') {
      // 英語読み：音だけが頼り
      const orb = el('button', 'yomi-orb', '🔊');
      orb.type = 'button';
      orb.title = 'もう一度聞く';
      orb.addEventListener('click', (e) => { e.stopPropagation(); replay(); });
      box.appendChild(orb);
      box.appendChild(el('div', 'yomi-sub', '耳をすませて…（タップ / R キーでもう一度）'));
    } else {
      // 日本語読み：読み札の文字が見える
      const t = el('div', 'yomi-ja', card.word.ja);
      box.appendChild(t);
      const orb = el('button', 'yomi-orb small', '🔊');
      orb.type = 'button';
      orb.title = 'もう一度読む';
      orb.addEventListener('click', (e) => { e.stopPropagation(); replay(); });
      box.appendChild(orb);
    }
    $('#yomiLabel').textContent = style === 'en' ? '読み札（英語）' : '読み札（日本語）';
  }

  /** 読み札を読み上げる */
  function speakRead() {
    const card = s.target;
    if (!card) return;
    if (readStyleOf(card) === 'en') {
      Speech.say(card.word.en);
    } else if (Speech.hasJa()) {
      Speech.say(card.word.ja, { lang: 'ja', rate: 1 });
    }
  }

  function replay() {
    speakRead();
    const orb = document.querySelector('.yomi-orb');
    if (orb) {
      orb.classList.remove('ring');
      void orb.offsetWidth; // アニメーションを再生し直す
      orb.classList.add('ring');
    }
  }

  /** 決まり字ヒント（頭の1文字を教える） */
  function showHint() {
    if (!s || !s.running || !s.target) return;
    s.hinted = true;
    const card = s.target;
    const text = card.face === 'ja' ? card.word.ja : card.word.en;
    const hint = $('#yomiHint');
    hint.textContent = '決まり字 「' + text.slice(0, 1) + '」…';
    hint.classList.add('on');
  }

  function popup(text, cls) {
    const pop = $('#popup');
    pop.textContent = text;
    pop.className = 'popup ' + (cls || '');
    void pop.offsetWidth;
    pop.classList.add('show');
    clearTimeout(pop._t);
    pop._t = setTimeout(() => pop.classList.remove('show'), 800);
  }

  /* ---------- 場をつくる ---------- */

  function makeCard(word, slot) {
    const card = { word, face: faceFor(s.style), taken: false, slot };
    const node = el('button', 'fuda');
    node.type = 'button';
    node.style.setProperty('--rot', (Math.random() * 3 - 1.5).toFixed(2) + 'deg');
    node.addEventListener('click', () => tap(card));
    card.node = node;
    paintCard(card);
    return card;
  }

  function paintCard(card) {
    card.node.className = 'fuda fuda-' + card.face + ' deal';
    card.node.textContent = card.face === 'ja' ? card.word.ja : card.word.en;
    card.node.disabled = false;
    setTimeout(() => card.node.classList.remove('deal'), 400);
  }

  /* ---------- 読み ---------- */

  function nextRead() {
    if (!s || !s.running) return;
    const live = s.field.filter((c) => !c.taken);
    if (!live.length) { end(s.mode === 'taisen' ? 'finish' : 'complete'); return; }

    s.target = live[Math.floor(Math.random() * live.length)];
    s.reads++;
    s.readAt = performance.now();
    s.hinted = false;
    s.locked = false;
    s.cpuAt = null;

    renderYomi();
    speakRead();

    clearTimeout(hintTimer);
    hintTimer = setTimeout(showHint, HINT_DELAY);

    if (s.mode === 'taisen') {
      const o = OPPONENTS[s.opp];
      const wait = o.min + Math.random() * (o.max - o.min);
      s.cpuAt = s.readAt + wait;
      clearTimeout(cpuTimer);
      cpuTimer = setTimeout(cpuTake, wait);
    }
  }

  function scheduleNext() {
    clearTimeout(nextTimer);
    nextTimer = setTimeout(() => { if (s && s.running) nextRead(); }, NEXT_DELAY);
  }

  /* ---------- 取る ---------- */

  function tap(card) {
    if (!s || !s.running || s.locked || card.taken || !s.target) return;
    if (card === s.target) playerTake(card);
    else otetsuki(card);
  }

  function playerTake(card) {
    s.locked = true;
    clearTimeout(cpuTimer);
    clearTimeout(hintTimer);

    const reaction = (performance.now() - s.readAt) / 1000;
    if (s.bestReaction == null || reaction < s.bestReaction) s.bestReaction = reaction;

    s.mine++;
    s.combo++;
    s.maxCombo = Math.max(s.maxCombo, s.combo);

    // 早く取るほど高得点。連取りで倍率がかかる。
    const speedBonus = Math.max(0, Math.round((3.5 - reaction) * 60));
    const mult = 1 + Math.min(s.combo - 1, 10) * 0.1;
    const gain = Math.round((200 + speedBonus) * mult);
    s.score += gain;
    if (s.timed) s.timeLeft = Math.min(s.timeMax, s.timeLeft + 2);

    recordWord(card.word, true);
    takeCard(card, 'mine');
    Sfx.take(s.combo);
    if (Settings.get('autoSpeak')) Speech.say(card.word.en);
    popup(s.combo >= 3 ? s.combo + '枚 連取り！ +' + gain : '取った！ +' + gain, 'good');
    revealYomi(card, reaction);
    renderHud();
    scheduleNext();
  }

  function cpuTake() {
    if (!s || !s.running || !s.target) return;
    const card = s.target;
    s.locked = true;
    clearTimeout(hintTimer);
    s.theirs++;
    s.combo = 0;
    recordWord(card.word, false);
    takeCard(card, 'theirs');
    Sfx.stolen();
    if (Settings.get('autoSpeak')) Speech.say(card.word.en);
    popup('取られた…', 'bad');
    revealYomi(card, null);
    renderHud();
    scheduleNext();
  }

  /** お手つき：持ち札を1枚相手に渡し、少しのあいだ手が止まる */
  function otetsuki(card) {
    s.otetsuki++;
    s.combo = 0;
    s.score = Math.max(0, s.score - 80);
    recordWord(card.word, false);

    if (s.mode === 'taisen') {
      if (s.mine > 0) { s.mine--; s.theirs++; }
      else s.theirs++;
    } else {
      s.timeLeft = Math.max(0, s.timeLeft - 3);
    }

    card.node.classList.add('otetsuki');
    setTimeout(() => card.node.classList.remove('otetsuki'), 600);
    Sfx.otetsuki();
    popup('お手つき！', 'bad');
    $('#screen-game').classList.add('shake-screen');
    setTimeout(() => $('#screen-game').classList.remove('shake-screen'), 280);

    // お手つきのあいだは取れない
    s.locked = true;
    clearTimeout(freezeTimer);
    freezeTimer = setTimeout(() => { if (s && s.running) s.locked = false; }, OTETSUKI_FREEZE);
    renderHud();
  }

  /** 取られた札を場から外す */
  function takeCard(card, to) {
    card.taken = true;
    card.node.disabled = true;
    card.node.classList.add(to === 'mine' ? 'to-mine' : 'to-theirs');

    setTimeout(() => {
      if (!s) return;
      const refill = s.mode === 'hitori' && s.deck.length;
      if (refill) {
        // ひとりかるたは札を補充して場を絶やさない
        const word = s.deck.shift();
        card.word = word;
        card.face = faceFor(s.style);
        card.taken = false;
        paintCard(card);
      } else {
        card.node.classList.add('gone');
      }
      renderHud();
    }, 420);
  }

  /** 取ったあとに読み札の答えを見せる */
  function revealYomi(card, reaction) {
    const box = $('#yomiBody');
    box.innerHTML = '';
    const ans = el('div', 'yomi-answer');
    ans.appendChild(el('span', 'ans-en', card.word.en));
    ans.appendChild(el('span', 'ans-ja', card.word.ja));
    box.appendChild(ans);
    const hint = $('#yomiHint');
    hint.classList.add('on');
    hint.textContent = reaction != null ? reaction.toFixed(2) + ' 秒で取りました' : '相手に取られました';
  }

  /* ---------- 進行 ---------- */

  function loop(ts) {
    if (!s || !s.running) return;
    if (!s._prev) s._prev = ts;
    const dt = (ts - s._prev) / 1000;
    s._prev = ts;

    if (s.timed) {
      s.timeLeft -= dt;
      const sec = Math.ceil(s.timeLeft);
      if (sec !== s.lastSec) {
        s.lastSec = sec;
        if (sec <= 5 && sec > 0) Sfx.tick();
      }
      if (s.timeLeft <= 0) {
        s.timeLeft = 0;
        renderRace();
        end('time');
        return;
      }
    }
    renderRace();
    rafId = requestAnimationFrame(loop);
  }

  function clearTimers() {
    [hintTimer, cpuTimer, nextTimer, freezeTimer].forEach(clearTimeout);
    hintTimer = cpuTimer = nextTimer = freezeTimer = null;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  /** 序歌のかわりの「三・二・一」 */
  function countdown(done) {
    const ov = $('#countdown');
    const seq = ['三', '二', '一', 'はじめ！'];
    ov.hidden = false;
    let i = 0;
    (function step() {
      if (!s) return;
      ov.textContent = seq[i];
      ov.className = 'countdown show' + (i === 3 ? ' go' : '');
      Sfx.hyoshigi();
      i++;
      if (i < seq.length) setTimeout(step, 700);
      else setTimeout(() => { ov.hidden = true; done(); }, 620);
    })();
  }

  function start(cfg) {
    clearTimers();
    const pool = buildPool(cfg.level);
    const size = MODES[cfg.mode].cards;

    s = {
      level: cfg.level,
      mode: cfg.mode,
      style: cfg.style,
      opp: cfg.opp,
      deck: pool.slice(size),
      field: [],
      target: null,
      mine: 0, theirs: 0, otetsuki: 0,
      score: 0, combo: 0, maxCombo: 0,
      reads: 0, bestReaction: null,
      timed: cfg.mode === 'hitori',
      timeMax: MODES[cfg.mode].time || 0,
      timeLeft: MODES[cfg.mode].time || 0,
      running: false, locked: true,
      learned: [], learnedIndex: {},
      startedAt: Date.now(),
      _prev: 0, lastSec: null
    };

    $('#hudLevelLabel').textContent = VOCAB[cfg.level].icon + ' ' + VOCAB[cfg.level].label;
    $('#hudModeLabel').textContent = MODES[cfg.mode].icon + ' ' + MODES[cfg.mode].label;
    $('#oppName').textContent = OPPONENTS[cfg.opp].icon + ' ' + OPPONENTS[cfg.opp].label;
    $('#yomiLabel').textContent = '読み札';
    $('#yomiBody').innerHTML = '';
    $('#yomiHint').textContent = '';

    fieldEl = $('#field');
    fieldEl.innerHTML = '';
    pool.slice(0, size).forEach((word, i) => {
      const card = makeCard(word, i);
      s.field.push(card);
      fieldEl.appendChild(card.node);
    });

    renderHud();
    renderRace();

    countdown(() => {
      if (!s) return;
      s.running = true;
      s._prev = 0;
      rafId = requestAnimationFrame(loop);
      nextRead();
    });
  }

  function end(reason) {
    if (!s || !s.running) return;
    s.running = false;
    s.locked = true;
    clearTimers();
    Speech.stop();

    let outcome = null;
    if (s.mode === 'taisen') {
      outcome = s.mine > s.theirs ? 'win' : s.mine < s.theirs ? 'lose' : 'draw';
      if (outcome === 'win') { s.score += 800; Sfx.win(); }
      else if (outcome === 'draw') { s.score += 300; Sfx.hyoshigi(); }
      else Sfx.lose();
    } else if (reason === 'complete') {
      s.score += 500;
      Sfx.win();
    } else {
      Sfx.hyoshigi();
    }

    const result = {
      level: s.level, mode: s.mode, style: s.style, opp: s.opp,
      score: s.score, mine: s.mine, theirs: s.theirs, otetsuki: s.otetsuki,
      maxCombo: s.maxCombo, bestReaction: s.bestReaction,
      outcome, reason,
      learned: s.learned.slice(),
      seconds: Math.round((Date.now() - s.startedAt) / 1000)
    };
    setTimeout(() => onEnd(result), 800);
  }

  function quit() {
    if (!s) return;
    s.running = false;
    clearTimers();
    Speech.stop();
    $('#countdown').hidden = true; // 数えている途中でやめたとき用
    s = null;
  }

  document.addEventListener('keydown', (e) => {
    if (!s || !s.running) return;
    if (e.key === 'r' || e.key === 'R') replay();
  });

  return {
    start,
    quit,
    end,
    replay,
    setOnEnd(fn) { onEnd = fn; },
    shuffle
  };
})();
