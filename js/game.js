/* === Block Harness（ここは触らない） === */
(() => {
  const blocks = {};
  window.defineBlock = (id, initFn) => {
    if (blocks[id]) console.warn('Block redefined:', id);
    blocks[id] = initFn;
  };
  window.runBlocks = () => {
    Object.keys(blocks).sort().forEach(id => {
      try { blocks[id](); } catch (e) { console.error('Block failed:', id, e); }
    });
  };
  window.G = {}; // 共有オブジェクト
})();

/*** [01.dom-and-constants] DOM参照 & 定数 *************************************/
defineBlock('01.dom-and-constants', () => {
  // utils.js にある $ を利用
  G.stage        = $('#stage');
  G.scoreEl      = $('#score');
  G.comboEl      = $('#combo');
  G.stoneCountEl = $('#stoneCount');
  G.missListEl   = $('#missList');
  G.targetWordEl = $('#targetWord');
  G.flashEl      = $('#flash');
  G.gcBanner     = $('#gcBanner');
  G.goBanner     = $('#goBanner');
  G.gcReset      = $('#gcReset');
  G.goReset      = $('#goReset');

  // レイアウト依存の数値（読み込み時に1回評価）
  G.BOX_W      = G.stage.clientWidth;
  G.BOX_H      = G.stage.clientHeight;
  G.COLS       = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--cols'));
  G.CELL       = G.BOX_W / G.COLS;
  G.EMOJI_SIZE = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--emoji-size'));
});

/*** [02.state] ゲーム状態 *****************************************************/
defineBlock('02.state', () => {
  G.running = false;
  G.rafId   = null;
  G.fallSpeed = 110;  // px/sec

  G.emojis = [];      // 落下中 { item, el, x, y, col, groupId }
  G.stones = [];      // 配列 { col, row, el }
  G.stoneHeights = new Array(G.COLS).fill(0);

  G.score = 0;
  G.lastMilestone = 0; // 100点ごと除去
  G.combo = 0;
  G.recentMiss = [];

  // レベル/ターゲット/波
  G.correctCount = 0;
  G.levelSize = 1;   // Lv1=1, Lv2=2, Lv3=3
  G.groupSize = 4;   // Lv4で5
  G.currentTargets = [];
  G.unresolvedTargets = [];
  G.activeGroups = new Set();
  G.groupIdSeq = 0;

  // ★ 通し質問番号（1問目→2問目→…）
  G.questionIndex = 1;

  // 表示維持
  G.lastShownWord = '—';

  // 波の重複起動防止
  G.pendingWaveTimer = null;

  // ループ用
  G.lastTime = 0;
});

