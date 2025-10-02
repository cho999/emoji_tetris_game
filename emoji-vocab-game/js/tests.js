// 開発時だけ実行：URLに ?devtest=1 を付けると走る（本番挙動に影響なし）
(function runDevTests(){
  const params = new URLSearchParams(location.search);
  if(params.get('devtest') !== '1') return;

  console.log('[DEVTEST] start');

  // computeWaveTimes: 2秒間隔 / 単一は0
  console.assert(JSON.stringify(computeWaveTimes(1)) === JSON.stringify([0]), 'computeWaveTimes(1)');
  console.assert(JSON.stringify(computeWaveTimes(2)) === JSON.stringify([0,2000]), 'computeWaveTimes(2)');
  console.assert(JSON.stringify(computeWaveTimes(3)) === JSON.stringify([0,2000,4000]), 'computeWaveTimes(3)');

  // pickSeparatedColumns: 個数・重複なし・範囲内
  (function(){
    const cols = pickSeparatedColumns(10, 5);
    console.assert(cols.length === 5, 'pickSeparatedColumns length');
    console.assert(new Set(cols).size === cols.length, 'pickSeparatedColumns unique');
    console.assert(cols.every(c => c >= 0 && c < 10), 'pickSeparatedColumns range');
  })();

  // sampleWithout: 除外が含まれない、長さが要求以内
  (function(){
    const exclude = "🍣";
    const result = sampleWithout(ALL_ITEMS, 6, exclude);
    console.assert(result.length <= 6, 'sampleWithout length bound');
    console.assert(!result.some(x => x.e === exclude), 'sampleWithout excludes');
  })();

  console.log('[DEVTEST] done');
})();
