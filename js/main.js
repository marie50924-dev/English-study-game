/**
 * 画面遷移と選択UI。
 */
(() => {
  const $ = (sel) => document.querySelector(sel);

  const sel = { level: 'es', mode: 'taisen', style: 'mix', opp: 'town' };

  function show(id) {
    document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
    $('#' + id).classList.add('active');
    window.scrollTo(0, 0);
  }

  /** 選択カードを1枚つくる */
  function card(key, { icon, label, desc, meta, disabled }) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'select-card' + (disabled ? ' disabled' : '');
    b.dataset.key = key;
    b.disabled = !!disabled;
    b.innerHTML =
      '<span class="sc-icon">' + icon + '</span>' +
      '<span class="sc-label">' + label + '</span>' +
      '<span class="sc-desc">' + desc + '</span>' +
      '<span class="sc-meta">' + meta + '</span>';
    return b;
  }

  function buildSelectors() {
    const lv = $('#levelSelect');
    lv.innerHTML = '';
    LEVEL_ORDER.forEach((key) => {
      const v = VOCAB[key];
      const b = card(key, { icon: v.icon, label: v.label, desc: v.desc, meta: v.words.length + ' 語' });
      b.style.setProperty('--accent', v.color);
      b.addEventListener('click', () => { sel.level = key; Sfx.tap(); sync(); });
      lv.appendChild(b);
    });

    const md = $('#modeSelect');
    md.innerHTML = '';
    MODE_ORDER.forEach((key) => {
      const m = MODES[key];
      const meta = key === 'taisen' ? m.cards + '枚勝負' : m.time + '秒';
      const b = card(key, { icon: m.icon, label: m.label, desc: m.desc, meta });
      b.addEventListener('click', () => { sel.mode = key; Sfx.tap(); sync(); });
      md.appendChild(b);
    });

    const st = $('#styleSelect');
    st.innerHTML = '';
    STYLE_ORDER.forEach((key) => {
      const r = READ_STYLES[key];
      const disabled = r.needsSpeech && !Speech.supported;
      const b = card(key, {
        icon: r.icon, label: r.label, desc: r.desc,
        meta: disabled ? '音声が使えません' : '取り札は' + (key === 'ja' ? '英語' : key === 'en' ? '日本語' : '両方'),
        disabled
      });
      b.addEventListener('click', () => { sel.style = key; Sfx.tap(); sync(); });
      st.appendChild(b);
    });

    const op = $('#oppSelect');
    op.innerHTML = '';
    OPPONENT_ORDER.forEach((key) => {
      const o = OPPONENTS[key];
      const b = card(key, {
        icon: o.icon, label: o.label,
        desc: '読まれてから約' + (o.min / 1000).toFixed(1) + '〜' + (o.max / 1000).toFixed(1) + '秒で取る',
        meta: '強さ ' + '★'.repeat(OPPONENT_ORDER.indexOf(key) + 1)
      });
      b.addEventListener('click', () => { sel.opp = key; Sfx.tap(); sync(); });
      op.appendChild(b);
    });
  }

  function sync() {
    // 音声が使えないときは日本語読みに寄せる
    if (READ_STYLES[sel.style].needsSpeech && !Speech.supported) sel.style = 'ja';

    [['#levelSelect', 'level'], ['#modeSelect', 'mode'], ['#styleSelect', 'style'], ['#oppSelect', 'opp']]
      .forEach(([id, key]) => {
        $(id).querySelectorAll('.select-card').forEach((b) => {
          b.classList.toggle('on', b.dataset.key === sel[key]);
        });
      });

    $('#oppSection').hidden = sel.mode !== 'taisen';
    $('#bestScore').textContent = Store.getBest(sel.level, sel.mode).toLocaleString();
  }

  function renderPlayer() {
    const p = Store.playerLevel();
    const d = Store.all();
    const r = Store.record();
    $('#playerLv').textContent = p.lv;
    $('#playerXp').textContent = p.cur + ' / ' + p.need + ' XP';
    $('#lvBarFill').style.width = Math.min(100, (p.cur / p.need) * 100) + '%';
    $('#statRecord').textContent = r.win + '勝 ' + r.lose + '敗' + (r.draw ? ' ' + r.draw + '分' : '');
    $('#statCorrect').textContent = d.totalCorrect;
    $('#statWords').textContent = Object.keys(d.seen).length;
  }

  /* ---------- 苦手な札 ---------- */
  function renderWeak() {
    const weak = Store.weakWords();
    const box = $('#weakCard');
    box.hidden = weak.length === 0;
    if (!weak.length) {
      if (Settings.get('weakMode')) Settings.set('weakMode', false);
      return;
    }
    $('#weakCount').textContent = weak.length;

    const on = Settings.get('weakMode');
    const t = $('#weakToggle');
    t.classList.toggle('on', on);
    t.setAttribute('aria-pressed', String(on));
    t.textContent = on ? '✅ 苦手モード：ON' : '苦手モード：OFF';
    box.classList.toggle('active', on);

    const list = $('#weakList');
    list.innerHTML = '';
    weak.slice(0, 20).forEach((w) => {
      const row = document.createElement('div');
      row.className = 'weak-row';
      row.innerHTML =
        '<span class="w-en">' + w.en + '</span>' +
        '<span class="w-ja">' + w.ja + '</span>' +
        '<span class="w-miss">×' + w.m + '</span>';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'w-speak';
      b.textContent = '🔊';
      b.title = w.en + ' を発音';
      b.addEventListener('click', () => Speech.say(w.en));
      row.appendChild(b);
      list.appendChild(row);
    });
    if (weak.length > 20) {
      list.appendChild(Object.assign(document.createElement('p'), {
        className: 'empty', textContent: 'ほか ' + (weak.length - 20) + ' 枚'
      }));
    }
  }

  /* ---------- 設定 ---------- */
  const RATES = [
    { v: 0.7, label: '🐢 読む速さ：ゆっくり' },
    { v: 0.85, label: '🚶 読む速さ：ふつう' },
    { v: 1.0, label: '🐇 読む速さ：はやい' }
  ];

  function renderSettings() {
    const sfx = Settings.get('sfx');
    const sp = Settings.get('autoSpeak');
    const t1 = $('#toggleSfx'), t2 = $('#toggleSpeak'), t3 = $('#toggleRate');
    t1.classList.toggle('on', sfx);
    t1.setAttribute('aria-pressed', String(sfx));
    t1.textContent = (sfx ? '🔔' : '🔕') + ' 効果音';
    t2.classList.toggle('on', sp);
    t2.setAttribute('aria-pressed', String(sp));
    t2.textContent = (sp ? '🔊' : '🔇') + ' 取ったら発音';
    const r = RATES.find((x) => Math.abs(x.v - Settings.get('rate')) < 0.01) || RATES[1];
    t3.textContent = r.label;
  }

  function bindSettings() {
    $('#toggleSfx').addEventListener('click', () => {
      Settings.set('sfx', !Settings.get('sfx'));
      renderSettings();
      Sfx.hyoshigi();
    });
    $('#toggleSpeak').addEventListener('click', () => {
      const next = !Settings.get('autoSpeak');
      Settings.set('autoSpeak', next);
      renderSettings();
      if (next) Speech.say('karuta');
    });
    $('#toggleRate').addEventListener('click', () => {
      const i = RATES.findIndex((x) => Math.abs(x.v - Settings.get('rate')) < 0.01);
      const next = RATES[(i + 1 + RATES.length) % RATES.length] || RATES[1];
      Settings.set('rate', next.v);
      renderSettings();
      Speech.say('excellent', { rate: next.v });
    });
    $('#weakToggle').addEventListener('click', () => {
      Settings.set('weakMode', !Settings.get('weakMode'));
      Sfx.tap();
      renderWeak();
    });
    $('#weakClear').addEventListener('click', () => {
      if (!confirm('苦手な札のリストを空にします。よろしいですか？')) return;
      Store.clearWeak();
      renderWeak();
    });
  }

  /* ---------- 結果 ---------- */
  function renderResult(r) {
    const isMatch = r.mode === 'taisen';
    const xp = Math.floor(r.score / 10);

    $('#resultHeadline').textContent = isMatch ? '勝負あり' : (r.reason === 'complete' ? '札を取り切った！' : '時間まで');

    const out = $('#resultOutcome');
    out.hidden = !isMatch;
    if (isMatch) {
      const label = { win: '勝ち', lose: '負け', draw: '引き分け' }[r.outcome];
      out.textContent = label;
      out.dataset.outcome = r.outcome;
      Store.addMatch(r.outcome);
    }

    $('#resultTally').hidden = !isMatch;
    $('#resultMine').textContent = r.mine;
    $('#resultTheirs').textContent = r.theirs;
    $('#resultOppName').textContent = OPPONENTS[r.opp].label;
    if (!isMatch) {
      // ひとりかるたは取った枚数だけを見せる
      $('#resultHeadline').textContent += '  ' + r.mine + '枚';
    }

    $('#resultScore').textContent = r.score.toLocaleString();
    $('#resultOtetsuki').textContent = r.otetsuki;
    $('#resultFast').textContent = r.bestReaction != null ? r.bestReaction.toFixed(2) + '秒' : '-';
    $('#resultCombo').textContent = r.maxCombo;
    $('#resultXp').textContent = '+' + xp;
    $('#resultTime').textContent = r.seconds + '秒';

    const isNew = Store.setBest(r.level, r.mode, r.score);
    $('#newRecord').hidden = !isNew;
    $('#resultBest').textContent = Store.getBest(r.level, r.mode).toLocaleString();
    Store.addResult({ score: r.score, correct: r.mine, learned: r.learned });

    const list = $('#wordList');
    list.innerHTML = '';
    if (!r.learned.length) {
      list.appendChild(Object.assign(document.createElement('p'), {
        className: 'empty', textContent: '札が読まれませんでした。'
      }));
    }
    r.learned.forEach((w) => {
      const row = document.createElement('div');
      row.className = 'word-row' + (w.ok ? '' : ' ng');
      row.innerHTML =
        '<span class="w-mark">' + (w.ok ? '取' : '逃') + '</span>' +
        '<span class="w-en">' + w.en + '</span>' +
        '<span class="w-ja">' + w.ja + '</span>';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'w-speak';
      b.textContent = '🔊';
      b.title = w.en + ' を発音';
      b.addEventListener('click', () => Speech.say(w.en));
      row.appendChild(b);
      list.appendChild(row);
    });

    renderPlayer();
    renderWeak();
    show('screen-result');
  }

  /* ---------- 起動 ---------- */
  function begin() {
    Sfx.unlock();
    show('screen-game');
    Karuta.start({ level: sel.level, mode: sel.mode, style: sel.style, opp: sel.opp });
  }

  function init() {
    buildSelectors();
    sync();
    renderPlayer();
    renderWeak();
    renderSettings();
    bindSettings();

    if (!Speech.supported) $('#speechWarn').hidden = false;
    else if (!Speech.hasJa()) {
      // 音声一覧は非同期で届くことがあるので、少し待ってから判定する
      setTimeout(() => { $('#jaVoiceNote').hidden = Speech.hasJa(); }, 800);
    }

    $('#startBtn').addEventListener('click', begin);
    $('#retryBtn').addEventListener('click', begin);
    $('#homeBtn').addEventListener('click', () => {
      Sfx.tap();
      sync();
      renderPlayer();
      renderWeak();
      show('screen-home');
    });
    $('#quitBtn').addEventListener('click', () => {
      Karuta.quit();
      show('screen-home');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('#screen-game').classList.contains('active')) {
        Karuta.quit();
        show('screen-home');
      }
    });

    Karuta.setOnEnd(renderResult);
    document.addEventListener('pointerdown', () => Sfx.unlock(), { once: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