/*** [03.targets-levels] ターゲット選定／表示／レベル **************************/
defineBlock('03.targets-levels', () => {
  // 現在レベル（1〜4）
  G.level = 1;

  // ★ Lv2以降で使う数字語彙（いち〜きゅう）
  const EXTRA_LEVEL2_ITEMS = [
    { w: "いち",  e: "1️⃣" }, { w: "に",   e: "2️⃣" }, { w: "さん", e: "3️⃣" },
    { w: "よん", e: "4️⃣" }, { w: "ご",   e: "5️⃣" }, { w: "ろく", e: "6️⃣" },
    { w: "なな", e: "7️⃣" }, { w: "はち", e: "8️⃣" }, { w: "きゅう", e: "9️⃣" }
  ];

  // ★ レベルに応じた語彙プール（ダミー生成もこちらを使う）
  G.getPool = function(){
    // Lv2以降は数字も混ぜる
    return (G.level >= 2) ? [...ALL_ITEMS, ...EXTRA_LEVEL2_ITEMS] : [...ALL_ITEMS];
  };

  // レベル計算：1:0-9, 2:10-19, 3:20-29, 4:30+
  function computeLevel(correctCount){
    if (correctCount >= 30) return 4;
    if (correctCount >= 20) return 3;
    if (correctCount >= 10) return 2;
    return 1;
  }

  // レベル反映（英語トースト表示）
  G.handleLevels = function(){
    const prev = G.level;
    G.level = computeLevel(G.correctCount);

    G.levelSize = (G.level === 1 ? 1 : (G.level === 2 ? 2 : 3));
    G.groupSize = (G.level === 4 ? 5 : 4);

    if (G.level !== prev) {
      const msg = (G.level === 4)
        ? 'Level 4: 5 emoji at once!'
        : `Level ${G.level}: ${G.levelSize} target${G.levelSize>1?'s':''}`;
      G.showLevelUp(msg);
    }
  };

  // ★ ターゲット1件をプールから新規抽選（既存と重複させない）
  G.pickOneNewTarget = function(excludeEmojis = []){
    const pool = G.getPool().filter(x => !excludeEmojis.includes(x.e));
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random()*pool.length)];
  };

  // n件のターゲットを抽選（重複なし）
  G.pickTargets = function(n){
    const pool = G.getPool();
    const picked = [];
    const used = new Set();
    for(let i=0;i<n;i++){
      // 重複避けて選ぶ
      let safety = 200, item = null;
      while(safety-- > 0){
        const cand = pool[Math.floor(Math.random()*pool.length)];
        if (!used.has(cand.e)) { item = cand; break; }
      }
      if (item) { picked.push(item); used.add(item.e); }
    }
    G.currentTargets = picked;
    G.unresolvedTargets = [...picked];

    // 初回表示
    if (G.unresolvedTargets[0]) G.lastShownWord = G.unresolvedTargets[0].w;
    G.renderTargets();
  };

  // ★ 語彙バー：複数語彙を“個別ボックス”で表示
  //   スタイルを1度だけ注入
  (function ensureTargetChipStyle(){
    if (document.getElementById('target-chip-style')) return;
    const st = document.createElement('style');
    st.id = 'target-chip-style';
    st.textContent = `
      .target-chips{ display:flex; flex-wrap:wrap; gap:6px; justify-content:center; }
      .target-chip{
        display:inline-block; padding:6px 10px; border:1px solid #334170;
        border-radius:10px; background:#0f1526; font-weight:800; letter-spacing:.02em;
      }
    `;
    document.head.appendChild(st);
  })();

  G.renderTargets = function(){
    const host = G.targetWordEl;
    // コンテナ作り替え
    const wrap = document.createElement('span');
    wrap.className = 'target-chips';
    const src = (G.unresolvedTargets.length > 0)
      ? G.unresolvedTargets
      : (G.lastShownWord ? G.lastShownWord.split(' / ').map(w => ({w})) : []);
    if (G.unresolvedTargets.length > 0) {
      src.forEach(t => {
        const chip = document.createElement('span');
        chip.className = 'target-chip';
        chip.textContent = t.w;
        wrap.appendChild(chip);
      });
      host.replaceChildren(wrap);
      // lastShownWord には "A / B / C" をバックアップ文字列として残す
      G.lastShownWord = G.unresolvedTargets.map(t=>t.w).join(' / ');
    } else {
      // 未解決がない時は前回表示を維持
      host.textContent = G.lastShownWord || '—';
    }
  };
});

/*** [04.spawn] 波の生成（2秒間隔の連続出現） **********************************/
defineBlock('04.spawn', () => {
  // チュートリアル：1,2,3問目は 1→2→3 個、それ以降は groupSize（Lv4で5）
  function currentGroupSize() {
    if (G.questionIndex <= 3) return G.questionIndex; // 1,2,3
    return G.groupSize; // 4（Lv4で5）
  }

  G.spawnWave = function(targetItem, waveId){
    const n = Math.max(1, currentGroupSize());
    // ★ ダミーは G.getPool() から選ぶ（Lv2以降の数字も反映）
    const pool = G.getPool();
    const dummies = sampleWithout(pool, Math.max(0, n - 1), targetItem.e);
    const items = [targetItem, ...dummies].sort(() => Math.random() - 0.5);

    const cols = pickSeparatedColumns(G.COLS, items.length);
    const baseY = -G.EMOJI_SIZE - 6;

    items.forEach((item, i)=>{
      const col = cols[i % cols.length];
      const x = col*G.CELL + (G.CELL-G.EMOJI_SIZE)/2;
      // 縦方向にランダムズレ + 少しのインデックスズレ
      const y = baseY - (4 + Math.floor(Math.random()*18)) - i*8;

      const el = document.createElement('div');
      el.className = 'emoji';
      el.textContent = item.e;
      el.style.left = x+"px";
      el.style.top = y+"px";
      el.style.width = G.EMOJI_SIZE+"px";
      el.style.height = G.EMOJI_SIZE+"px";
      el.dataset.col = col;
      el.addEventListener('pointerdown', (ev)=> G.onEmojiClick(ev, item, el, waveId));

      G.stage.appendChild(el);
      G.emojis.push({ item, el, x, y, col, groupId: waveId });
    });
  };

  G.spawnWaveSequence = function(){
    if (G.pendingWaveTimer !== null) return; // 二重起動ガード

    const times = computeWaveTimes(G.unresolvedTargets.length); // 複数語彙=2秒、単一=即時
    G.pendingWaveTimer = setTimeout(()=>{
      G.pendingWaveTimer = null;
      G.unresolvedTargets.forEach((t, i)=>{
        const waveId = ++G.groupIdSeq;
        G.activeGroups.add(waveId);
        setTimeout(()=>{ if(G.running) G.spawnWave(t, waveId); }, times[i]);
      });
    }, 0);
  };
});

