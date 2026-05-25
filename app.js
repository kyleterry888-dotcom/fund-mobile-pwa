(() => {
  'use strict';

  const STORAGE_KEY = 'fund-lite-state-v1';
  const SAMPLE_CODES = ['024500', '001958', '012062', '023881', '011730'];
  const DEFAULT_STATE = {
    funds: [],
    settings: {
      refreshSeconds: 0,
      valuationMode: 'auto',
    },
    updatedAt: null,
  };

  const $ = (id) => document.getElementById(id);
  const fmt = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
  const fmt4 = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const money = (v) => Number.isFinite(Number(v)) ? `¥${fmt.format(Number(v))}` : '--';
  const pct = (v) => Number.isFinite(Number(v)) ? `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(2)}%` : '--';
  const nav = (v) => Number.isFinite(Number(v)) ? fmt4.format(Number(v)) : '--';
  const clsByNum = (v) => !Number.isFinite(Number(v)) ? 'flat-text' : Number(v) > 0 ? 'up-text' : Number(v) < 0 ? 'down-text' : 'flat-text';
  const todayStr = () => new Date().toLocaleString('zh-CN', { hour12: false });
  const cleanCode = (v) => String(v || '').trim().replace(/[^0-9A-Za-z.]/g, '').toUpperCase();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  let state = loadState();
  let refreshing = false;
  let refreshTimer = null;
  let manualDialogCode = null;
  let deferredInstallPrompt = null;

  function cloneDefaultState() {
    return typeof structuredClone === 'function'
      ? structuredClone(DEFAULT_STATE)
      : JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return cloneDefaultState();
      const parsed = JSON.parse(raw);
      return {
        ...cloneDefaultState(),
        ...parsed,
        settings: { ...DEFAULT_STATE.settings, ...(parsed.settings || {}) },
        funds: Array.isArray(parsed.funds) ? parsed.funds : [],
      };
    } catch {
      return structuredClone(DEFAULT_STATE);
    }
  }

  function saveState() {
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function toast(message) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  function setStatus(message) {
    $('statusText').textContent = message;
  }

  function scriptJsonp(url, { callbackName, callbackParam = 'callback', timeoutMs = 10000, fixedCallback = false } = {}) {
    return new Promise((resolve, reject) => {
      const cb = callbackName || `jsonp_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const script = document.createElement('script');
      let done = false;
      let oldCallback = window[cb];
      const cleanup = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (document.body.contains(script)) document.body.removeChild(script);
        if (fixedCallback) {
          window[cb] = oldCallback;
        } else {
          try { delete window[cb]; } catch { window[cb] = undefined; }
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('请求超时'));
      }, timeoutMs);
      window[cb] = (data) => {
        cleanup();
        resolve(data);
      };
      const finalUrl = fixedCallback ? url : appendParam(url, callbackParam, cb);
      script.src = appendParam(finalUrl, '_', Date.now());
      script.async = true;
      script.onerror = () => {
        cleanup();
        reject(new Error('脚本加载失败'));
      };
      document.body.appendChild(script);
    });
  }

  function appendParam(url, key, value) {
    const join = url.includes('?') ? '&' : '?';
    return `${url}${join}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }

  // 东方财富 F10 接口使用固定全局变量 apidata；这里强制串行刷新，避免互相覆盖。
  function loadEastmoneyApidata(url, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      let done = false;
      const old = window.apidata;
      try { delete window.apidata; } catch { window.apidata = undefined; }
      const cleanup = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (document.body.contains(script)) document.body.removeChild(script);
        window.apidata = old;
      };
      const timer = setTimeout(() => {
        const data = window.apidata;
        cleanup();
        if (data) resolve(data);
        else reject(new Error('F10 请求超时'));
      }, timeoutMs);
      script.onload = () => {
        const data = window.apidata;
        cleanup();
        data ? resolve(data) : reject(new Error('F10 无数据'));
      };
      script.onerror = () => {
        cleanup();
        reject(new Error('F10 脚本加载失败'));
      };
      script.src = appendParam(url, '_', Date.now());
      script.async = true;
      document.body.appendChild(script);
    });
  }

  async function fetchFundSearch(code) {
    const url = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(code)}`;
    const data = await scriptJsonp(url, { callbackParam: 'callback', timeoutMs: 8000 });
    const list = Array.isArray(data?.Datas) ? data.Datas : [];
    const found = list.find((x) => String(x.CODE) === String(code));
    return found ? (found.NAME || found.SHORTNAME || `基金(${code})`) : `基金(${code})`;
  }

  async function fetchFundValuation(code) {
    const url = `https://fundgz.1234567.com.cn/js/${encodeURIComponent(code)}.js`;
    try {
      const data = await scriptJsonp(url, { callbackName: 'jsonpgz', fixedCallback: true, timeoutMs: 9000 });
      if (!data || typeof data !== 'object') throw new Error('平台估值为空');
      const gsz = Number(data.gsz);
      const gszzl = Number(data.gszzl);
      return {
        platformNav: Number.isFinite(gsz) ? gsz : null,
        platformPct: Number.isFinite(gszzl) ? gszzl : null,
        gztime: data.gztime || null,
        raw: data,
      };
    } catch (error) {
      return { platformNav: null, platformPct: null, gztime: null, error: error.message };
    }
  }

  function parseNetValuesFromHtml(html) {
    if (!html || html.includes('暂无数据')) return [];
    const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    const out = [];
    for (const row of rows) {
      const cells = row.match(/<td[\s\S]*?>[\s\S]*?<\/td>/gi) || [];
      if (!cells.length) continue;
      const text = (td) => td.replace(/<[^>]*>/g, '').trim();
      const date = text(cells[0] || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const unitNav = Number(text(cells[1] || ''));
      let growth = null;
      for (const cell of cells) {
        const m = text(cell).match(/([-+]?\d+(?:\.\d+)?)\s*%/);
        if (m) { growth = Number(m[1]); break; }
      }
      if (Number.isFinite(unitNav)) out.push({ date, unitNav, growth });
    }
    return out.reverse();
  }

  async function fetchFundNetValues(code) {
    const url = `https://fundf10.eastmoney.com/F10DataApi.aspx?type=lsjz&code=${encodeURIComponent(code)}&page=1&per=5&sdate=&edate=`;
    try {
      const data = await loadEastmoneyApidata(url);
      return parseNetValuesFromHtml(data?.content || '');
    } catch (error) {
      return [];
    }
  }

  function extractReportDate(html) {
    if (!html) return null;
    const keyword = html.match(/(报告期|截止日期|持仓截止日)[^0-9]{0,30}(\d{4}-\d{2}-\d{2})/);
    if (keyword) return keyword[2];
    const anyDate = html.match(/(\d{4}-\d{2}-\d{2})/);
    return anyDate ? anyDate[1] : null;
  }

  function parseWeight(text) {
    const m = String(text || '').match(/([-+]?\d+(?:\.\d+)?)\s*%?/);
    const n = m ? Number(m[1]) : null;
    return Number.isFinite(n) ? n : null;
  }

  function parseHoldingsFromHtml(html) {
    const reportDate = extractReportDate(html);
    const headerRow = (html.match(/<thead[\s\S]*?<tr[\s\S]*?<\/tr>[\s\S]*?<\/thead>/i) || [])[0] || '';
    const headers = (headerRow.match(/<th[\s\S]*?>[\s\S]*?<\/th>/gi) || []).map((th) => th.replace(/<[^>]*>/g, '').replace(/\s+/g, '').trim());
    let idxCode = -1;
    let idxName = -1;
    let idxWeight = -1;
    headers.forEach((h, i) => {
      if (idxCode < 0 && /股票代码|证券代码|代码/.test(h)) idxCode = i;
      if (idxName < 0 && /股票名称|证券名称|名称/.test(h)) idxName = i;
      if (idxWeight < 0 && /占净值比例|占基金净值|持仓占比|比例|占比/.test(h)) idxWeight = i;
    });
    const tbody = (html.match(/<tbody[\s\S]*?<\/tbody>/i) || [])[0] || html;
    const rows = tbody.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    const holdings = [];
    for (const row of rows) {
      const tds = (row.match(/<td[\s\S]*?>[\s\S]*?<\/td>/gi) || []).map((td) => td.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim());
      if (!tds.length) continue;
      let code = idxCode >= 0 ? tds[idxCode] : '';
      let name = idxName >= 0 ? tds[idxName] : '';
      let weightText = idxWeight >= 0 ? tds[idxWeight] : '';
      if (!code) {
        const maybe = tds.find((x) => /(^\d{6}$)|(^\d{5}$)|(^[A-Za-z]{1,10}(\.[A-Za-z]{1,6})?$)/.test(x));
        code = maybe || '';
      }
      if (!name) {
        name = tds.find((x) => x && x !== code && !/%/.test(x) && !/^\d+$/.test(x)) || '';
      }
      if (!weightText) {
        weightText = tds.find((x) => /\d+(?:\.\d+)?\s*%/.test(x)) || '';
      }
      const codeMatch = String(code).match(/(\d{6}|\d{5}|[A-Za-z]{1,10}(?:\.[A-Za-z]{1,6})?)/);
      const clean = codeMatch ? codeMatch[1].toUpperCase() : cleanCode(code);
      const weight = parseWeight(weightText);
      if ((clean || name) && Number.isFinite(weight)) {
        holdings.push({ code: clean, name: name || clean, weight, change: null, quoteName: null });
      }
    }
    return { reportDate, holdings: holdings.slice(0, 10) };
  }

  async function fetchFundHoldings(code) {
    const url = `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${encodeURIComponent(code)}&topline=10&year=&month=`;
    try {
      const data = await loadEastmoneyApidata(url);
      return parseHoldingsFromHtml(data?.content || '');
    } catch (error) {
      return { reportDate: null, holdings: [], error: error.message };
    }
  }

  function normalizeTencentCode(rawCode) {
    const raw = String(rawCode || '').trim().toUpperCase();
    if (!raw) return null;
    const prefixed = raw.match(/^(US|HK|SH|SZ|BJ)(.+)$/i);
    if (prefixed) {
      const p = prefixed[1].toLowerCase();
      const rest = prefixed[2];
      return ['sh', 'sz', 'bj', 'hk'].includes(p) ? `s_${p}${rest}` : `${p}${rest}`;
    }
    if (/^\d{6}$/.test(raw)) {
      const p = raw.startsWith('6') || raw.startsWith('9') ? 'sh' : raw.startsWith('4') || raw.startsWith('8') ? 'bj' : 'sz';
      return `s_${p}${raw}`;
    }
    if (/^\d{5}$/.test(raw)) return `s_hk${raw}`;
    const hk = raw.match(/^(\d{4,5})\.HK$/i);
    if (hk) return `s_hk${hk[1].padStart(5, '0')}`;
    const us = raw.match(/^([A-Z]{1,10})(?:\.[A-Z]{1,6})?$/i);
    if (us) return `us${us[1].toUpperCase()}`;
    return null;
  }

  function getTencentVarName(tencentCode) {
    return `v_${tencentCode}`;
  }

  async function fetchTencentQuotes(holdings) {
    const items = holdings.map((h) => ({ h, tencentCode: normalizeTencentCode(h.code) })).filter((x) => x.tencentCode);
    if (!items.length) return holdings;
    const query = items.map((x) => x.tencentCode).join(',');
    await new Promise((resolve) => {
      const script = document.createElement('script');
      let done = false;
      const cleanup = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (document.body.contains(script)) document.body.removeChild(script);
      };
      const timer = setTimeout(() => { cleanup(); resolve(); }, 9000);
      script.onload = () => {
        for (const item of items) {
          const str = window[getTencentVarName(item.tencentCode)];
          if (!str || typeof str !== 'string') continue;
          const parts = str.split('~');
          const isUS = /^us/i.test(item.tencentCode);
          const percentIndex = isUS ? 32 : 5;
          const nameIndex = isUS ? 1 : 1;
          const change = Number(parts[percentIndex]);
          if (Number.isFinite(change)) item.h.change = change;
          if (parts[nameIndex]) item.h.quoteName = parts[nameIndex];
        }
        cleanup();
        resolve();
      };
      script.onerror = () => { cleanup(); resolve(); };
      script.src = `https://qt.gtimg.cn/q=${query}`;
      script.async = true;
      document.body.appendChild(script);
    });
    return holdings;
  }

  function normalizeManualHoldings(value) {
    if (!Array.isArray(value)) return [];
    return value.map((x) => {
      const code = cleanCode(x.code || x.symbol || x.ticker || '');
      const name = String(x.name || x.shortName || code || '').trim();
      const weight = Number(x.weight ?? x.ratio ?? x.percent);
      return { code, name, weight, change: null, quoteName: null, manual: true };
    }).filter((x) => x.code && Number.isFinite(x.weight) && x.weight > 0).slice(0, 30);
  }

  function getActiveHoldings(fund) {
    if (Array.isArray(fund.manualHoldings) && fund.manualHoldings.length) return fund.manualHoldings;
    return Array.isArray(fund.holdings) ? fund.holdings : [];
  }

  function computeHoldingModel(holdings) {
    let coverage = 0;
    let contributionPct = 0;
    let validCount = 0;
    for (const h of holdings || []) {
      const w = Number(h.weight);
      const c = Number(h.change);
      if (Number.isFinite(w) && w > 0) coverage += w;
      if (Number.isFinite(w) && Number.isFinite(c)) {
        contributionPct += (w / 100) * c;
        validCount += 1;
      }
    }
    const proxyPct = coverage > 0 ? contributionPct / (coverage / 100) : null;
    return {
      coverage,
      validCount,
      contributionPct: Number.isFinite(contributionPct) ? contributionPct : null,
      proxyPct: Number.isFinite(proxyPct) ? proxyPct : null,
    };
  }

  function pickEstimate(fund) {
    const mode = state.settings.valuationMode || 'auto';
    const unitNav = Number(fund.unitNav);
    const platformNav = Number(fund.platformNav);
    const model = computeHoldingModel(getActiveHoldings(fund));
    const navFromPct = (p) => Number.isFinite(unitNav) && Number.isFinite(p) ? unitNav * (1 + p / 100) : null;
    const candidates = {
      platform: Number.isFinite(platformNav) ? { nav: platformNav, pct: fund.platformPct, source: '平台估值' } : null,
      top10_contribution: Number.isFinite(model.contributionPct) ? { nav: navFromPct(model.contributionPct), pct: model.contributionPct, source: 'Top10贡献' } : null,
      top10_proxy: Number.isFinite(model.proxyPct) ? { nav: navFromPct(model.proxyPct), pct: model.proxyPct, source: 'Top10归一化' } : null,
    };
    if (mode !== 'auto') return candidates[mode] || { nav: null, pct: null, source: '无可用估值' };
    return candidates.platform || candidates.top10_proxy || candidates.top10_contribution || { nav: null, pct: null, source: '无可用估值' };
  }

  function computePosition(fund) {
    const units = Number(fund.units);
    const costAmount = Number(fund.costAmount);
    const latestNav = Number(fund.unitNav);
    const estimate = pickEstimate(fund);
    const estimateNav = Number(estimate.nav);
    const marketValue = Number.isFinite(units) && Number.isFinite(estimateNav) ? units * estimateNav : null;
    const latestValue = Number.isFinite(units) && Number.isFinite(latestNav) ? units * latestNav : null;
    const totalProfit = Number.isFinite(marketValue) && Number.isFinite(costAmount) ? marketValue - costAmount : null;
    const totalProfitPct = Number.isFinite(totalProfit) && Number.isFinite(costAmount) && costAmount !== 0 ? totalProfit / costAmount * 100 : null;
    const todayProfit = Number.isFinite(marketValue) && Number.isFinite(latestValue) ? marketValue - latestValue : null;
    return { units, costAmount, latestNav, estimate, marketValue, latestValue, totalProfit, totalProfitPct, todayProfit };
  }

  async function refreshFund(fund, { includeHoldings = true } = {}) {
    const code = fund.code;
    const [valuation, netValues] = await Promise.all([
      fetchFundValuation(code),
      fetchFundNetValues(code),
    ]);
    const latest = netValues[netValues.length - 1] || null;
    const name = fund.name && !/^基金\(/.test(fund.name) ? fund.name : await fetchFundSearch(code).catch(() => fund.name || `基金(${code})`);
    let holdingsData = { holdings: fund.holdings || [], reportDate: fund.holdingsReportDate || null };
    if (includeHoldings) {
      holdingsData = await fetchFundHoldings(code);
      if (holdingsData.holdings?.length) {
        await fetchTencentQuotes(holdingsData.holdings);
      }
    } else if (Array.isArray(holdingsData.holdings) && holdingsData.holdings.length) {
      await fetchTencentQuotes(holdingsData.holdings);
    }
    if (Array.isArray(fund.manualHoldings) && fund.manualHoldings.length) {
      fund.manualHoldings = await fetchTencentQuotes(fund.manualHoldings);
    }
    return {
      ...fund,
      name,
      unitNav: latest?.unitNav ?? fund.unitNav ?? null,
      unitNavDate: latest?.date ?? fund.unitNavDate ?? null,
      dailyGrowth: latest?.growth ?? fund.dailyGrowth ?? null,
      platformNav: valuation.platformNav,
      platformPct: valuation.platformPct,
      gztime: valuation.gztime,
      valuationError: valuation.error || null,
      holdings: holdingsData.holdings?.length ? holdingsData.holdings : (fund.holdings || []),
      holdingsReportDate: holdingsData.reportDate || fund.holdingsReportDate || null,
      lastRefreshAt: new Date().toISOString(),
      lastError: null,
    };
  }

  async function refreshAll({ includeHoldings = true } = {}) {
    if (refreshing) return;
    refreshing = true;
    $('refreshAllBtn').disabled = true;
    setStatus(`刷新中：0/${state.funds.length}`);
    render();
    const nextFunds = [];
    for (let i = 0; i < state.funds.length; i++) {
      const fund = state.funds[i];
      try {
        setStatus(`刷新中：${i + 1}/${state.funds.length}，${fund.code}`);
        const refreshed = await refreshFund(fund, { includeHoldings });
        nextFunds.push(refreshed);
      } catch (error) {
        nextFunds.push({ ...fund, lastError: error.message, lastRefreshAt: new Date().toISOString() });
      }
      state.funds = [...nextFunds, ...state.funds.slice(i + 1)];
      saveState();
      render();
      await sleep(180);
    }
    refreshing = false;
    $('refreshAllBtn').disabled = false;
    setStatus(`上次刷新：${todayStr()}`);
    saveState();
    render();
  }

  function addFund(code) {
    const normalized = cleanCode(code);
    if (!/^\d{6}$/.test(normalized)) {
      toast('请输入 6 位基金代码');
      return;
    }
    if (state.funds.some((x) => x.code === normalized)) {
      toast('这只基金已经添加过了');
      return;
    }
    state.funds.push({
      code: normalized,
      name: `基金(${normalized})`,
      units: '',
      costAmount: '',
      note: '',
      holdings: [],
      manualHoldings: [],
      addedAt: new Date().toISOString(),
    });
    saveState();
    render();
    toast(`已添加 ${normalized}`);
  }

  function removeFund(code) {
    if (!confirm(`确定删除 ${code} 吗？本地持仓数据也会删除。`)) return;
    state.funds = state.funds.filter((x) => x.code !== code);
    saveState();
    render();
  }

  function updateFundField(code, field, value) {
    const fund = state.funds.find((x) => x.code === code);
    if (!fund) return;
    fund[field] = value;
    saveState();
    renderSummaryOnly();
  }

  function openManualDialog(code) {
    manualDialogCode = code;
    const fund = state.funds.find((x) => x.code === code);
    if (!fund) return;
    $('manualDialogSub').textContent = `${fund.name || ''} (${code})：支持 A股6位、港股5位、美股Ticker。weight 填百分比数字。`;
    $('manualHoldingsInput').value = JSON.stringify(fund.manualHoldings || [], null, 2);
    $('manualDialog').showModal();
  }

  function saveManualDialog() {
    const fund = state.funds.find((x) => x.code === manualDialogCode);
    if (!fund) return;
    try {
      const parsed = JSON.parse($('manualHoldingsInput').value || '[]');
      fund.manualHoldings = normalizeManualHoldings(parsed);
      saveState();
      $('manualDialog').close();
      toast('手动重仓已保存，建议刷新一次行情');
      render();
    } catch (error) {
      toast(`JSON 格式不对：${error.message}`);
    }
  }

  function clearManualDialog() {
    const fund = state.funds.find((x) => x.code === manualDialogCode);
    if (!fund) return;
    fund.manualHoldings = [];
    saveState();
    $('manualDialog').close();
    toast('已清空手动重仓，恢复自动重仓');
    render();
  }

  function renderSummaryOnly() {
    renderSummary();
  }

  function renderSummary() {
    let totalMarket = 0;
    let totalCost = 0;
    let totalToday = 0;
    let hasMarket = false;
    let hasCost = false;
    let hasToday = false;
    for (const fund of state.funds) {
      const pos = computePosition(fund);
      if (Number.isFinite(pos.marketValue)) { totalMarket += pos.marketValue; hasMarket = true; }
      if (Number.isFinite(pos.costAmount)) { totalCost += pos.costAmount; hasCost = true; }
      if (Number.isFinite(pos.todayProfit)) { totalToday += pos.todayProfit; hasToday = true; }
    }
    const totalProfit = hasMarket && hasCost ? totalMarket - totalCost : null;
    const totalProfitPct = Number.isFinite(totalProfit) && totalCost ? totalProfit / totalCost * 100 : null;
    $('summaryGrid').innerHTML = [
      summaryCard('基金数量', String(state.funds.length), '本地自选基金'),
      summaryCard('估算持仓', hasMarket ? money(totalMarket) : '--', `估值口径：${labelMode(state.settings.valuationMode)}`),
      summaryCard('持有收益', Number.isFinite(totalProfit) ? money(totalProfit) : '--', Number.isFinite(totalProfitPct) ? pct(totalProfitPct) : '需要填写成本金额', clsByNum(totalProfit)),
      summaryCard('今日估算', hasToday ? money(totalToday) : '--', '估值净值 - 最新净值', clsByNum(totalToday)),
    ].join('');
  }

  function summaryCard(label, value, sub, valueClass = '') {
    return `<div class="summary-card card"><p>${escapeHtml(label)}</p><strong class="${valueClass}">${escapeHtml(value)}</strong><small>${escapeHtml(sub)}</small></div>`;
  }

  function labelMode(mode) {
    return ({ auto: '自动', platform: '平台估值', top10_contribution: 'Top10贡献', top10_proxy: 'Top10归一化' })[mode] || '自动';
  }

  function render() {
    $('refreshSecondsInput').value = String(state.settings.refreshSeconds ?? 0);
    $('valuationModeSelect').value = state.settings.valuationMode || 'auto';
    renderSummary();
    if (!state.funds.length) {
      $('fundList').className = 'fund-list empty-list';
      $('fundList').textContent = '暂无基金。可以先点“一键加入示例基金”。';
      return;
    }
    $('fundList').className = 'fund-list';
    $('fundList').innerHTML = state.funds.map(renderFundCard).join('');
  }

  function renderFundCard(fund) {
    const activeHoldings = getActiveHoldings(fund);
    const model = computeHoldingModel(activeHoldings);
    const pos = computePosition(fund);
    const estimate = pos.estimate;
    const manual = Array.isArray(fund.manualHoldings) && fund.manualHoldings.length > 0;
    const coverageText = model.coverage ? `${model.coverage.toFixed(2)}%` : '--';
    const report = fund.holdingsReportDate || '--';
    const error = fund.lastError || fund.valuationError;
    return `
      <article class="fund-card" data-code="${escapeHtml(fund.code)}">
        <div class="fund-top">
          <div class="fund-title">
            <h3>${escapeHtml(fund.name || `基金(${fund.code})`)}</h3>
            <p>${escapeHtml(fund.code)} · 净值日 ${escapeHtml(fund.unitNavDate || '--')} · ${fund.lastRefreshAt ? `刷新 ${new Date(fund.lastRefreshAt).toLocaleTimeString('zh-CN', { hour12: false })}` : '未刷新'}</p>
            ${error ? `<p class="warn-text">${escapeHtml(error)}</p>` : ''}
          </div>
          ${metric('单位净值', nav(fund.unitNav))}
          ${metric('平台估值', nav(fund.platformNav), clsByNum(fund.platformPct), pct(fund.platformPct))}
          ${metric('自算贡献', pct(model.contributionPct), clsByNum(model.contributionPct), 'Top10实际贡献')}
          ${metric('自算代理', pct(model.proxyPct), clsByNum(model.proxyPct), 'Top10归一化')}
          ${metric('采用估值', nav(estimate.nav), clsByNum(estimate.pct), `${pct(estimate.pct)} · ${estimate.source}`)}
          ${metric('持仓金额', money(pos.marketValue), '', `成本 ${money(pos.costAmount)}`)}
          ${metric('持有收益', money(pos.totalProfit), clsByNum(pos.totalProfit), pct(pos.totalProfitPct))}
          <div class="fund-actions">
            <button data-action="refresh" data-code="${escapeHtml(fund.code)}">刷新</button>
            <button data-action="manual" data-code="${escapeHtml(fund.code)}">手动重仓</button>
            <button data-action="remove" data-code="${escapeHtml(fund.code)}">删除</button>
          </div>
        </div>
        <div class="fund-detail">
          <div class="position-box">
            <div class="position-grid">
              <label>持有份额<input data-action="edit" data-field="units" data-code="${escapeHtml(fund.code)}" value="${escapeAttr(fund.units ?? '')}" inputmode="decimal" /></label>
              <label>成本金额<input data-action="edit" data-field="costAmount" data-code="${escapeHtml(fund.code)}" value="${escapeAttr(fund.costAmount ?? '')}" inputmode="decimal" /></label>
              <label>备注<textarea data-action="edit" data-field="note" data-code="${escapeHtml(fund.code)}">${escapeHtml(fund.note || '')}</textarea></label>
            </div>
            <div class="footer-row">
              <span>今日估算：<b class="${clsByNum(pos.todayProfit)}">${money(pos.todayProfit)}</b></span>
              <span>来源：${escapeHtml(estimate.source)}</span>
            </div>
          </div>
          <div class="holdings-box">
            <div class="holdings-head">
              <div>
                <h4>${manual ? '手动重仓' : '自动重仓'} <span class="holdings-meta">覆盖 ${coverageText} · 报告期 ${escapeHtml(report)} · 有行情 ${model.validCount}/${activeHoldings.length}</span></h4>
                <p class="mini-note">Top10贡献 = Σ 权重 × 个股涨跌；Top10归一化 = Top10贡献 / Top10覆盖率。</p>
              </div>
            </div>
            ${renderHoldingsTable(activeHoldings)}
          </div>
        </div>
      </article>`;
  }

  function metric(label, value, valueClass = '', sub = '') {
    return `<div class="metric"><span>${escapeHtml(label)}</span><strong class="${valueClass}">${escapeHtml(value)}</strong>${sub ? `<span>${escapeHtml(sub)}</span>` : ''}</div>`;
  }

  function renderHoldingsTable(holdings) {
    if (!holdings || !holdings.length) return '<div class="empty-list">暂无重仓数据。可刷新，或点“手动重仓”粘贴季报持仓。</div>';
    const rows = holdings.map((h) => {
      const contribution = Number.isFinite(Number(h.weight)) && Number.isFinite(Number(h.change)) ? Number(h.weight) / 100 * Number(h.change) : null;
      return `<tr>
        <td>${escapeHtml(h.code || '--')}</td>
        <td>${escapeHtml(h.name || h.quoteName || '--')}</td>
        <td>${Number.isFinite(Number(h.weight)) ? Number(h.weight).toFixed(2) + '%' : '--'}</td>
        <td class="${clsByNum(h.change)}">${pct(h.change)}</td>
        <td class="${clsByNum(contribution)}">${pct(contribution)}</td>
      </tr>`;
    }).join('');
    return `<table class="holding-table">
      <thead><tr><th>代码</th><th>名称</th><th>权重</th><th>涨跌</th><th>贡献</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/'/g, '&#39;');
  }

  function setupEvents() {
    $('addFundBtn').addEventListener('click', () => {
      addFund($('fundCodeInput').value);
      $('fundCodeInput').value = '';
    });
    $('fundCodeInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('addFundBtn').click();
    });
    $('addSampleBtn').addEventListener('click', () => {
      let added = 0;
      for (const code of SAMPLE_CODES) {
        if (!state.funds.some((x) => x.code === code)) {
          state.funds.push({ code, name: `基金(${code})`, units: '', costAmount: '', note: '', holdings: [], manualHoldings: [], addedAt: new Date().toISOString() });
          added += 1;
        }
      }
      saveState();
      render();
      toast(added ? `已加入 ${added} 只示例基金` : '示例基金已经都在列表里了');
    });
    $('refreshAllBtn').addEventListener('click', () => refreshAll({ includeHoldings: true }));
    $('refreshSecondsInput').addEventListener('change', (e) => {
      state.settings.refreshSeconds = Number(e.target.value) || 0;
      saveState();
      setupAutoRefresh();
      render();
    });
    $('valuationModeSelect').addEventListener('change', (e) => {
      state.settings.valuationMode = e.target.value;
      saveState();
      render();
    });
    $('exportBtn').addEventListener('click', exportBackup);
    $('importFile').addEventListener('change', importBackup);
    $('fundList').addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const code = btn.dataset.code;
      const action = btn.dataset.action;
      if (action === 'remove') return removeFund(code);
      if (action === 'manual') return openManualDialog(code);
      if (action === 'refresh') {
        const idx = state.funds.findIndex((x) => x.code === code);
        if (idx < 0) return;
        btn.disabled = true;
        try {
          state.funds[idx] = await refreshFund(state.funds[idx], { includeHoldings: true });
          saveState();
          render();
          toast(`${code} 已刷新`);
        } catch (error) {
          state.funds[idx].lastError = error.message;
          saveState();
          render();
        }
      }
    });
    $('fundList').addEventListener('input', (e) => {
      const el = e.target.closest('[data-action="edit"]');
      if (!el) return;
      updateFundField(el.dataset.code, el.dataset.field, el.value);
    });
    $('saveManualBtn').addEventListener('click', saveManualDialog);
    $('clearManualBtn').addEventListener('click', clearManualDialog);

    document.querySelectorAll('[data-scroll]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = document.querySelector(btn.dataset.scroll);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.querySelectorAll('[data-scroll]').forEach((x) => x.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    $('installBtn')?.addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice.catch(() => null);
        deferredInstallPrompt = null;
        $('installTip')?.classList.add('hidden');
      } else {
        toast('iPhone：Safari 分享按钮 → 添加到主屏幕');
      }
    });

    $('closeInstallTip')?.addEventListener('click', () => {
      localStorage.setItem('fund-mobile-hide-install-tip', '1');
      $('installTip')?.classList.add('hidden');
    });
  }

  function setupAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    const sec = Number(state.settings.refreshSeconds) || 0;
    if (sec > 0) {
      refreshTimer = setInterval(() => refreshAll({ includeHoldings: false }), sec * 1000);
    }
  }

  function exportBackup() {
    const payload = JSON.stringify(state, null, 2);
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fund-mobile-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importBackup(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed.funds)) throw new Error('备份文件缺少 funds');
      state = {
        ...cloneDefaultState(),
        ...parsed,
        settings: { ...DEFAULT_STATE.settings, ...(parsed.settings || {}) },
      };
      saveState();
      setupAutoRefresh();
      render();
      toast('备份已导入');
    } catch (error) {
      toast(`导入失败：${error.message}`);
    } finally {
      e.target.value = '';
    }
  }

  function setupPwa() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js').catch(() => null);
      });
    }

    const tip = $('installTip');
    if (tip && localStorage.getItem('fund-mobile-hide-install-tip') !== '1') {
      const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone;
      if (!standalone) tip.classList.remove('hidden');
    }

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      $('installTip')?.classList.remove('hidden');
    });
  }

  function init() {
    setupPwa();
    setupEvents();
    setupAutoRefresh();
    render();
  }

  init();
})();
