// verify.js — 驗證 index.html 內建邏輯（CSV 解析、欄位對應、比對評分、折扣/買贈計算、表格渲染）
// 用法： node verify.js
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) { console.error('FAIL: 找不到內嵌 script'); process.exit(1); }
const code = scriptMatch[1];

function makeEl(id) {
    return {
        id, value: '', textContent: '', innerHTML: '', style: {},
        files: null,
        classList: { add() {}, remove() {} },
        dataset: {},
        addEventListener() {},
        click() {}
    };
}
const els = {};
['searchInput', 'categorySelect', 'discountInput', 'tableBody', 'statusNote', 'matchHint', 'pickCsvBtn', 'csvFileInput']
    .forEach(function (id) { els[id] = makeEl(id); });
els.searchInput.value = '';
els.categorySelect.value = 'all';
els.discountInput.value = '10';

const documentStub = {
    getElementById: function (id) { return els[id] || makeEl(id); },
    querySelectorAll: function () { return []; }
};

// 讓 loadData 的載入鏈永遠 pending，避免非同步覆蓋測試中的表格
const fetchStub = function () { return new Promise(function () {}); };

const api = new Function(
    'document', 'fetch', 'AbortController', 'setTimeout', 'clearTimeout', 'FileReader',
    code + '\nreturn { parseCSV, buildData, parsePrice, calcPrice, renderTable, applyCsv, FACTORIES, ' +
    'normalizeSearchText, splitNameSpec, searchRows, buildSearchIndex, matchBadge, ' +
    'scoreExactTier, scoreFuzzyTier, editSimilarity, levenshteinDistance, uniqueCharMatchScore, SAMPLE_CSV_TEXT, ' +
    'getSuggestions, escapeHtml, ' +
    'setState: function(m, d){ currentMode = m; discount = d; } };'
)(documentStub, fetchStub, AbortController, setTimeout, clearTimeout, function () {});

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { pass++; console.log('PASS  ' + name); }
    else { fail++; console.log('FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

const sample = fs.readFileSync(path.join(__dirname, 'sample-data.csv'), 'utf8');

// ---------- 1. CSV 解析 ----------
const rows = api.parseCSV(sample);
check('CSV 列數 = 8（表頭+7筆）', rows.length === 8, 'got ' + rows.length);
check('欄數 = 13', rows[0].length === 13 && rows[1].length === 13, 'head=' + rows[0].length + ' row1=' + rows[1].length);
check('引號內逗號未被拆欄', rows[2][5] === '停售,待通知', 'got [' + rows[2][5] + ']');

// ---------- 2. 欄位對應 ----------
const built = api.buildData(sample);
check('資料筆數 = 7', built.data.length === 7, 'got ' + built.data.length);
check('無缺欄警告', built.missing.length === 0, built.missing.join(','));

const guizhi = built.data.find(function (x) { return x.name.indexOf('桂枝湯') !== -1; });
check('桂枝湯 富田=1200', guizhi.prices['富田'] === 1200);
check('桂枝湯 莊松榮=空白(null)', guizhi.prices['莊松榮'] === null);
check('桂枝湯 分類=複方', guizhi.category === '複方', guizhi.category);

const dahuang = built.data.find(function (x) { return x.name.indexOf('大黃') !== -1; });
check('非數字保留文字(停售,待通知)', dahuang.prices['科達'] === '停售,待通知', String(dahuang.prices['科達']));
check('時價保留文字', dahuang.prices['天明'] === '時價', String(dahuang.prices['天明']));

// ---------- 3. 品名／規格拆分 ----------
const p1 = api.splitNameSpec('桂枝湯 200g');
check('拆規格：桂枝湯/200g', p1.core === '桂枝湯' && p1.spec === '200g', p1.core + '/' + p1.spec);
const p2 = api.splitNameSpec('六味地黃丸 丸劑 500g');
check('拆規格：核心含劑型', p2.core === '六味地黃丸 丸劑' && p2.spec === '500g', p2.core + '/' + p2.spec);
const p3 = api.splitNameSpec('科學中藥錠劑 1000錠');
check('拆規格：錠數', p3.core === '科學中藥錠劑' && p3.spec === '1000錠', p3.core + '/' + p3.spec);
const p4 = api.splitNameSpec('一貫煎錠');
check('無規格數字不動刀', p4.core === '一貫煎錠' && p4.spec === '', p4.core + '/' + p4.spec);

// ---------- 4. 正規化（簡繁／全形／空白）----------
check('簡體轉繁體', api.normalizeSearchText('桂枝汤') === '桂枝湯', api.normalizeSearchText('桂枝汤'));
check('去除空白', api.normalizeSearchText(' 桂枝湯 200g ') === '桂枝湯200g', api.normalizeSearchText(' 桂枝湯 200g '));
check('全形數字轉半形', api.normalizeSearchText('六味地黃丸２００ｇ') === '六味地黃丸200g', api.normalizeSearchText('六味地黃丸２００ｇ'));
check('去除標點', api.normalizeSearchText('桂枝湯，') === '桂枝湯', api.normalizeSearchText('桂枝湯，'));

// ---------- 5. 相似度函式 ----------
check('levenshtein(abc,abd)=1', api.levenshteinDistance('abc', 'abd') === 1);
check('editSimilarity 完全相同=1', api.editSimilarity('桂枝湯', '桂枝湯') === 1);
check('editSimilarity(桂枝湯,桂支湯)=0.667', Math.abs(api.editSimilarity('桂枝湯', '桂支湯') - 2 / 3) < 1e-9, String(api.editSimilarity('桂枝湯', '桂支湯')));
check('字元集合相似度(桂枝湯,桂支湯)=0.667', Math.abs(api.uniqueCharMatchScore('桂枝湯', '桂支湯') - 2 / 3) < 1e-9);

// ---------- 6. 評分層級 ----------
check('完全相同 = 10000', api.scoreExactTier('桂枝湯', '桂枝湯') === 10000);
check('開頭符合 = 9000+len*10', api.scoreExactTier('桂枝', '桂枝湯') === 9020, String(api.scoreExactTier('桂枝', '桂枝湯')));
check('名稱包含 = 8000+len*10', api.scoreExactTier('地黃', '六味地黃丸') === 8020, String(api.scoreExactTier('地黃', '六味地黃丸')));
// 註：原始頁面的 9500「後綴省略」分層在實際執行時到不了——名稱以查詢開頭時，
// 第 2 層 startsWith 會先回傳 9000+len*10。這裡保留分層程式碼，但驗證真實行為。
check('後綴品名（炙甘草 vs 炙甘草湯）= 開頭 9030', api.scoreExactTier('炙甘草', '炙甘草湯') === 9030,
    String(api.scoreExactTier('炙甘草', '炙甘草湯')));
check('2字不做模糊', api.scoreFuzzyTier('桂支', '桂枝湯') === 0, String(api.scoreFuzzyTier('桂支', '桂枝湯')));

// ---------- 7. 搜尋行為 ----------
api.applyCsv(sample, 'test', false);

const r1 = api.searchRows('桂枝湯');
check('搜「桂枝湯」→ 1 筆，完全符合', r1.length === 1 && r1[0].score === 10000, 'n=' + r1.length + ' score=' + (r1[0] && r1[0].score));

const r2 = api.searchRows('桂枝');
check('搜「桂枝」→ 命中桂枝湯（開頭符合）', r2.length >= 1 && r2[0].item.name.indexOf('桂枝湯') !== -1 && r2[0].score >= 9000, 'n=' + r2.length + ' score=' + (r2[0] && r2[0].score));

const r3 = api.searchRows('桂枝汤');
check('簡體查詢也能命中', r3.length >= 1 && r3[0].item.name.indexOf('桂枝湯') !== -1);

const r4 = api.searchRows('炙甘草');
check('搜「炙甘草」→ 2 筆（單方與方劑都要列出）', r4.length === 2, 'n=' + r4.length);
check('單方 炙甘草 排第一（完全符合 10000）', r4[0] && r4[0].item.name === '炙甘草 100g' && r4[0].score === 10000, r4[0] && (r4[0].item.name + ' / ' + r4[0].score));
check('方劑 炙甘草湯 次之（開頭符合 ≥9000）', r4[1] && r4[1].item.name === '炙甘草湯 200g' && r4[1].score >= 9000, r4[1] && (r4[1].item.name + ' / ' + r4[1].score));

const r5 = api.searchRows('六味地黃丸');
check('搜「六味地黃丸」→ 2 筆（200g 與丸劑兩規格都列出）', r5.length === 2, 'n=' + r5.length);
check('200g 版排第一（核心完全符合）', r5[0] && r5[0].item.name === '六味地黃丸 200g' && r5[0].score === 10000, r5[0] && (r5[0].item.name + ' / ' + r5[0].score));
check('丸劑規格仍在清單中', r5.some(function (x) { return x.item.name === '六味地黃丸 丸劑 500g'; }));

const r5b = api.searchRows('六味地黃凡');
check('錯一字 → 模糊比對命中（分數落在 5000 段）', r5b.length >= 1 && r5b[0].score >= 5000 && r5b[0].score < 6000,
    'n=' + r5b.length + ' score=' + (r5b[0] && r5b[0].score));

const r6 = api.searchRows('阿斯匹靈');
check('查無此藥 → 0 筆', r6.length === 0, 'n=' + r6.length);

const r7 = api.searchRows('桂');
check('單字查詢只做精確層（不亂配）', r7.length >= 1 && r7.every(function (x) { return x.score >= 7600; }),
    'n=' + r7.length + ' minScore=' + Math.min.apply(null, r7.map(function (x) { return x.score; })));

// ---------- 8. 符合度標籤 ----------
check('10000 → 完全符合', api.matchBadge(10000).label === '完全符合');
check('9500 → 簡稱符合', api.matchBadge(9500).label === '簡稱符合');
check('9020 → 開頭符合', api.matchBadge(9020).label === '開頭符合');
check('8020 → 名稱包含', api.matchBadge(8020).label === '名稱包含');
check('5200 → 相似', api.matchBadge(5200).label === '相似');

// ---------- 9. 計算邏輯 ----------
api.setState('origin', 10);
check('原價 1000 → 1000', api.calcPrice(1000) === 1000, '' + api.calcPrice(1000));
api.setState('5+1', 10);
check('1000 5+1 → 833', api.calcPrice(1000) === 833, '' + api.calcPrice(1000));
api.setState('10+1', 10);
check('1000 10+1 → 909', api.calcPrice(1000) === 909, '' + api.calcPrice(1000));
api.setState('5+1', 6);
check('1000 打6折 + 5+1 → 500', api.calcPrice(1000) === 500, '' + api.calcPrice(1000));
check('文字值不參與運算', api.calcPrice('時價') === '時價');
check('null 不參與運算', api.calcPrice(null) === null);

// ---------- 10. 渲染與提示 ----------
api.setState('origin', 10);
els.searchInput.value = '桂枝';
api.renderTable();
check('渲染：搜「桂枝」只留 1 列', (els.tableBody.innerHTML.match(/<tr>/g) || []).length === 1,
    'rows=' + (els.tableBody.innerHTML.match(/<tr>/g) || []).length);
check('渲染：千分位 1,200', els.tableBody.innerHTML.indexOf('1,200') !== -1);
check('渲染：符合度標籤出現', els.tableBody.innerHTML.indexOf('badge') !== -1);

els.searchInput.value = '炙甘草';
api.renderTable();
check('渲染：多筆時列出 2 列且顯示標籤', (els.tableBody.innerHTML.match(/<tr>/g) || []).length === 2 &&
    els.tableBody.innerHTML.indexOf('完全符合') !== -1 && els.tableBody.innerHTML.indexOf('開頭符合') !== -1);

els.searchInput.value = '地黃';
api.renderTable();
check('短查詢多筆 → 顯示不自動挑選提示', els.matchHint.style.display === 'block' && els.matchHint.textContent.indexOf('未自動挑選') !== -1,
    String(els.matchHint.textContent));

els.searchInput.value = '六味地黃凡';
api.renderTable();
check('低信心單筆 → 顯示相似品項提示', els.matchHint.style.display === 'block' && els.matchHint.textContent.indexOf('查無精確符合') !== -1,
    String(els.matchHint.textContent));

// 內建示範資料（發布成線上網頁、相對路徑 CSV 不存在時的最後備援）
const inline = api.buildData(api.SAMPLE_CSV_TEXT);
check('內建示範資料可解析', inline.data.length === 7, 'n=' + inline.data.length);
check('內建示範資料無缺欄', inline.missing.length === 0, inline.missing.join('、'));

// 輸入時的品項預選
const sug1 = api.getSuggestions('地黃');
check('預選：輸入 2 字 → 列出候選', sug1.length === 2, 'n=' + sug1.length);
check('預選：候選帶符合度分數可用', sug1.every(function (s) { return typeof s.score === 'number'; }));
const sug2 = api.getSuggestions('桂枝');
check('預選：輸入「桂枝」→ 第一個是桂枝湯', sug2.length >= 1 && sug2[0].item.name === '桂枝湯 200g',
    sug2[0] && sug2[0].item.name);
const sug3 = api.getSuggestions('湯');
check('預選：單字查詢也有候選（不空白）', sug3.length >= 1, 'n=' + sug3.length);
const sug4 = api.getSuggestions('');
check('預選：空字串不顯示候選', sug4.length === 0, 'n=' + sug4.length);
const sug5 = api.getSuggestions('地黃', 2);
check('預選：上限可調', sug5.length === 2, 'n=' + sug5.length);
check('HTML 轉義：< > & 正確處理',
    api.escapeHtml('<b>A&B</b>') === '&lt;b&gt;A&amp;B&lt;/b&gt;', api.escapeHtml('<b>A&B</b>'));

els.searchInput.value = '';
els.categorySelect.value = '錠劑';
api.renderTable();
check('分類篩選(錠劑) = 1 列', (els.tableBody.innerHTML.match(/<tr>/g) || []).length === 1);
check('無關鍵字時不顯示標籤', els.tableBody.innerHTML.indexOf('badge') === -1);

els.categorySelect.value = 'all';
els.searchInput.value = '不存在的藥';
api.renderTable();
check('查無資料提示', els.tableBody.innerHTML.indexOf('無符合條件的藥品') !== -1);

els.searchInput.value = '桂枝';
api.setState('5+1', 10);
api.renderTable();
const first = els.tableBody.innerHTML.match(/class="price-num">([^<]+)</);
check('5+1 模式 1200 → 1,000', first && first[1] === '1,000', first ? first[1] : 'none');

// ---------- 11. 真實試算表表頭（多版本欄位、無分類欄） ----------
// 忠實還原 Google 試算表匯出的表頭：廠牌名後接年份／月份，且同一廠牌多欄
const REAL_LIKE_CSV = [
    '品名規格,"富田\n113年5月",富田115年9月價格,富田115年11月價格(2026.11.01),"仙豐115年7月價格\n(2026/07/01)",勝昌112年12月價格,勝昌115年9月價格,順天堂112年11月價格,順天堂115年11月價格',
    '乙字湯,,480,480,510,450,470,470,480',
    '三黃錠1000錠,,,(暫時停產)550,,,,(暫時停產)550,',
    '舊價品,,,,,380,,,'
].join('\n');

const realLike = api.buildData(REAL_LIKE_CSV);
check('真實表頭：可解析出資料列', realLike.data.length === 3, 'n=' + realLike.data.length);
check('真實表頭：無分類欄時 hasCategory=false', realLike.hasCategory === false);
check('真實表頭：有出現的廠牌都對應到（富田/仙豐/勝昌/順天堂）',
    !realLike.missing.includes('富田') && !realLike.missing.includes('仙豐') &&
    !realLike.missing.includes('勝昌') && !realLike.missing.includes('順天堂'),
    realLike.missing.join('、'));
check('真實表頭：富田取最新欄（115年11月）',
    realLike.data[0].prices['富田'] === 480, '' + realLike.data[0].prices['富田']);
check('真實表頭：最新欄無價時往前找有價欄（三黃錠 順天堂=暫停產）',
    realLike.data[1].prices['順天堂'] === '(暫時停產)550', String(realLike.data[1].prices['順天堂']));
check('真實表頭：舊欄才有價時仍能取到（舊價品 勝昌=380）',
    realLike.data[2].prices['勝昌'] === 380, '' + realLike.data[2].prices['勝昌']);

api.applyCsv(REAL_LIKE_CSV, '真實表頭', false);
check('真實表頭：查「乙字湯」能查到', api.searchRows('乙字湯').length === 1);
check('真實表頭：乙字湯 富田 480', api.searchRows('乙字湯')[0].item.prices['富田'] === 480);
check('真實表頭：查「乙」有候選', api.getSuggestions('乙').length >= 1);

// 還原成示範資料，避免影響後續手動測試
api.applyCsv(api.SAMPLE_CSV_TEXT, '內建示範資料', true);

console.log('\n===== ' + pass + ' passed, ' + fail + ' failed =====');
process.exit(fail === 0 ? 0 : 1);
