/**
 * ゲーム本体。3つのモード（マッチング / 神経衰弱 / スピードクイズ）を
 * 共通のHUD・スコア計算・タイマーの上で動かす。
 */
const Game = (() => {
  /* ---------- 共通ユーティリティ ---------- */

  const $ = (sel) => document.querySelector(sel);

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

  /* ---------- セッション状態 ---------- */

  let s = null;          // 現在のセッション
  let impl = null;       // 現在のモード実装
  let rafId = null;
  let onEnd = () => {};

  const HEARTS = 3;

  function newSession(level, mode) {
    return {
      level,
      mode,
      score: 0,
      combo: 0,
      maxCombo: 0,
      correct: 0,
      wrong: 0,
      hearts: HEARTS,
      stage: 1,
      timeMax: MODES[mode].time,
      timeLeft: MODES[mode].time,
      learned: [],       // 出題された単語の記録
      learnedIndex: {},  // en -> learned配列の位置
      cleared: false,
      running: false,
      lastTickSec: null,
      startedAt: 0
    };
  }

  /* ---------- HUD ---------- */

  function renderHud() {
    $('#hudScore').textContent = s.score.toLocaleString();
    $('#hudCombo').textContent = s.combo > 1 ? s.combo + ' COMBO' : '';
    $('#hudCombo').classList.toggle('on', s.combo > 1);
    $('#hudStage').textContent = 'STAGE ' + s.stage;

    const hearts = $('#hudHearts');
    hearts.innerHTML = '';
    for (let i = 0; i < HEARTS; i++) {
      const h = el('span', 'heart' + (i < s.hearts ? '' : ' lost'), '♥');
      hearts.appendChild(h);
    }
  }

  function renderTimer() {
    const ratio = Math.max(0, s.timeLeft / s.timeMax);
    const bar = $('#timerBar');
    bar.style.transform = 'scaleX(' + ratio + ')';
    bar.classList.toggle('warning', s.timeLeft <= 10);
    $('#timerText').textContent = Math.ceil(Math.max(0, s.timeLeft));
  }

  /* ---------- 演出 ---------- */

  function popCombo(text, cls) {
    const pop = $('#comboPop');
    pop.textContent = text;
    pop.className = 'combo-pop show ' + (cls || '');
    // アニメーションを再生し直すためリフローを挟む
    void pop.offsetWidth;
    pop.classList.add('show');
    clearTimeout(pop._t);
    pop._t = setTimeout(() => pop.classList.remove('show'), 700);
  }

  /** 正解したカードの位置から粒子を飛ばす */
  function burst(node) {
    const layer = $('#fxLayer');
    const r = node.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const colors = ['#facc15', '#f472b6', '#38bdf8', '#4ade80', '#fff'];
    for (let i = 0; i < 12; i++) {
      const p = el('span', 'particle');
      const ang = (Math.PI * 2 * i) / 12 + Math.random() * 0.5;
      const dist = 50 + Math.random() * 70;
      p.style.left = cx + 'px';
      p.style.top = cy + 'px';
      p.style.background = colors[i % colors.length];
      p.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      p.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
      layer.appendChild(p);
      setTimeout(() => p.remove(), 700);
    }
  }

  function flash(cls) {
    const b = $('#screen-game');
    b.classList.add(cls);
    setTimeout(() => b.classList.remove(cls), 260);
  }

  /* ---------- スコア処理 ---------- */

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

  /**
   * 正解時の共通処理。base点にコンボ倍率をかけて加点し、発音を再生する。
   * @param {object} word 正解した単語
   * @param {object} opts { base, bonusTime, node }
   */
  function onCorrect(word, opts = {}) {
    const base = opts.base != null ? opts.base : 100;
    s.combo++;
    s.maxCombo = Math.max(s.maxCombo, s.combo);
    const mult = 1 + Math.min(s.combo - 1, 10) * 0.1;
    const gain = Math.round(base * mult);
    s.score += gain;
    s.correct++;
    s.timeLeft = Math.min(s.timeMax, s.timeLeft + (opts.bonusTime || 0));
    recordWord(word, true);

    Sfx.correct(s.combo);
    if (Settings.get('autoSpeak')) Speech.say(word.en);
    if (opts.node) burst(opts.node);
    if (s.combo >= 3) popCombo(s.combo + ' COMBO!  +' + gain, 'good');
    else popCombo('+' + gain, 'good');
    renderHud();
  }

  /** 不正解時の共通処理。ハートを1つ失い、コンボが切れる。 */
  function onWrong(word, opts = {}) {
    s.combo = 0;
    s.wrong++;
    s.hearts--;
    if (word) recordWord(word, false);
    if (opts.penaltyTime) s.timeLeft = Math.max(0, s.timeLeft - opts.penaltyTime);
    Sfx.wrong();
    flash('shake-screen');
    popCombo('MISS', 'bad');
    renderHud();
    if (s.hearts <= 0) end('hearts');
  }

  /* ---------- タイマーループ ---------- */

  function loop(ts) {
    if (!s || !s.running) return;
    if (!s._prev) s._prev = ts;
    const dt = (ts - s._prev) / 1000;
    s._prev = ts;
    s.timeLeft -= dt;

    const sec = Math.ceil(s.timeLeft);
    if (sec !== s.lastTickSec) {
      s.lastTickSec = sec;
      if (sec <= 5 && sec > 0) Sfx.tick();
    }

    if (s.timeLeft <= 0) {
      s.timeLeft = 0;
      renderTimer();
      end('time');
      return;
    }
    renderTimer();
    rafId = requestAnimationFrame(loop);
  }

  /* ---------- 開始 / 終了 ---------- */

  function start(level, mode) {
    stopLoop();
    s = newSession(level, mode);
    s.startedAt = Date.now();
    impl = MODE_IMPL[mode];

    $('#hudModeLabel').textContent = MODES[mode].icon + ' ' + MODES[mode].label;
    $('#hudLevelLabel').textContent = VOCAB[level].icon + ' ' + VOCAB[level].label;
    const board = $('#board');
    board.className = 'board board-' + mode;
    board.innerHTML = '';

    renderHud();
    renderTimer();

    // init の途中で出題が走るモードがあるので、先に running を立てておく
    s.running = true;
    s._prev = 0;
    impl.init(board, shuffle(VOCAB[level].words));
    rafId = requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function end(reason) {
    if (!s || !s.running) return;
    s.running = false;
    stopLoop();
    Speech.stop();
    if (impl && impl.cleanup) impl.cleanup();

    if (reason === 'complete') {
      s.cleared = true;
      const timeBonus = Math.round(s.timeLeft * 20);
      s.score += timeBonus + 500;
      Sfx.clear();
    } else {
      Sfx.gameover();
    }

    const result = {
      level: s.level,
      mode: s.mode,
      score: s.score,
      maxCombo: s.maxCombo,
      correct: s.correct,
      wrong: s.wrong,
      cleared: s.cleared,
      reason,
      stage: s.stage,
      learned: s.learned.slice(),
      seconds: Math.round((Date.now() - s.startedAt) / 1000)
    };
    setTimeout(() => onEnd(result), reason === 'complete' ? 700 : 450);
  }

  function quit() {
    if (!s) return;
    s.running = false;
    stopLoop();
    Speech.stop();
    if (impl && impl.cleanup) impl.cleanup();
    s = null;
  }

  /* =======================================================
   * モード1: マッチング
   * 左に日本語、右に英語。対応するカードを選んで消していく。
   * ======================================================= */
  const MatchMode = (() => {
    const SLOTS = 5;
    let slots = [];      // { word, jaNode, enNode }
    let deck = [];
    let selJa = null, selEn = null, lock = false;

    function randomOrder() { return Math.floor(Math.random() * 10000); }

    function fillSlot(i, word) {
      const sl = slots[i];
      sl.word = word;
      const o1 = randomOrder(), o2 = randomOrder();
      sl.jaNode.style.order = o1;
      sl.enNode.style.order = o2;
      [sl.jaNode, sl.enNode].forEach((n) => {
        n.classList.remove('matched', 'gone', 'sel', 'miss');
        n.disabled = false;
      });
      if (!word) {
        sl.jaNode.classList.add('gone');
        sl.enNode.classList.add('gone');
        sl.jaNode.disabled = true;
        sl.enNode.disabled = true;
        return;
      }
      sl.jaNode.textContent = word.ja;
      sl.enNode.textContent = word.en;
      sl.jaNode.classList.add('deal');
      sl.enNode.classList.add('deal');
      setTimeout(() => {
        sl.jaNode.classList.remove('deal');
        sl.enNode.classList.remove('deal');
      }, 350);
    }

    function clearSel() {
      slots.forEach((sl) => {
        sl.jaNode.classList.remove('sel');
        sl.enNode.classList.remove('sel');
      });
      selJa = selEn = null;
    }

    function pick(side, i) {
      if (lock || !s || !s.running || !slots[i].word) return;
      Sfx.tap();
      if (side === 'ja') selJa = i; else selEn = i;
      slots.forEach((sl, k) => {
        sl.jaNode.classList.toggle('sel', k === selJa);
        sl.enNode.classList.toggle('sel', k === selEn);
      });
      if (selJa != null && selEn != null) judge();
    }

    function judge() {
      const a = selJa, b = selEn;
      if (a === b) {
        const word = slots[a].word;
        lock = true;
        slots[a].jaNode.classList.add('matched');
        slots[a].enNode.classList.add('matched');
        onCorrect(word, { base: 100, bonusTime: 1.5, node: slots[a].enNode });
        clearSel();
        setTimeout(() => {
          if (!s || !s.running) return;
          const next = deck.shift();
          fillSlot(a, next || null);
          lock = false;
          if (!next && slots.every((sl) => !sl.word)) {
            s.stage++;
            end('complete');
          }
        }, 380);
      } else {
        const jaNode = slots[a].jaNode, enNode = slots[b].enNode;
        jaNode.classList.add('miss');
        enNode.classList.add('miss');
        // 演出中は入力を止める（選択が残ったまま次のタップを拾って誤判定するのを防ぐ）
        lock = true;
        onWrong(slots[a].word);
        // 間違えた組み合わせの英語側も「まだ覚えていない」として記録する
        recordWord(slots[b].word, false);
        setTimeout(() => {
          jaNode.classList.remove('miss');
          enNode.classList.remove('miss');
          clearSel();
          lock = false;
        }, 420);
      }
    }

    return {
      init(board, words) {
        deck = words.slice();
        slots = [];
        selJa = selEn = null;
        lock = false;

        const wrap = el('div', 'match-wrap');
        const colJa = el('div', 'match-col');
        const colEn = el('div', 'match-col');
        colJa.appendChild(el('div', 'col-title', '日本語'));
        colEn.appendChild(el('div', 'col-title', 'English'));
        const listJa = el('div', 'col-list');
        const listEn = el('div', 'col-list');
        colJa.appendChild(listJa);
        colEn.appendChild(listEn);
        wrap.append(colJa, colEn);
        board.appendChild(wrap);

        for (let i = 0; i < SLOTS; i++) {
          const jaNode = el('button', 'card card-ja');
          const enNode = el('button', 'card card-en');
          jaNode.type = enNode.type = 'button';
          jaNode.addEventListener('click', () => pick('ja', i));
          enNode.addEventListener('click', () => {
            pick('en', i);
            // 英語カードはいつでも音を確認できる
            if (!Settings.get('autoSpeak') && slots[i].word) Speech.say(slots[i].word.en);
          });
          listJa.appendChild(jaNode);
          listEn.appendChild(enNode);
          slots.push({ word: null, jaNode, enNode });
        }
        for (let i = 0; i < SLOTS; i++) fillSlot(i, deck.shift() || null);
      },
      cleanup() { lock = true; }
    };
  })();

  /* =======================================================
   * モード2: 神経衰弱
   * 裏返しのカードから日本語と英語のペアを探す。
   * ======================================================= */
  const MemoryMode = (() => {
    const PAIRS = 6;
    let deck = [];
    let first = null, lock = false, remaining = 0, boardEl = null;

    function deal() {
      boardEl.innerHTML = '';
      const use = deck.splice(0, PAIRS);
      remaining = use.length;
      if (!use.length) { end('complete'); return; }

      const cards = [];
      use.forEach((w) => {
        cards.push({ w, face: 'ja', text: w.ja });
        cards.push({ w, face: 'en', text: w.en });
      });

      const grid = el('div', 'memory-grid');
      shuffle(cards).forEach((c) => {
        const btn = el('button', 'mcard');
        btn.type = 'button';
        const inner = el('span', 'mcard-inner');
        const front = el('span', 'mface mfront', '?');
        const back = el('span', 'mface mback ' + (c.face === 'en' ? 'is-en' : 'is-ja'), c.text);
        inner.append(front, back);
        btn.appendChild(inner);
        btn.addEventListener('click', () => flip(btn, c));
        grid.appendChild(btn);
      });
      boardEl.appendChild(grid);
    }

    function flip(btn, c) {
      if (lock || btn.classList.contains('open') || btn.classList.contains('done')) return;
      btn.classList.add('open');
      Sfx.flip();
      if (c.face === 'en') Speech.say(c.w.en);

      if (!first) { first = { btn, c }; return; }
      if (first.btn === btn) return;

      const second = { btn, c };
      lock = true;

      if (first.c.w.en === second.c.w.en) {
        const node = second.btn;
        onCorrect(c.w, { base: 140, bonusTime: 2, node });
        [first, second].forEach((x) => x.btn.classList.add('done'));
        first = null;
        lock = false;
        remaining--;
        if (remaining === 0) {
          setTimeout(() => {
            if (!s || !s.running) return;
            if (deck.length) {
              s.stage++;
              s.timeLeft = Math.min(s.timeMax, s.timeLeft + 12);
              popCombo('STAGE ' + s.stage + '!', 'good');
              Sfx.clear();
              renderHud();
              deal();
            } else {
              end('complete');
            }
          }, 620);
        }
      } else {
        onWrong(first.c.w);
        recordWord(second.c.w, false);
        const a = first, b = second;
        first = null;
        setTimeout(() => {
          a.btn.classList.remove('open');
          b.btn.classList.remove('open');
          lock = false;
        }, 750);
      }
    }

    return {
      init(board, words) {
        boardEl = board;
        deck = words.slice(0, PAIRS * 4); // 最大4ステージ
        first = null;
        lock = false;
        deal();
      },
      cleanup() { lock = true; }
    };
  })();

  /* =======================================================
   * モード3: スピードクイズ
   * 出題された語の意味を4択で答える。日本語→英語 と 英語→日本語 が混ざる。
   * ======================================================= */
  const QuizMode = (() => {
    let deck = [], pool = [], boardEl = null, current = null, lock = false, qno = 0;

    function nextQuestion() {
      if (!s || !s.running) return;
      if (!deck.length) deck = shuffle(pool);
      const word = deck.shift();
      const jaToEn = Math.random() < 0.65;
      qno++;

      const others = shuffle(pool.filter((w) => w.en !== word.en)).slice(0, 3);
      const options = shuffle([word].concat(others));
      current = { word, jaToEn, options };

      boardEl.innerHTML = '';
      const wrap = el('div', 'quiz');
      wrap.appendChild(el('div', 'quiz-no', 'Q' + qno));
      wrap.appendChild(el('div', 'quiz-dir', jaToEn ? '日本語 ➜ English' : 'English ➜ 日本語'));

      const prompt = el('div', 'quiz-prompt' + (jaToEn ? '' : ' en'), jaToEn ? word.ja : word.en);
      wrap.appendChild(prompt);

      if (!jaToEn) {
        // 英語が問題文のときは聞き取りの練習になるよう自動で読み上げ
        const sp = el('button', 'speak-btn', '🔊 聞く');
        sp.type = 'button';
        sp.addEventListener('click', (e) => { e.stopPropagation(); Speech.say(word.en); });
        wrap.appendChild(sp);
        if (Settings.get('autoSpeak')) Speech.say(word.en);
      }

      const opts = el('div', 'quiz-options');
      options.forEach((o, i) => {
        const b = el('button', 'opt');
        b.type = 'button';
        b.innerHTML = '<span class="opt-key">' + (i + 1) + '</span>';
        b.appendChild(el('span', 'opt-text', jaToEn ? o.en : o.ja));
        b.addEventListener('click', () => answer(o, b));
        opts.appendChild(b);
      });
      wrap.appendChild(opts);
      boardEl.appendChild(wrap);
      lock = false;
    }

    function answer(choice, btn) {
      if (lock || !current) return;
      lock = true;
      const { word } = current;
      if (choice.en === word.en) {
        btn.classList.add('ok');
        onCorrect(word, { base: 120, bonusTime: 1.5, node: btn });
        setTimeout(nextQuestion, 620);
      } else {
        btn.classList.add('ng');
        // 正解の選択肢を光らせて見せる
        [...boardEl.querySelectorAll('.opt')].forEach((b, i) => {
          if (current.options[i].en === word.en) b.classList.add('ok');
        });
        onWrong(word, { penaltyTime: 3 });
        if (Settings.get('autoSpeak')) Speech.say(word.en);
        setTimeout(() => { if (s && s.running) nextQuestion(); }, 1100);
      }
    }

    function onKey(e) {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 4) {
        const btns = boardEl.querySelectorAll('.opt');
        if (btns[n - 1]) btns[n - 1].click();
      }
    }

    return {
      init(board, words) {
        boardEl = board;
        pool = words.slice();
        deck = shuffle(pool);
        qno = 0;
        document.addEventListener('keydown', onKey);
        nextQuestion();
      },
      cleanup() {
        lock = true;
        document.removeEventListener('keydown', onKey);
      }
    };
  })();

  const MODE_IMPL = { match: MatchMode, memory: MemoryMode, quiz: QuizMode };

  return {
    start,
    quit,
    end,
    setOnEnd(fn) { onEnd = fn; },
    shuffle
  };
})();
