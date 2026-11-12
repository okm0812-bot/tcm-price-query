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
        files: null, title: '',
        children: [],
        lastElementChild: null,
        parentNode: null,
        classList: { add() {}, remove() {} },
        dataset: {},
        appendChild() {}, removeChild() {},
        setAttribute() {}, getAttribute() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        addEventListener() {},
        click() {}
    };
}
const els = {};
['searchInput', 'categorySelect', 'discountInput', 'resultList', 'giftGrid', 'statusNote', 'matchHint', 'pickCsvBtn', 'csvFileInput', 'selectedChips', 'suggestList', 'searchBtn', 'copyBtn', 'updatedNote', 'clearBtn', 'giftSummary', 'updatedBody']
    .forEach(function (id) { els[id] = makeEl(id); });
els.searchInput.value = '';
els.categorySelect.value = 'all';
els.discountInput.value = '10';

const documentStub = {
    getElementById: function (id) { return els[id] || makeEl(id); },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    createElement: function (tag) { return makeEl('new-' + tag); }
};

// 讓 loadData 的載入鏈永遠 pending，避免非同步覆蓋測試中的表格
const fetchStub = function () { return new Promise(function () {}); };

const api = new Function(
    'document', 'fetch', 'AbortController', 'setTimeout', 'clearTimeout', 'FileReader',
    code + '\nreturn { parseCSV, buildData, parsePrice, calcPrice, renderTable, applyCsv, FACTORIES, ' +
    'normalizeSearchText, splitNameSpec, searchRows, buildSearchIndex, matchBadge, ' +
    'scoreExactTier, scoreFuzzyTier, editSimilarity, levenshteinDistance, uniqueCharMatchScore, SAMPLE_CSV_TEXT, ' +
    'getSuggestions, escapeHtml, splitQueryTokens, lastTokenInfo, rowsToText, modeLabel, ' +
    'mergeSheets, SHEETS, commitData, runQuery, addSelected, addSelectedByName, removeSelected, ' +
    'clearSelected, renderChips, findItem, clearAll, renderTable, specNoteText, autoExactHit, ' +
    'getQueryRows: function() { return queryRows; }, ' +
    'getSelected: function() { return selectedItems.slice(); }, ' +
    'getDiscount: function() { return defaultDiscount; }, ' +
    'getFactoryDiscounts: function() { return JSON.parse(JSON.stringify(factoryDiscounts)); }, ' +
    'setFactoryDiscount: setFactoryDiscount, ' +
    'getModes: function() { return JSON.parse(JSON.stringify(factoryModes)); }, ' +
    'setFactoryMode: setFactoryMode, ' +
    'setState: function(m, d){ defaultMode = m; defaultDiscount = d; ' +
    'FACTORIES.forEach(function(f){ factoryModes[f] = m; factoryDiscounts[f] = d; }); } };'
)(documentStub, fetchStub, AbortController, setTimeout, clearTimeout, function () {});

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { pass++; console.log('PASS  ' + name); }
    else { fail++; console.log('FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

// 預設折數要是 6 折（使用者指定），1000 → 600
check('預設折扣：頁面初始為 6 折', api.getDiscount() === 6, 'discount=' + api.getDiscount());
check('預設折扣：1000 元自動套 6 折 = 600', api.calcPrice(1000) === 600, '' + api.calcPrice(1000));

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

// ---------- 10. 查詢流程（先點選候選，再按查詢） ----------
api.setState('origin', 10);
api.clearSelected();
els.searchInput.value = '';
api.renderTable();
check('尚未查詢：不列出全部品項，只給操作提示',
    (els.resultList.innerHTML.match(/class="item-card"/g) || []).length === 0 &&
    (els.resultList.innerHTML.match(/class="result-empty"/g) || []).length === 1 &&
    els.resultList.innerHTML.indexOf('輸入完整品名，或點選上面的候選品項') !== -1, els.resultList.innerHTML.slice(0, 120));

api.addSelectedByName('桂枝湯 200g', '複方');
api.runQuery();
check('點選候選後查詢：列出 1 筆', (els.resultList.innerHTML.match(/class="item-card"/g) || []).length === 1,
    'rows=' + (els.resultList.innerHTML.match(/class="item-card"/g) || []).length);
check('查詢結果：千分位 1,200', els.resultList.innerHTML.indexOf('1,200') !== -1);
check('查詢結果：人工點選的品項標「已選取」', els.resultList.innerHTML.indexOf('已選取') !== -1);
check('查詢清單：點選的品項留在清單中', api.getSelected().length === 1, 'n=' + api.getSelected().length);
check('查詢清單：重複點選不會重複加入',
    api.addSelectedByName('桂枝湯 200g', '複方') === false && api.getSelected().length === 1,
    'n=' + api.getSelected().length);

api.clearSelected();
api.addSelectedByName('桂枝湯 200g', '複方');
api.addSelectedByName('炙甘草湯 200g', '複方');
api.runQuery();
check('多筆：兩筆品項各自成一列', (els.resultList.innerHTML.match(/class="item-card"/g) || []).length === 2,
    'rows=' + (els.resultList.innerHTML.match(/class="item-card"/g) || []).length);
check('多筆：提示列說明列出筆數', els.matchHint.style.display === 'block' &&
    els.matchHint.textContent.indexOf('已列出 2 筆品項') !== -1, String(els.matchHint.textContent));

api.removeSelected(0);
check('移除查詢清單品項後結果同步減少',
    api.getQueryRows().length === 1 && (els.resultList.innerHTML.match(/class="item-card"/g) || []).length === 1,
    'n=' + api.getQueryRows().length);

// 打完整品名就自動列出；只打一部分則交給候選清單點選
api.clearSelected();
els.searchInput.value = '炙甘草 100g';
api.runQuery();
check('完整品名：輸入「炙甘草 100g」自動列出 1 筆',
    api.getQueryRows().length === 1 && api.getQueryRows()[0].item.name === '炙甘草 100g',
    api.getQueryRows().map(function (r) { return r.item.name; }).join('、'));
check('完整品名：自動列出後輸入框清空', els.searchInput.value === '', JSON.stringify(els.searchInput.value));

api.clearSelected();
els.searchInput.value = '桂枝';
api.runQuery();
check('只打一部分：不自動列入結果', api.getQueryRows().length === 0, 'n=' + api.getQueryRows().length);
check('只打一部分：提示請從候選清單點選',
    els.matchHint.style.display === 'block' && els.matchHint.textContent.indexOf('待選取') !== -1,
    String(els.matchHint.textContent));
check('只打一部分：文字留在輸入框等使用者點選', els.searchInput.value === '桂枝', JSON.stringify(els.searchInput.value));

// 打字階段不會自己跑查詢（只有完整品名命中才會自動列出）
api.clearSelected();
els.searchInput.value = '不存在的藥';
api.renderTable();
check('打字不自動查詢：沒有查詢結果、也不顯示查無',
    api.getQueryRows() === null && els.resultList.innerHTML.indexOf('查無') === -1,
    String(api.getQueryRows()) + '｜' + els.resultList.innerHTML.slice(0, 80));

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
api.clearSelected();
api.renderTable();
check('未查詢時即使有分類篩選也只顯示提示列',
    (els.resultList.innerHTML.match(/class="item-card"/g) || []).length === 0 &&
    (els.resultList.innerHTML.match(/class="result-empty"/g) || []).length === 1 &&
    els.resultList.innerHTML.indexOf('輸入完整品名，或點選上面的候選品項') !== -1, els.resultList.innerHTML.slice(0, 120));

els.categorySelect.value = 'all';
els.searchInput.value = '不存在的藥';
api.runQuery();
check('查無資料提示', els.resultList.innerHTML.indexOf('查無「不存在的藥」') !== -1, els.resultList.innerHTML.slice(0, 120));

// ---------- 多筆輸入 ----------
check('多筆：換行分隔', api.splitQueryTokens('桂枝湯\n乙字湯').length === 2, String(api.splitQueryTokens('桂枝湯\n乙字湯').length));
check('多筆：逗號／頓號／分號都算分隔',
    api.splitQueryTokens('桂枝湯,乙字湯、炙甘草；大黃').length === 4,
    String(api.splitQueryTokens('桂枝湯,乙字湯、炙甘草；大黃').length));
check('多筆：空白不當分隔（避免拆壞「桂枝湯 200g」）',
    api.splitQueryTokens('桂枝湯 200g').length === 1, String(api.splitQueryTokens('桂枝湯 200g').length));
check('多筆：空字串與多餘分隔不產生空查詢',
    api.splitQueryTokens(' , \n 、 ').length === 0, String(api.splitQueryTokens(' , \n 、 ').length));
check('多筆：lastTokenInfo 取出最後一段',
    api.lastTokenInfo('桂枝湯、炙甘').token === '炙甘' && api.lastTokenInfo('桂枝湯、炙甘').prefix === '桂枝湯、',
    JSON.stringify(api.lastTokenInfo('桂枝湯、炙甘')));

els.searchInput.value = '桂枝湯 200g\n炙甘草 100g';
api.clearSelected();
api.runQuery();
check('多筆：兩行完整品名各自自動列出，合計 2 列',
    (els.resultList.innerHTML.match(/class="item-card"/g) || []).length === 2,
    'rows=' + (els.resultList.innerHTML.match(/class="item-card"/g) || []).length);
check('多筆：提示列說明列出筆數', els.matchHint.style.display === 'block' &&
    els.matchHint.textContent.indexOf('已列出 2 筆品項') !== -1, String(els.matchHint.textContent));

els.searchInput.value = '桂枝湯 200g\n不存在的藥';
api.clearSelected();
api.runQuery();
check('多筆：查無的品項列在提示列', els.matchHint.textContent.indexOf('查無：不存在的藥') !== -1,
    String(els.matchHint.textContent));

els.searchInput.value = '完全查無一\n完全查無二';
api.clearSelected();
api.runQuery();
check('多筆：全部查無時表格顯示查無訊息',
    els.resultList.innerHTML.indexOf('查無「完全查無一、完全查無二」') !== -1, els.resultList.innerHTML.slice(0, 120));

els.searchInput.value = '';
api.clearSelected();
api.addSelectedByName('桂枝湯 200g', '複方');
api.addSelectedByName('六味地黃丸 200g', '複方');
api.addSelectedByName('六味地黃丸 丸劑 500g', '丸劑');
api.runQuery();
check('分類篩選：全部分類時 3 列', (els.resultList.innerHTML.match(/class="item-card"/g) || []).length === 3);
els.categorySelect.value = '丸劑';
api.renderTable();
check('分類篩選：切丸劑後只剩 1 列且結果保留',
    (els.resultList.innerHTML.match(/class="item-card"/g) || []).length === 1 && api.getQueryRows().length === 3);
els.categorySelect.value = 'all';

api.clearSelected();
api.addSelectedByName('桂枝湯 200g', '複方');
api.setState('5+1', 10);
api.runQuery();
const first = els.resultList.innerHTML.match(/class="v">([\d,]+)/);
check('5+1 模式 1200 → 1,000', first && first[1] === '1,000', first ? first[1] : 'none');
check('牌價：有折扣時格子內先顯示牌價', els.resultList.innerHTML.indexOf('牌價 1,200') !== -1,
    els.resultList.innerHTML.slice(0, 200));

// 牌價與折後價成對出現，且折後價＝牌價 × 6 折
api.setState('origin', 6);
api.renderTable();
const lpPair = els.resultList.innerHTML.match(/牌價 ([\d,]+)<\/span><span class="v">([\d,]+)/);
check('牌價：6 折時牌價與折後價並列（1,200 → 720）',
    lpPair && lpPair[1] === '1,200' && lpPair[2] === '720', lpPair ? lpPair[1] + '/' + lpPair[2] : 'none');

// 無折扣時不重複顯示牌價
api.setState('origin', 10);
api.renderTable();
check('牌價：10 折（無折扣）時不重複顯示牌價',
    els.resultList.innerHTML.indexOf('牌價 ') === -1, els.resultList.innerHTML.slice(0, 160));

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

// ---------- 12. 複製查詢結果（LINE 好讀區塊格式） ----------
api.setState('origin', 10);
const fakeItem = {
    category: '複方',
    name: '測試,A',
    core: '測試,A',
    spec: '',
    prices: { '富田': 1000, '仙豐': null, '順天堂': '時價' }
};
const fakeText = api.rowsToText([{ item: fakeItem }]);
const fakeLines = fakeText.split('\n');
check('複製：第一行為品名（示範資料帶分類）', fakeLines[0] === '測試,A（複方）', fakeLines[0]);
check('複製：無價廠牌不列出', fakeText.indexOf('仙豐') === -1, fakeText);
check('複製：有價廠牌排成一行', fakeLines.length === 2, 'lines=' + fakeLines.length);
check('複製：名稱以全角空格補齊欄寬（富田 → 3 字寬）',
    fakeLines[1].indexOf('富田\u3000') === 0, fakeLines[1]);
check('複製：數字與文字值都保留', fakeLines[1].indexOf('1000') !== -1 && fakeLines[1].indexOf('時價') !== -1, fakeLines[1]);

// 3 位數與 4 位數價格要對齊同一條右邊界（LINE 比例字型下 1 空格 ≈ 半個數字寬）
const visWidth = function(s) {
    let u = 0;
    s.split('').forEach(function(c) {
        if (c === ' ') u += 0.5;
        else if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(c)) u += 1.8;
        else u += 1;
    });
    return u;
};
const alignItem = { category: '複方', name: '對齊測試', prices: { '富田': 600, '仙豐': 1150, '勝昌': 540 } };
const alignLine = api.rowsToText([{ item: alignItem }]).split('\n')[1];
const alignPrices = alignLine.split('\u3000').filter(function(p) { return /^\s*\d/.test(p); });
check('複製：3 位數與 4 位數價格右邊界對齊',
    alignPrices.length === 2 && visWidth(alignPrices[0]) === visWidth(alignPrices[1]),
    alignPrices.map(visWidth).join('/') + ' ｜ ' + JSON.stringify(alignPrices));

api.setState('5+1', 10);
check('複製：5+1 模式套用買贈換算（1000 → 833）',
    api.rowsToText([{ item: fakeItem }]).indexOf('833') !== -1,
    api.rowsToText([{ item: fakeItem }]));

api.setState('origin', 6);
check('複製：6 折套用折扣（1000 → 600）',
    api.rowsToText([{ item: fakeItem }]).indexOf('600') !== -1,
    api.rowsToText([{ item: fakeItem }]));
api.setState('origin', 10);
check('複製：模式標籤正確', api.modeLabel() === '不搭贈', api.modeLabel());

const twoItems = api.searchRows('炙甘草');
const twoText = api.rowsToText(twoItems.concat(twoItems));
check('複製：多筆品項之間空一行', twoText.split('\n\n').length === twoItems.length * 2,
    'blocks=' + twoText.split('\n\n').length + ' rows=' + twoItems.length);

const realRows = api.searchRows('桂枝湯');
const realText = api.rowsToText(realRows);
check('複製：實際查詢結果可整批輸出',
    realRows.length === 1 && realText.split('\n')[0] === '桂枝湯 200g（複方）',
    realText.split('\n')[0]);

// ---------- 13. 每家廠商各自選 5+1／10+1／不搭贈 ----------
api.setState('origin', 10);
const giftItem = { category: '複方', name: 'G測試', prices: { '富田': 1200, '仙豐': 1200, '勝昌': 1200 } };
check('搭贈：預設全部不搭贈',
    api.calcPrice(1200, '富田') === 1200 && api.calcPrice(1200, '仙豐') === 1200);
check('搭贈：下拉選項為「不搭贈／5+1／10+1」',
    els.giftGrid.innerHTML.indexOf('>不搭贈</option>') !== -1 &&
    els.giftGrid.innerHTML.indexOf('>原價</option>') === -1,
    els.giftGrid.innerHTML.slice(0, 160));

api.setFactoryMode('富田', '5+1');
check('搭贈：單獨設定富田 5+1（1200 → 1,000）', api.calcPrice(1200, '富田') === 1000,
    '' + api.calcPrice(1200, '富田'));
check('搭贈：其他廠商不受影響（仙豐 1200 → 1200）', api.calcPrice(1200, '仙豐') === 1200,
    '' + api.calcPrice(1200, '仙豐'));

api.setFactoryMode('仙豐', '10+1');
check('搭贈：富田 5+1 與仙豐 10+1 可同時並存',
    api.calcPrice(1200, '富田') === 1000 && api.calcPrice(1200, '仙豐') === 1091,
    api.calcPrice(1200, '富田') + '/' + api.calcPrice(1200, '仙豐'));
check('搭贈：每家各自記錄自己的模式',
    api.getModes()['富田'] === '5+1' && api.getModes()['仙豐'] === '10+1' && api.getModes()['勝昌'] === 'origin',
    JSON.stringify(api.getModes()));

api.setFactoryMode('勝昌', '5+1');
const mixedText = api.rowsToText([{ item: giftItem }]);
check('搭贈：複製結果列出有價廠牌', mixedText.indexOf('富田') !== -1 && mixedText.indexOf('仙豐') !== -1, mixedText);
check('搭贈：複製結果標明各家套用的搭贈',
    mixedText.indexOf('（搭贈：富田 5+1、仙豐 10+1、勝昌 5+1）') !== -1, mixedText);

api.setFactoryMode('富田', 'origin');
check('搭贈：可改回不搭贈（富田 1200 → 1200）', api.calcPrice(1200, '富田') === 1200,
    '' + api.calcPrice(1200, '富田'));
api.setFactoryMode('不存在', '5+1');
check('搭贈：未知廠商不會寫入狀態', api.getModes()['不存在'] === undefined);

api.setState('origin', 10);
api.clearSelected();
api.addSelectedByName('桂枝湯 200g', '複方');
api.runQuery();
const beforeGift = api.getQueryRows().length;
api.setFactoryMode('富田', '5+1');
const tagCount = (els.resultList.innerHTML.match(/<i class="tag">5\+1<\/i>/g) || []).length;
check('搭贈：改設定後用同一份查詢結果重算、不重新搜尋',
    api.getQueryRows().length === beforeGift && tagCount === beforeGift,
    'rows=' + api.getQueryRows().length + ' tags=' + tagCount);

api.setState('origin', 10);

// ---------- 13.5 清除按鈕 ----------
api.setFactoryMode('富田', '5+1');
// 個別廠商折數：只影響那一家
api.setFactoryDiscount('仙豐', 7);
api.clearSelected();
api.addSelectedByName('桂枝湯 200g', '複方');
api.addSelectedByName('炙甘草湯 200g', '複方');
api.runQuery();
const beforeClear = (els.resultList.innerHTML.match(/class="item-card"/g) || []).length;
check('清除：查詢後有 2 張卡片', beforeClear === 2, 'cards=' + beforeClear);
check('個別折數：仙豐 7 折、科達仍是原本的 10 折',
    api.calcPrice(1000, '仙豐') === 700 && api.calcPrice(1000, '科達') === 1000,
    '仙豐=' + api.calcPrice(1000, '仙豐') + ' 科達=' + api.calcPrice(1000, '科達'));
check('個別折數：該廠搭贈仍疊在同廠折數後（富田 10 折 5+1 → 833）',
    api.calcPrice(1000, '富田') === 833, '' + api.calcPrice(1000, '富田'));

api.clearAll();
const afterCards = (els.resultList.innerHTML.match(/class="item-card"/g) || []).length;
check('清除：卡片清空、回到未查詢提示',
    afterCards === 0 && els.resultList.innerHTML.indexOf('輸入完整品名，或點選上面的候選品項') !== -1,
    'cards=' + afterCards);
check('清除：輸入框被清空', els.searchInput.value === '', els.searchInput.value);
check('清除：查詢清單與結果都清空',
    api.getSelected().length === 0 && api.getQueryRows() === null,
    'selected=' + api.getSelected().length);
check('清除：上方標籤列隱藏', els.selectedChips.style.display === 'none', String(els.selectedChips.style.display));
check('清除：提示說明搭贈與折數一起被清掉',
    els.matchHint.textContent.indexOf('各廠搭贈與折數') !== -1 && els.matchHint.textContent.indexOf('全部不搭贈') !== -1,
    els.matchHint.textContent);
check('清除：5+1／10+1 全部回到不搭贈',
    FACTORIES_ALL_ORIGIN(), JSON.stringify(api.getModes()));
check('清除：各廠折數回到預設 6 折',
    api.getDiscount() === 6 && api.getFactoryDiscounts()['仙豐'] === 6 && api.getFactoryDiscounts()['富田'] === 6,
    'default=' + api.getDiscount() + ' 仙豐=' + api.getFactoryDiscounts()['仙豐']);
check('清除：清掉後 1000 元回到 6 折 600', api.calcPrice(1000, '富田') === 600, '' + api.calcPrice(1000, '富田'));

function FACTORIES_ALL_ORIGIN() {
    return api.FACTORIES.every(function(f) { return api.getModes()[f] === 'origin'; });
}

api.setState('origin', 10);

// ---------- 14. 多分頁（複方／單方／錠劑／丸劑）----------
const PILL_CSV = [
    '"品名規格 【複方錠劑】","規格 ","富田 2026.11.01價格 500錠","仙豐 2026/07/01價格","科達115年11月 原價","科達115年11月 新價(2026.11.01)","勝昌最新價格 (2026.09版PDF) 300錠","備註"',
    '加味逍遙散濃縮錠,500錠,720,,520,540,510,富田為0.34gm×500錠',
    '杞菊地黃丸濃縮錠,500錠,630,440,460,470,440,'
].join('\n');
const pill = api.buildData(PILL_CSV, '錠劑');
check('錠劑：品名＋規格組成完整名稱',
    pill.data[0].name === '加味逍遙散濃縮錠 500錠', pill.data[0].name);
check('錠劑：分類由分頁名稱指定', pill.data[0].category === '錠劑', pill.data[0].category);
check('錠劑：富田取到價格 720', pill.data[0].prices['富田'] === 720, '' + pill.data[0].prices['富田']);
check('錠劑：科達同月份有原價與新價時取新價', pill.data[0].prices['科達'] === 540, '' + pill.data[0].prices['科達']);
check('錠劑：備註欄不會被當成價格欄', pill.data[0].prices['天明'] === null && pill.missing.indexOf('仙豐') === -1,
    'missing=' + pill.missing.join('、'));

const PILL2_CSV = [
    '分類,品番,品名,規格(丸/包裝),勝昌價格,備註',
    '成方丸丹劑(600mg/丸),05140E,左歸丸,"1,000丸","2,200",',
    '中成藥丸丹劑(600mg/丸),04070H,六味地黃丸,250丸,799,'
].join('\n');
const wan = api.buildData(PILL2_CSV, '丸劑');
check('丸劑：品名＋規格組成完整名稱', wan.data[0].name === '左歸丸 1,000丸', wan.data[0].name);
check('丸劑：分類改為丸劑（蓋掉表內細分類）', wan.data[0].category === '丸劑', wan.data[0].category);
check('丸劑：只對應到勝昌價格', wan.data[0].prices['勝昌'] === 2200 && wan.data[0].prices['富田'] === null,
    '' + wan.data[0].prices['勝昌']);
check('丸劑：缺欄警告包含未提供價格的廠牌', wan.missing.length === 10, 'n=' + wan.missing.length);

const merged = api.mergeSheets([
    { label: '錠劑', text: PILL_CSV },
    { label: '丸劑', text: PILL2_CSV }
]);
check('合併：兩張分頁的品項都在', merged.items.length === 4, 'n=' + merged.items.length);
check('合併：分類標籤各自正確',
    merged.items.filter(function(x) { return x.category === '錠劑'; }).length === 2 &&
    merged.items.filter(function(x) { return x.category === '丸劑'; }).length === 2);
check('合併：有分類欄', merged.hasCategory === true);

api.commitData(merged.items, merged.updated, merged.missing, '測試合併', false, true);
check('合併後可查到丸劑品項（左歸丸）',
    api.searchRows('左歸丸').length === 1 && api.searchRows('左歸丸')[0].item.category === '丸劑');
check('合併後可查到錠劑品項（加味逍遙散）', api.searchRows('加味逍遙散').length >= 1);
check('合併後分類篩選可運作',
    api.searchRows('六味地黃丸').every(function(r) { return r.item.category === '丸劑'; }));

// ---------- 15. 使用者情境（空白分隔／分類提示／規格提醒）----------
api.applyCsv(api.SAMPLE_CSV_TEXT, '內建示範資料', true);
check('空白分隔：兩個完整藥名各自命中',
    api.searchRows('桂枝湯').length === 1 && api.searchRows('炙甘草湯')[0].score >= 9000);
check('空白分隔：含規格的品項不會被拆成兩筆',
    api.searchRows('桂枝湯 200g').length === 1 &&
    api.searchRows('桂枝湯 200g')[0].item.name === '桂枝湯 200g',
    api.searchRows('桂枝湯 200g').length + ' 筆');

// 用沒有規格的品名測試「空白分隔多筆」（示範資料的品名都帶規格，無法用空白拆）
const NO_SPEC_CSV = [
    '"品名規格","富田 2026/01/01價格","勝昌 2026/01/01價格"',
    '乙字湯,500,480',
    '桂枝湯,520,500'
].join('\n');
api.applyCsv(NO_SPEC_CSV, '空白分隔測試');

api.setState('origin', 10);
api.clearSelected();
els.searchInput.value = '乙字湯 桂枝湯';
api.runQuery();
check('空白分隔：貼「乙字湯 桂枝湯」會列出 2 筆',
    api.getQueryRows().length === 2 && api.getSelected().length === 2,
    'rows=' + api.getQueryRows().length);

api.clearSelected();
els.searchInput.value = '桂枝湯';
api.runQuery();
check('空白分隔：單一品名仍只有 1 筆', api.getQueryRows().length === 1 && api.getSelected().length === 1,
    'rows=' + api.getQueryRows().length);

// 回到示範資料繼續後面的測試
api.applyCsv(api.SAMPLE_CSV_TEXT, '內建示範資料', true);
api.clearSelected();
els.searchInput.value = '桂枝湯 200g';
api.runQuery();
check('含規格：貼「桂枝湯 200g」不會被空白拆開',
    api.getQueryRows().length === 1 &&
    api.getSelected()[0].name === '桂枝湯 200g',
    api.getSelected().map(function(x) { return x.name; }).join('/'));

// 分類切換後的提示要跟著更新
api.clearSelected();
els.searchInput.value = '桂枝湯 200g\n大黃 100g';
api.runQuery();
els.categorySelect.value = '單方';
api.renderTable();
check('分類提示：切到單方時提示寫出篩選筆數',
    els.matchHint.textContent.indexOf('分類「單方」：1 / 2 筆') !== -1,
    els.matchHint.textContent);
els.categorySelect.value = '錠劑';
api.renderTable();
check('分類提示：該分類沒有品項時講清楚「沒有已選的品項」',
    els.matchHint.textContent.indexOf('沒有已選的品項') !== -1,
    els.matchHint.textContent);
check('分類提示：切回全部分類會還原原本提示',
    (function() {
        els.categorySelect.value = 'all';
        api.renderTable();
        return els.matchHint.textContent.indexOf('已列出 2 筆品項') !== -1;
    })(), els.matchHint.textContent);

// 各廠規格不同時的提醒（錠劑 500 錠 vs 300 錠）
const specText = api.specNoteText(pill.data[0]);
check('規格提醒：錠劑 500 錠與 300 錠不同會提醒',
    specText.indexOf('500錠') !== -1 && specText.indexOf('300錠') !== -1, specText);
check('規格提醒：規格一致（丸劑只有勝昌）不顯示',
    api.specNoteText(wan.data[0]) === '', api.specNoteText(wan.data[0]));

// 還原成示範資料
api.applyCsv(api.SAMPLE_CSV_TEXT, '內建示範資料', true);

console.log('\n===== ' + pass + ' passed, ' + fail + ' failed =====');
process.exit(fail === 0 ? 0 : 1);