/*** [05.group-end] クリック/着底/クリア処理 ************************************/
defineBlock('05.group-end', () => {
  G.onEmojiClick = function(ev, item, el, groupId){
    if(!G.running) return;

    // 先に未解決から削除
    const hitIdx = G.unresolvedTargets.findIndex(t => t.e === item.e);
    const isHit = (hitIdx !== -1);

    if(isHit){
      G.combo += 1;
      G.addScore(10 + G.combo);
      if(G.combo % 5 === 0){ G.showComboFlash(); }

      if (hitIdx !== -1) {
        G.unresolvedTargets.splice(hitIdx,1);
      }

      // ★ Lv2以降：常に "未解決の個数 = levelSize" を維持するため、新規ターゲットを補充
      if (G.level >= 2) {
        while (G.unresolvedTargets.length < G.levelSize) {
          const exclude = G.unresolvedTargets.map(t => t.e);
          const newItem = G.pickOneNewTarget(exclude);
          if (!newItem) break;
          // 同一ターン内で重複しないように
          if (!exclude.includes(newItem.e)) {
            G.unresolvedTargets.push(newItem);
          } else {
            break; // 念のため無限ループ回避
          }
        }
      }

      G.renderTargets();
      G.clearGroup(groupId, false); // その波は全消し（内部で次の遷移判断）

      G.correctCount++;
      G.handleLevels();
      G.checkGameClear(); // 1000点でクリア
    } else {
      G.combo = 0; G.updateCombo();
      G.pushMiss(item.e);
    }
  };

  G.handleTouchDown = function(o){
    G.combo = 0; G.updateCombo();
    G.pushMiss(o.item.e);
    G.clearGroup(o.groupId, true); // この波は全ストーン化
  };

  G.clearGroup = function(groupId, asStone=false){
    const touchedCols = new Set();

    for(let i=G.emojis.length-1; i>=0; i--){
      const o = G.emojis[i];
      if(o.groupId !== groupId) continue;

      if(asStone){
        const row = G.stoneHeights[o.col];
        const stoneEl = document.createElement('div');
        stoneEl.className='stone';
        stoneEl.style.left = (o.col*G.CELL) + 'px';
        stoneEl.style.top = (G.BOX_H - (row+1)*G.CELL) + 'px';
        stoneEl.style.width = G.CELL + 'px';
        stoneEl.style.height = G.CELL + 'px';
        G.stage.appendChild(stoneEl);

        G.stones.push({ col:o.col, row, el:stoneEl });
        G.stoneHeights[o.col]++;
        G.stoneCountEl.textContent = G.stones.length;
        touchedCols.add(o.col);
      }

      o.el.remove();
      G.emojis.splice(i,1);
    }

    // このグループ（=1問）終了
    G.questionIndex++;

    // 最上段到達でゲームオーバー
    const maxRows = Math.floor(G.BOX_H / G.CELL);
    for(const c of touchedCols){
      if(G.stoneHeights[c] >= maxRows){
        G.gameOver();
        return;
      }
    }

    G.activeGroups.delete(groupId);

    // すべての波が処理済みなら、未解決語彙の有無で遷移
    if(G.activeGroups.size === 0){
      if(G.unresolvedTargets.length > 0){
        setTimeout(G.spawnWaveSequence, 400);
      } else {
        setTimeout(G.nextTurn, 400);
      }
    }
  };
});

