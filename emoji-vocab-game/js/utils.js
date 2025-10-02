// ===== ユーティリティ群 =====
const $ = sel => document.querySelector(sel);

function choice(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

function sampleWithout(arr, n, excludeEmoji){
  const pool = arr.filter(x => x.e !== excludeEmoji);
  const picked = [];
  while (picked.length < Math.min(n, pool.length)) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx,1)[0]);
  }
  return picked;
}

// できるだけ離れた列を選ぶ（差が2以上を優先）
function pickSeparatedColumns(totalCols, n){
  const cols = [...Array(totalCols).keys()];
  const result = [];
  while(result.length < n && cols.length){
    const idx = Math.floor(Math.random()*cols.length);
    const c = cols.splice(idx,1)[0];
    if(result.every(rc => Math.abs(rc - c) >= 2)){
      result.push(c);
    }
  }
  // 不足があればランダム補完
  while(result.length < n){
    const c = Math.floor(Math.random()*totalCols);
    if(!result.includes(c)) result.push(c);
  }
  return result.slice(0,n);
}

// 複数語彙時の波間隔（2秒固定）。単一語彙は即時
function computeWaveTimes(count){
  if(count <= 1) return [0];
  const gap = 2000; // 2秒
  return Array.from({length: count}, (_, i) => i * gap);
}
