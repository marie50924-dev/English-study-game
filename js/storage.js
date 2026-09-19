/**
 * 設定とプレイ記録の保存（localStorage）。
 * プライベートモード等で保存できない環境でも動くよう、失敗は握りつぶす。
 */
const Store = (() => {
  const KEY = 'eigo-match-v1';
  const DEFAULT = {
    settings: { sfx: true, autoSpeak: true, rate: 0.85, weakMode: false },
    best: {},        // "level:mode" -> スコア
    xp: 0,
    plays: 0,
    totalCorrect: 0,
    seen: {},        // 英単語 -> 正解した回数
    weak: {}         // 英単語 -> { ja, m } ミスした回数（苦手リスト）
  };

  let data = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return structuredClone(DEFAULT);
      return Object.assign(structuredClone(DEFAULT), JSON.parse(raw));
    } catch (e) {
      return structuredClone(DEFAULT);
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      /* 保存できなくてもゲームは続行 */
    }
  }

  return {
    all: () => data,
    getBest(level, mode) { return data.best[level + ':' + mode] || 0; },
    setBest(level, mode, score) {
      const k = level + ':' + mode;
      if (score > (data.best[k] || 0)) { data.best[k] = score; save(); return true; }
      return false;
    },
    addResult(res) {
      data.xp += Math.floor(res.score / 10);
      data.plays += 1;
      data.totalCorrect += res.correct;
      res.learned.forEach((w) => {
        if (w.ok) data.seen[w.en] = (data.seen[w.en] || 0) + 1;
        if (w.miss > 0) {
          // 間違えた単語は苦手リストへ
          const cur = data.weak[w.en] || { ja: w.ja, m: 0 };
          cur.ja = w.ja;
          cur.m += w.miss;
          data.weak[w.en] = cur;
        } else if (w.ok && data.weak[w.en]) {
          // ノーミスで正解できたら苦手度を1つ下げ、0になったら卒業
          data.weak[w.en].m -= 1;
          if (data.weak[w.en].m <= 0) delete data.weak[w.en];
        }
      });
      save();
    },

    /** 苦手な単語を「よく間違えた順」で返す */
    weakWords() {
      return Object.keys(data.weak)
        .map((en) => ({ en, ja: data.weak[en].ja, m: data.weak[en].m }))
        .sort((a, b) => b.m - a.m);
    },

    clearWeak(en) {
      if (en == null) data.weak = {}; else delete data.weak[en];
      save();
    },
    settings() { return data.settings; },
    setSetting(k, v) { data.settings[k] = v; save(); },
    /** XP からプレイヤーレベルと次レベルまでの進捗を計算 */
    playerLevel() {
      const xp = data.xp;
      let lv = 1, need = 100, rest = xp;
      while (rest >= need) { rest -= need; lv++; need = Math.floor(need * 1.25); }
      return { lv, cur: rest, need, xp };
    },
    reset() { data = structuredClone(DEFAULT); save(); }
  };
})();

const Settings = {
  get(k) { return Store.settings()[k]; },
  set(k, v) { Store.setSetting(k, v); }
};