/*** [06.loop] メインループ *****************************************************/
defineBlock('06.loop', () => {
  G.loop = function(ts){
    if(!G.running){ G.rafId = null; return; }
    if(!G.lastTime) G.lastTime = ts;
    const dt = (ts - G.lastTime) / 1000;
    G.lastTime = ts;

    const fallPx = G.fallSpeed * dt;
    for(let i=G.emojis.length-1; i>=0; i--){
      const o = G.emojis[i];
      const maxY = G.BOX_H - (G.stoneHeights[o.col] * G.CELL) - G.EMOJI_SIZE - 2;
      o.y = Math.min(o.y + fallPx, maxY);
      o.el.style.top = o.y + 'px';

      if(o.y >= maxY - 0.5){
        G.handleTouchDown(o);
        break;
      }
    }

    G.rafId = requestAnimationFrame(G.loop);
  };
});

/*** [07.turn] ターン進行 *******************************************************/
defineBlock('07.turn', () => {
  G.nextTurn = function(){
    G.pickTargets(G.levelSize);         // レベルに応じて 1/2/3 語
    if (G.unresolvedTargets.length === 0) return; // 念のため
    G.spawnWaveSequence();              // 2秒間隔で連続出現
  };
});

/*** [08.score-ui] スコア/演出/UI補助 ******************************************/
defineBlock('08.score-ui', () => {
  // 一度だけステージ用のオーバーレイ＆トースト用CSSを注入
  (function ensureFxStyles(){
    if (document.getElementById('fx-style')) return;
    const st = document.createElement('style');
    st.id = 'fx-style';
    st.textContent = `
      .fx-overlay{
        position:absolute; inset:0; background:rgba(0,0,0,.45);
        display:none; z-index:9;
      }
      .fx-toast{
        position:absolute; left:50%; top:50%; transform:translate(-50%,-50%) scale(.92);
        background:linear-gradient(180deg,#17203a,#10182b);
        border:2px solid #4c66d4; border-radius:14px; padding:14px 18px;
        color:#e8edf6; text-align:center; z-index:10; box-shadow:0 16px 50px rgba(0,0,0,.55);
        font-weight:900; letter-spacing:.02em; opacity:0; transition:opacity .15s, transform .15s;
      }
      .fx-toast.show{ opacity:1; transform:translate(-50%,-50%) scale(1); }
      .fx-toast .big{ font-size:22px; margin-bottom:4px; text-transform:uppercase; }
      .fx-toast .sub{ font-size:13px; opacity:.9 }
      .fx-toast.level{ border-color:#32b67a; }
      .fx-toast.over { border-color:#ff6f7a; }
      .fx-toast.clear{ border-color:#ffd44d; }
      .pulse{ animation:pulse 1.2s ease-in-out 2; }
      @keyframes pulse{ 0%{ transform:translate(-50%,-50%) scale(0.94);} 50%{ transform:translate(-50%,-50%) scale(1.03);} 100%{ transform:translate(-50%,-50%) scale(1);} }
    `;
    document.head.appendChild(st);

    // オーバーレイは1回だけ作る
    const ov = document.createElement('div');
    ov.className = 'fx-overlay';
    ov.id = 'fxOverlay';
    G.stage.appendChild(ov);
  })();

  function showToast(kind, title, sub){
    // kind: 'level' | 'over' | 'clear'
    const toast = document.createElement('div');
    toast.className = `fx-toast ${kind}`;
    toast.innerHTML = `<div class="big">${title}</div>${sub ? `<div class="sub">${sub}</div>` : ''}`;
    G.stage.appendChild(toast);
    // オーバーレイ（Game Over/Clearのみ）
    const overlay = document.getElementById('fxOverlay');
    if (kind === 'over' || kind === 'clear') {
      overlay.style.display = 'block';
    }
    // 出現
    requestAnimationFrame(()=> toast.classList.add('show','pulse'));
    // LevelUpは短時間で自動消滅
    if (kind === 'level'){
      setTimeout(()=> { toast.remove(); }, 1200);
    } else {
      // Over/Clearはバナー併用なのでトーストは短めに
      setTimeout(()=> { toast.remove(); }, 1500);
    }
  }

  G.addScore = function(n){
    G.score += n;
    G.scoreEl.textContent = G.score;
    G.updateCombo();

    // 100点ごとにストーン1個除去
    const milestone = Math.floor(G.score/100);
    if(milestone > G.lastMilestone){
      for(let i=0;i<milestone-G.lastMilestone;i++) G.removeOneStone();
      G.lastMilestone = milestone;
    }
  };

  G.updateCombo = function(){ G.comboEl.textContent = `+${G.combo}`; };

  G.showComboFlash = function(){
    G.flashEl.classList.remove('show');
    void G.flashEl.offsetWidth; // reflow
    G.flashEl.classList.add('show');
  };

  // ★ 英語の LevelUp トースト（強調）
  G.showLevelUp = function(text){
    showToast('level', text, 'Keep going!');
  };

  G.pushMiss = function(emoji){
    if(!emoji) return;
    if(!G.recentMiss.includes(emoji)){
      G.recentMiss.unshift(emoji);
      if(G.recentMiss.length>16) G.recentMiss.pop();
      G.renderMiss();
    }
  };

  G.renderMiss = function(){
    G.missListEl.innerHTML='';
    G.recentMiss.forEach(e=>{
      const pill = document.createElement('div');
      pill.className='miss-pill';
      pill.innerHTML = `<span class="x">×</span><span>${e}</span>`;
      G.missListEl.appendChild(pill);
    });
  };

  G.removeOneStone = function(){
    let maxH = Math.max(...G.stoneHeights);
    if(maxH<=0) return;
    const col = G.stoneHeights.findIndex(h=>h===maxH);
    const idx = G.stones.findIndex(s=>s.col===col && s.row===G.stoneHeights[col]-1);
    if(idx!==-1){
      const s = G.stones[idx];
      s.el.remove();
      G.stones.splice(idx,1);
    }
    G.stoneHeights[col] = Math.max(0, G.stoneHeights[col]-1);
    G.stoneCountEl.textContent = G.stones.length;
  };

  G.checkGameClear = function(){
    if(G.score >= 1000){
      G.gameClear();
    }
  };

  // ★ Game Clear/Over を英語で強調（バナー文言の上書き＋トースト＋オーバーレイ）
  G.gameClear = function(){
    G.running = false;
    if(G.rafId) cancelAnimationFrame(G.rafId);

    // バナー英語化と強調
    if (G.gcBanner){
      G.gcBanner.style.display = 'block';
      G.gcBanner.querySelector('.b-title').textContent = 'GAME CLEAR!';
      const sub = G.gcBanner.querySelector('.b-sub');
      if (sub) sub.innerHTML = 'You reached <b>Score 1000</b>. Great job!';
    }
    if (G.goBanner) G.goBanner.style.display = 'none';

    showToast('clear', 'GAME CLEAR!', 'Fantastic!');
    const overlay = document.getElementById('fxOverlay');
    if (overlay) overlay.style.display = 'block';
  };

  G.gameOver = function(){
    G.running = false;
    if(G.rafId) cancelAnimationFrame(G.rafId);

    if (G.goBanner){
      G.goBanner.style.display = 'block';
      const t = G.goBanner.querySelector('.b-title');
      if (t) { t.textContent = 'GAME OVER'; t.classList.add('go'); }
      const sub = G.goBanner.querySelector('.b-sub');
      if (sub) sub.textContent = 'Stones reached the top.';
    }
    if (G.gcBanner) G.gcBanner.style.display = 'none';

    showToast('over', 'GAME OVER', 'Try again!');
    const overlay = document.getElementById('fxOverlay');
    if (overlay) overlay.style.display = 'block';
  };
});

