/**
 * 画面遷移と UI の組み立て。
 */
(() => {
  const $ = (sel) => document.querySelector(sel);

  let selLevel = 'es';
  let selMode = 'match';

  /* ---------- 画面切り替え ---------- */
  function show(id) {
    document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
    $('#' + id).classList.add('active');
    window.scrollTo(0, 0);
  }

  /* ---------- ホーム ---------- */
  function buildSelectors() {
    const lv = $('#levelSelect');
    lv.innerHTML = '';
    LEVEL_ORDER.forEach((key) => {
      const v = VOCAB[key];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'select-card';
      b.dataset.key = key;
      b.style.setProperty('--accent', v.color);
      b.innerHTML =
        '<span class="sc-icon">' + v.icon + '</span>' +
        '<span class="sc-label">' + v.label + '</span>' +
        '<span class="sc-desc">' + v.desc + '</span>' +
        '<span class="sc-meta">' + v.words.length + ' words</span>';
      b.addEventListener('click', () => { selLevel = key; Sfx.tap(); syncSelection(); });
      lv.appendChild(b);
    });

    const md = $('#modeSelect');
    md.innerHTML = '';
    MODE_ORDER.forEach((key) => {
      const m = MODES[key];
      const unusable = m.needsSpeech && !Speech.supported;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'select-card' + (unusable ? ' disabled' : '');
      b.dataset.key = key;
      b.disabled = unusable;
      b.innerHTML =
        '<span class="sc-icon">' + m.icon + '</span>' +
        '<span class="sc-label">' + m.label + '</span>' +
        '<span class="sc-desc">' + m.desc + '</span>' +
        '<span class="sc-meta">' + (unusable ? 'このブラウザでは使えません' : m.time + '秒') + '</span>';
      b.addEventListener('click', () => { selMode = key; Sfx.tap(); syncSelection(); });
      md.appendChild(b);
    });
  }

  /* ---------- 苦手な単語 ---------- */
  function renderWeak() {
    const weak = Store.weakWords();
    const card = $('#weakCard');
    card.hidden = weak.length === 0;
    if (!weak.length) {
      // 苦手がなくなったら苦手モードも自動でOFFにする
      if (Settings.get('weakMode')) Settings.set('weakMode', false);
      return;
    }
    $('#weakCount').textContent = weak.length;

    const on = Settings.get('weakMode');
    const t = $('#weakToggle');
    t.classList.toggle('on', on);
    t.setAttribute('aria-pressed', String(on));
    t.textContent = (on ? '✅ 苦手モード：ON' : '苦手モード：OFF');
    card.classList.toggle('active', on);

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
        className: 'empty', textContent: 'ほか ' + (weak.length - 20) + ' 語'
      }));
    }
  }

  function syncSelection() {
    if (MODES[selMode].needsSpeech && !Speech.supported) selMode = 'match';
    $('#levelSelect').querySelectorAll('.select-card').forEach((b) => {
      b.classList.toggle('on', b.dataset.key === selLevel);
    });
    $('#modeSelect').querySelectorAll('.select-card').forEach((b) => {
      b.classList.toggle('on', b.dataset.key === selMode);
    });
    $('#bestScore').textContent = Store.getBest(selLevel, selMode).toLocaleString();
  }

  function renderPlayer() {
    const p = Store.playerLevel();
    const d = Store.all();
    $('#playerLv').textContent = p.lv;
    $('#playerXp').textContent = p.cur + ' / ' + p.need + ' XP';
    $('#lvBarFill').style.width = Math.min(100, (p.cur / p.need) * 100) + '%';
    $('#statPlays').textContent = d.plays;
    $('#statCorrect').textContent = d.totalCorrect;
    $('#statWords').textContent = Object.keys(d.seen).length;
  }

  /* ---------- 設定トグル ---------- */
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
    t2.textContent = (sp ? '🔊' : '🔇') + ' 自動発音';
    const r = RATES.find((x) => Math.abs(x.v - Settings.get('rate')) < 0.01) || RATES[1];
    t3.textContent = r.label;
  }

  function bindWeak() {
    $('#weakToggle').addEventListener('click', () => {
      Settings.set('weakMode', !Settings.get('weakMode'));
      Sfx.tap();
      renderWeak();
    });
    $('#weakClear').addEventListener('click', () => {
      if (!confirm('苦手な単語のリストを空にします。よろしいですか？')) return;
      Store.clearWeak();
      renderWeak();
    });
  }

  function bindSettings() {
    $('#toggleSfx').addEventListener('click', () => {
      Settings.set('sfx', !Settings.get('sfx'));
      renderSettings();
      Sfx.tap();
    });
    $('#toggleSpeak').addEventListener('click', () => {
      const next = !Settings.get('autoSpeak');
      Settings.set('autoSpeak', next);
      renderSettings();
      if (next) Speech.say('OK');
    });
    $('#toggleRate').addEventListener('click', () => {
      const i = RATES.findIndex((x) => Math.abs(x.v - Settings.get('rate')) < 0.01);
      const next = RATES[(i + 1 + RATES.length) % RATES.length] || RATES[1];
      Settings.set('rate', next.v);
      renderSettings();
      Speech.say('excellent', { rate: next.v });
    });
  }

  /* ---------- リザルト ---------- */
  function rankOf(score, cleared) {
    if (cleared && score >= 4000) return 'S';
    if (score >= 3500) return 'S';
    if (score >= 2200) return 'A';
    if (score >= 1300) return 'B';
    if (score >= 600) return 'C';
    return 'D';
  }

  function renderResult(r) {
    const total = r.correct + r.wrong;
    const acc = total ? Math.round((r.correct / total) * 100) : 0;
    const xp = Math.floor(r.score / 10);

    $('#resultHeadline').textContent = r.cleared
      ? 'ALL CLEAR!'
      : r.reason === 'hearts' ? 'GAME OVER' : 'TIME UP!';
    $('#resultHeadline').classList.toggle('clear', !!r.cleared);

    const rank = rankOf(r.score, r.cleared);
    const badge = $('#rankBadge');
    badge.textContent = rank;
    badge.dataset.rank = rank;

    $('#resultScore').textContent = r.score.toLocaleString();
    $('#resultCorrect').textContent = r.correct;
    $('#resultWrong').textContent = r.wrong;
    $('#resultCombo').textContent = r.maxCombo;
    $('#resultAcc').textContent = acc + '%';
    $('#resultXp').textContent = '+' + xp;

    const isNew = Store.setBest(r.level, r.mode, r.score);
    $('#newRecord').hidden = !isNew;
    $('#resultBest').textContent = Store.getBest(r.level, r.mode).toLocaleString();
    Store.addResult(r);

    const list = $('#wordList');
    list.innerHTML = '';
    if (!r.learned.length) {
      list.appendChild(Object.assign(document.createElement('p'), {
        className: 'empty', textContent: 'まだ単語が出ていません。'
      }));
    }
    r.learned.forEach((w) => {
      const row = document.createElement('div');
      row.className = 'word-row' + (w.ok ? '' : ' ng');
      row.innerHTML =
        '<span class="w-mark">' + (w.ok ? '✓' : '✗') + '</span>' +
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
  function init() {
    buildSelectors();
    syncSelection();
    renderPlayer();
    renderWeak();
    renderSettings();
    bindSettings();
    bindWeak();

    if (!Speech.supported) $('#speechWarn').hidden = false;

    $('#startBtn').addEventListener('click', () => {
      Sfx.unlock();
      Sfx.tap();
      show('screen-game');
      Game.start(selLevel, selMode);
    });

    $('#retryBtn').addEventListener('click', () => {
      Sfx.tap();
      show('screen-game');
      Game.start(selLevel, selMode);
    });

    $('#homeBtn').addEventListener('click', () => {
      Sfx.tap();
      syncSelection();
      renderPlayer();
      renderWeak();
      show('screen-home');
    });

    $('#quitBtn').addEventListener('click', () => {
      Game.quit();
      show('screen-home');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('#screen-game').classList.contains('active')) {
        Game.quit();
        show('screen-home');
      }
    });

    Game.setOnEnd(renderResult);
    // 初回タップで音声・効果音を有効化（モバイルの自動再生制限対策）
    document.addEventListener('pointerdown', () => Sfx.unlock(), { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
