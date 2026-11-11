// verify.js — 驗證 index.html 內建邏輯（CSV 解析、欄位對應、折扣/買贈計算、表格渲染）
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
['searchInput', 'categorySelect', 'discountInput', 'tableBody', 'statusNote', 'pickCsvBtn', 'csvFileInput']
    .forEach(function (id) { els[id] = makeEl(id); });
els.searchInput.value = '';
els.categorySelect.value = 'all';
els.discountInput.value = '10';

const documentStub = {
    getElementById: function (id) { return els[id] || makeEl(id); },
    querySelectorAll: function () { return []; }
};

const fetchStub = function () { return Promise.reject(new Error('offline (test)')); };

const api = new Function(
    'document', 'fetch', 'AbortController', 'setTimeout', 'clearTimeout', 'FileReader',
    code + '\nreturn { parseCSV, buildData, parsePrice, calcPrice, renderTable, applyCsv, FACTORIES, setState: function(m, d){ currentMode = m; discount = d; } };'
)(documentStub, fetchStub, AbortController, setTimeout, clearTimeout, function () {});

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { pass++; console.log('PASS  ' + name); }
    else { fail++; console.log('FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

// ---- 1. CSV 解析（含引號內逗號）----
const sample = fs.readFileSync(path.join(__dirname, 'sample-data.csv'), 'utf8');
const rows = api.parseCSV(sample);
check('CSV 列數 = 6（表頭+5筆）', rows.length === 6, 'got ' + rows.length);
check('欄數 = 13', rows[0].length === 13 && rows[1].length === 13, 'head=' + rows[0].length + ' row1=' + rows[1].length);
check('引號內逗號未被拆欄', rows[2][5] === '停售,待通知', 'got [' + rows[2][5] + ']');

// ---- 2. 欄位對應 ----
const built = api.buildData(sample);
check('資料筆數 = 5', built.data.length === 5, 'got ' + built.data.length);
check('無缺欄警告', built.missing.length === 0, built.missing.join(','));

const guizhi = built.data.find(function (x) { return x.name.indexOf('桂枝湯') !== -1; });
check('桂枝湯 富田=1200', guizhi.prices['富田'] === 1200);
check('桂枝湯 莊松榮=空白(null)', guizhi.prices['莊松榮'] === null);
check('桂枝湯 萬國=1250', guizhi.prices['萬國'] === 1250);
check('桂枝湯 分類=複方', guizhi.category === '複方', guizhi.category);

const dahuang = built.data.find(function (x) { return x.name.indexOf('大黃') !== -1; });
check('非數字保留文字(停售,待通知)', dahuang.prices['科達'] === '停售,待通知', String(dahuang.prices['科達']));
check('時價保留文字', dahuang.prices['天明'] === '時價', String(dahuang.prices['天明']));

// ---- 3. 表頭上方有標題列也能抓到 ----
const withTitle = '科學中藥牌價表,,,\n' + sample;
const built2 = api.buildData(withTitle);
check('有標題列時仍解析成功', built2.data.length === 5 && built2.missing.length === 0, 'rows=' + built2.data.length + ' missing=' + built2.missing.join(','));

// ---- 4. 計算邏輯 ----
api.setState('origin', 10);
check('原價 1000 → 1000', api.calcPrice(1000) === 1000, '' + api.calcPrice(1000));
api.setState('5+1', 10);
check('1000 5+1 → 833', api.calcPrice(1000) === 833, '' + api.calcPrice(1000));
api.setState('10+1', 10);
check('1000 10+1 → 909', api.calcPrice(1000) === 909, '' + api.calcPrice(1000));
api.setState('5+1', 6);
check('1000 打6折 + 5+1 → 500', api.calcPrice(1000) === 500, '' + api.calcPrice(1000));
api.setState('origin', 6.5);
check('1000 打6.5折 → 650', api.calcPrice(1000) === 650, '' + api.calcPrice(1000));
api.setState('5+1', 10);
check('文字值不參與運算', api.calcPrice('時價') === '時價');
check('null 不參與運算', api.calcPrice(null) === null);

// ---- 5. 渲染 + 搜尋 ----
api.applyCsv(sample, 'test', false);
api.setState('origin', 10);
els.searchInput.value = '桂枝';
api.renderTable();
check('搜尋關鍵字只留 1 列', (els.tableBody.innerHTML.match(/<tr>/g) || []).length === 1,
    'rows=' + (els.tableBody.innerHTML.match(/<tr>/g) || []).length);
check('表格含 1,200 / 1,350 千分位', els.tableBody.innerHTML.indexOf('1,200') !== -1 && els.tableBody.innerHTML.indexOf('1,350') !== -1);
// 桂枝湯：莊松榮、港香蘭、天一、國科 共 4 欄空白
check('空白顯示為 -', (els.tableBody.innerHTML.match(/no-price/g) || []).length === 4,
    'count=' + (els.tableBody.innerHTML.match(/no-price/g) || []).length);

els.searchInput.value = '';
els.categorySelect.value = '錠劑';
api.renderTable();
check('分類篩選(錠劑) = 1 列', (els.tableBody.innerHTML.match(/<tr>/g) || []).length === 1);

els.categorySelect.value = 'all';
els.searchInput.value = '不存在的藥';
api.renderTable();
check('查無資料提示', els.tableBody.innerHTML.indexOf('無符合條件的藥品') !== -1);

// ---- 6. 折扣後套用 5+1 的整體渲染 ----
els.searchInput.value = '桂枝';
api.setState('5+1', 10);
api.renderTable();
const first = els.tableBody.innerHTML.match(/class="price-num">([^<]+)</);
check('5+1 模式 1200 → 1,000', first && first[1] === '1,000', first ? first[1] : 'none');

console.log('\n===== ' + pass + ' passed, ' + fail + ' failed =====');
process.exit(fail === 0 ? 0 : 1);