/*** [09.controls] コントロール *************************************************/
defineBlock('09.controls', () => {
  G.start = function(){
    if(G.running) return;
    G.running = true;
    G.lastTime = 0;
    G.rafId = requestAnimationFrame(G.loop);
    G.nextTurn(); // 初回から必ず波を出す
  };

  G.pause = function(){ G.running = false; };

  G.reset = function(){
    G.running = false;
    if(G.rafId) cancelAnimationFrame(G.rafId);
    G.rafId = null; G.lastTime = 0;

    G.emojis.forEach(o=>o.el.remove()); G.emojis = [];
    G.stones.forEach(s=>s.el.remove()); G.stones = [];
    G.stoneHeights.fill(0); G.stoneCountEl.textContent = '0';

    G.score = 0; G.lastMilestone = 0; G.scoreEl.textContent = '0';
    G.combo = 0; G.updateCombo(); G.recentMiss=[]; G.renderMiss();

    G.fallSpeed = 110;
    G.correctCount = 0;
    G.levelSize = 1;
    G.groupSize = 4;
    G.currentTargets = [];
    G.unresolvedTargets = [];
    G.activeGroups.clear();
    G.groupIdSeq = 0;

    G.gcBanner.style.display = 'none';
    G.goBanner.style.display = 'none';

    G.pendingWaveTimer = null;
    G.lastShownWord = '—';

    // 次のターンのために一回だけ語彙を仮セット（UI表示用）
    G.pickTargets(G.levelSize);
  };
});

/*** [10.events-init] イベント & 初期化 ***************************************/
defineBlock('10.events-init', () => {
  // まずUIラベルを英語に差し替え（HTMLを触らずに英語化）
  (function localizeToEnglish(){
    const byTextReplace = [
      // 左下ターゲットラベル
      { sel: '.target-label', text: 'Current target(s): ' },

      // ボタン
      { sel: '#startBtn', text: 'Start' },
      { sel: '#pauseBtn', text: 'Pause' },
      { sel: '#resetBtn', text: 'Reset' },

      // 右パネルの見出しなど（存在する場合のみ）
      // スコア小見出し
      { sel: '.side .panel .sub', index: 0, text: 'Score (+10 for correct + streak bonus)' },
    ];

    byTextReplace.forEach(({sel, text, index})=>{
      const nodes = document.querySelectorAll(sel);
      if (!nodes || nodes.length===0) return;
      const el = (typeof index==='number') ? nodes[index] : nodes[0];
      if (el) el.textContent = text;
    });

    // 「Mistakes」パネルの見出し
    const panels = document.querySelectorAll('.side .panel');
    if (panels[1]){
      const head = panels[1].querySelector('div[style*="font-weight"]');
      if (head) head.textContent = 'Mistakes';
    }

    // 「How to Play」パネルの英語化（簡潔版）
    if (panels[2]){
      const head = panels[2].querySelector('div[style*="font-weight"]');
      if (head) head.textContent = 'How to Play';
      const body = panels[2].querySelector('.sub');
      if (body) body.innerHTML = `
        Tap the emoji that matches the target word(s) below.<br>
        Correct: <b>+10</b> + streak bonus (+1, +2, ...).<br>
        A wrong tap resets the streak.<br>
        When an emoji touches the bottom, it turns into a <b>🪨 stone</b> and stacks up.<br>
        Every <b>100</b> points removes <b>1</b> stone.<br><br>
        Lv2: <b>2 targets</b> (waves every 2s), Lv3: <b>3 targets</b>, Lv4: <b>5 emoji</b> at once.
      `;
    }

    // バナー英語化（初期表示時点）
    const gc = document.getElementById('gcBanner');
    if (gc){
      const t = gc.querySelector('.b-title'); if (t) t.textContent = 'GAME CLEAR!';
      const s = gc.querySelector('.b-sub');
      if (s) s.innerHTML = 'You reached <b>Score 1000</b>. Great job!';
    }
    const go = document.getElementById('goBanner');
    if (go){
      const t = go.querySelector('.b-title'); if (t) t.textContent = 'GAME OVER';
      const s = go.querySelector('.b-sub');   if (s) s.textContent = 'Stones reached the top.';
    }
  })();

  // イベント
  $('#startBtn').addEventListener('click', ()=>{ G.start(); });
  $('#pauseBtn').addEventListener('click', ()=> G.pause());
  $('#resetBtn').addEventListener('click', ()=> G.reset());
  window.addEventListener('keydown', (e)=>{ if(e.code==='Space'){ G.running ? G.pause() : G.start(); } });
  G.gcReset?.addEventListener('click', ()=>{ G.reset(); G.start(); });
  G.goReset?.addEventListener('click', ()=>{ G.reset(); G.start(); });

  // 初期表示
  G.reset();
});

/* === 全ブロック実行（ここは触らない） === */
runBlocks();
