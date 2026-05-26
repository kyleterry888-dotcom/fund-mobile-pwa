(() => {
  'use strict';

  const STORAGE_KEY = 'fund-lite-state-v1';
  const SAMPLE_CODES = ['024500', '160213', '023881', '011730'];
  const CHART_RANGES = {
    m1: { label: '近1月', days: 24, months: 1 },
    m3: { label: '近3月', days: 72, months: 3 },
    m6: { label: '近6月', days: 145, months: 6 },
    y1: { label: '近1年', days: 260, months: 12 },
    all: { label: '全部', days: 9999, months: null },
  };
  const DEFAULT_STATE = {
    funds: [],
    settings: {
      refreshSeconds: 0,
      valuationMode: 'auto',
      listMode: 'compact',
    },
    updatedAt: null,
  };

  const $ = (id) => document.getElementById(id);
  const fmt = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
  const fmt4 = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  const toNum = (v) => isNum(v) ? Number(v) : null;
  const money = (v) => isNum(v) ? `¥${fmt.format(Number(v))}` : '--';
  const compactMoney = (v) => {
    if (!isNum(v)) return '--';
    const n = Number(v);
    const abs = Math.abs(n);
    if (abs >= 100000000) return `¥${(n / 100000000).toFixed(abs >= 1000000000 ? 1 : 2)}亿`;
    if (abs >= 10000) return `¥${(n / 10000).toFixed(abs >= 100000 ? 1 : 2)}万`;
    return `¥${fmt.format(n)}`;
  };
  const pct = (v) => isNum(v) ? `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(2)}%` : '--';
  const nav = (v) => isNum(v) ? fmt4.format(Number(v)) : '--';
  const clsByNum = (v) => !isNum(v) ? 'flat-text' : Number(v) > 0 ? 'up-text' : Number(v) < 0 ? 'down-text' : 'flat-text';
  const todayStr = () => new Date().toLocaleString('zh-CN', { hour12: false });
  const cleanCode = (v) => String(v || '').trim().replace(/[^0-9A-Za-z.]/g, '').toUpperCase();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const dateOnly = (v) => {
    const m = String(v || '').match(/\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : null;
  };
  const compareDate = (a, b) => {
    const da = dateOnly(a);
    const db = dateOnly(b);
    if (!da || !db) return null;
    return da === db ? 0 : da > db ? 1 : -1;
  };
  const chinaDateStr = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());


  function getChinaWeekday(dateStr) {
    const t = parseIsoDateTime(dateStr);
    return t ? new Date(t).getUTCDay() : null;
  }

  function previousChinaWeekday(dateStr) {
    const t = parseIsoDateTime(dateStr);
    if (!t) return dateStr;
    const d = new Date(t);
    do {
      d.setUTCDate(d.getUTCDate() - 1);
    } while ([0, 6].includes(d.getUTCDay()));
    return d.toISOString().slice(0, 10);
  }

  function getValuationTargetDate(fund) {
    // 用“当前应该被估值的日期”判断官方净值是否足够新。
    // 例如 2026-05-25 刷新 QDII，若官方净值只到 2026-05-22，就不能把 22 号涨幅当成 25 号涨幅覆盖。
    const today = chinaDateStr();
    const gzDate = dateOnly(fund?.gztime);
    const weekday = getChinaWeekday(today);
    if (weekday === 0 || weekday === 6) {
      const prev = previousChinaWeekday(today);
      if (gzDate && compareDate(gzDate, prev) >= 0) return { date: gzDate, source: '平台估值日' };
      return { date: prev, source: '最近工作日' };
    }
    if (gzDate && compareDate(gzDate, today) > 0) return { date: gzDate, source: '平台估值日' };
    return { date: today, source: gzDate ? '中国交易日' : '中国自然日' };
  }

  function diffDays(a, b) {
    const ta = parseIsoDateTime(a);
    const tb = parseIsoDateTime(b);
    if (!Number.isFinite(ta) || !Number.isFinite(tb) || !ta || !tb) return null;
    return Math.round((tb - ta) / 86400000);
  }

  function getFundProfileText(fund) {
    const holdingText = getActiveHoldings(fund)
      .map((h) => `${h.name || ''} ${h.quoteName || ''} ${h.code || ''}`)
      .join(' ');
    return `${fund?.name || ''} ${fund?.code || ''} ${holdingText}`.toUpperCase();
  }

  function getFundMarketProfile(fund) {
    const text = getFundProfileText(fund);
    const hasQdiiWord = /QDII|海外|全球|跨境|互联互通|纳斯达克|纳指|NASDAQ|标普|S\s*&\s*P|SP500|道琼|DOW|美股|美国|印度|越南|欧洲|德国|法国|英国|原油|油气|商品|黄金|日经|日本|韩国|韩股|香港|港股|恒生|H股|中概|中国互联网|恒生科技|恒生互联网/.test(text);
    const sameDayAsiaLike = /香港|港股|恒生|H股|恒生科技|恒生互联网|日本|日经|韩国|韩股|亚太/.test(text);
    const usLike = /纳斯达克|纳指|NASDAQ|标普|S\s*&\s*P|SP500|道琼|DOW|罗素|美股|美国|美元/.test(text);
    const qdiiMarker = /QDII|海外|全球|跨境/.test(text);
    const countryLagLike = /印度|越南|欧洲|德国|法国|英国/.test(text);
    const commodityLagLike = /原油|油气|商品/.test(text);
    const goldLagLike = /黄金/.test(text) && qdiiMarker;

    // 只把“明显可能按海外市场 T+N 公布净值”的基金纳入滞后净值逻辑。
    // 港股、日经、韩股这类亚洲市场不强行打滞后标签；如果它们当天净值已覆盖估值日，仍会正常显示官方净值。
    // “黄金”等词可能是境内 ETF，所以必须配合 QDII/海外/全球/跨境标记才按海外滞后处理。
    const lagAware = !!(usLike || ((qdiiMarker || countryLagLike || commodityLagLike || goldLagLike) && !sameDayAsiaLike));
    return {
      isQdiiLike: !!hasQdiiWord,
      sameDayAsiaLike,
      lagAware,
      label: lagAware ? '海外滞后类' : hasQdiiWord ? '跨境/亚洲类' : '普通基金',
    };
  }

  function getOfficialNavStatus(fund) {
    const navDate = dateOnly(fund?.unitNavDate);
    const target = getValuationTargetDate(fund);
    const targetDate = dateOnly(target.date);
    const hasNav = Number.isFinite(toNum(fund?.unitNav));
    const cmp = navDate && targetDate ? compareDate(navDate, targetDate) : null;
    const ready = hasNav && cmp !== null && cmp >= 0;
    const stale = hasNav && cmp !== null && cmp < 0;
    const lagDays = stale ? diffDays(navDate, targetDate) : 0;
    const publishDate = dateOnly(fund?.officialNavDetectedDate) || dateOnly(fund?.officialNavUpdatedAt) || null;
    const today = chinaDateStr();
    const profile = getFundMarketProfile(fund);
    // “今天公布了更早净值日”的特殊展示，只对明显的美股/海外滞后类 QDII 生效。
    // 普通 A 股基金、港股/日经/韩股类基金，净值日没覆盖估值日时，列表页仍优先展示盘中估值。
    const publishedToday = hasNav && !!publishDate && compareDate(publishDate, today) === 0;
    const staleButFresh = stale && publishedToday && profile.lagAware;
    const showLagWarning = stale && profile.lagAware;
    return {
      ready,
      stale,
      staleButFresh,
      showLagWarning,
      publishedToday,
      publishDate,
      lagDays: Number.isFinite(lagDays) ? Math.max(0, lagDays) : null,
      navDate,
      targetDate,
      targetSource: target.source,
      profile,
      reason: ready ? 'official_current' : staleButFresh ? 'official_lagged_fresh' : showLagWarning ? 'official_lagging_overseas' : stale ? 'official_waiting_estimate' : 'official_missing',
    };
  }

  let state = loadState();
  let refreshing = false;
  let refreshTimer = null;
  let manualDialogCode = null;
  let deferredInstallPrompt = null;
  let expandedFundCode = null;

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

  function enrichNetValues(values) {
    const list = Array.isArray(values) ? values : [];
    return list.map((item, idx) => {
      let growth = Number(item.growth);
      if (!Number.isFinite(growth) && idx > 0) {
        const prev = Number(list[idx - 1]?.unitNav);
        const cur = Number(item.unitNav);
        if (Number.isFinite(prev) && prev !== 0 && Number.isFinite(cur)) {
          growth = (cur / prev - 1) * 100;
        }
      }
      return { ...item, growth: Number.isFinite(growth) ? growth : null };
    });
  }

  function formatDateInChina(value) {
    const d = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(d.getTime())) return null;
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  }

  function shiftDateStr(dateStr, { years = 0, months = 0, days = 0 } = {}) {
    const base = dateStr ? new Date(`${dateStr}T00:00:00Z`) : new Date();
    if (!Number.isFinite(base.getTime())) return chinaDateStr();
    if (years) base.setUTCFullYear(base.getUTCFullYear() + years);
    if (months) base.setUTCMonth(base.getUTCMonth() + months);
    if (days) base.setUTCDate(base.getUTCDate() + days);
    return base.toISOString().slice(0, 10);
  }

  const PINGZHONG_KEYS = ['fS_name', 'fS_code', 'Data_netWorthTrend', 'Data_ACWorthTrend'];

  function loadPingzhongData(code, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const oldValues = {};
      for (const key of PINGZHONG_KEYS) {
        oldValues[key] = window[key];
        try { delete window[key]; } catch { window[key] = undefined; }
      }
      let done = false;
      const cleanup = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (document.body.contains(script)) document.body.removeChild(script);
        for (const key of PINGZHONG_KEYS) window[key] = oldValues[key];
      };
      const snapshot = () => {
        const out = {};
        for (const key of PINGZHONG_KEYS) {
          try { out[key] = JSON.parse(JSON.stringify(window[key])); }
          catch { out[key] = window[key]; }
        }
        return out;
      };
      const timer = setTimeout(() => {
        const data = snapshot();
        cleanup();
        if (Array.isArray(data.Data_netWorthTrend) && data.Data_netWorthTrend.length) resolve(data);
        else reject(new Error('走势图请求超时'));
      }, timeoutMs);
      script.onload = () => {
        const data = snapshot();
        cleanup();
        Array.isArray(data.Data_netWorthTrend) && data.Data_netWorthTrend.length
          ? resolve(data)
          : reject(new Error('走势图无数据'));
      };
      script.onerror = () => { cleanup(); reject(new Error('走势图脚本加载失败')); };
      script.src = `https://fund.eastmoney.com/pingzhongdata/${encodeURIComponent(code)}.js?v=${Date.now()}`;
      script.async = true;
      document.body.appendChild(script);
    });
  }

  async function fetchTrendNetValues(code) {
    const data = await loadPingzhongData(code);
    const trend = Array.isArray(data?.Data_netWorthTrend) ? data.Data_netWorthTrend : [];
    const byDate = new Map();
    for (const item of trend) {
      const ts = Number(item?.x);
      const unitNav = Number(item?.y);
      if (!Number.isFinite(ts) || !Number.isFinite(unitNav) || unitNav <= 0) continue;
      const date = formatDateInChina(ts);
      if (!date) continue;
      const growth = Number(item?.equityReturn);
      byDate.set(date, {
        date,
        unitNav,
        growth: Number.isFinite(growth) ? growth : null,
        source: '走势',
      });
    }
    return enrichNetValues(Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date)));
  }

  async function fetchF10NetValuesPaged(code, { maxPages = 2, per = 100, years = 3 } = {}) {
    const edate = chinaDateStr();
    const sdate = shiftDateStr(edate, { years: -years });
    const merged = new Map();
    let emptyOrRepeated = 0;
    for (let page = 1; page <= maxPages; page += 1) {
      const url = `https://fundf10.eastmoney.com/F10DataApi.aspx?type=lsjz&code=${encodeURIComponent(code)}&page=${page}&per=${per}&sdate=${sdate}&edate=${edate}`;
      try {
        const data = await loadEastmoneyApidata(url, 12000);
        const batch = enrichNetValues(parseNetValuesFromHtml(data?.content || '')).map((x) => ({ ...x, source: 'F10' }));
        if (!batch.length) break;
        let added = 0;
        for (const row of batch) {
          if (!merged.has(row.date)) added += 1;
          merged.set(row.date, row);
        }
        if (added === 0) emptyOrRepeated += 1;
        else emptyOrRepeated = 0;
        if (emptyOrRepeated >= 2) break;
        const oldest = batch[0]?.date;
        if (oldest && oldest <= sdate) break;
        await sleep(80);
      } catch {
        break;
      }
    }
    return Array.from(merged.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  function mergeNetValueLists(...lists) {
    const merged = new Map();
    for (const list of lists) {
      for (const row of Array.isArray(list) ? list : []) {
        if (!row?.date || !Number.isFinite(toNum(row.unitNav))) continue;
        const prev = merged.get(row.date) || {};
        merged.set(row.date, { ...prev, ...row, date: row.date, unitNav: toNum(row.unitNav) });
      }
    }
    return enrichNetValues(Array.from(merged.values()).sort((a, b) => a.date.localeCompare(b.date)));
  }

  async function fetchFundNetValues(code) {
    let trend = [];
    let f10 = [];
    const errors = [];
    try {
      trend = await fetchTrendNetValues(code);
    } catch (error) {
      errors.push(`走势：${error.message}`);
    }

    // F10 最近数据用于覆盖最新净值/日涨幅；如果走势源失败或太短，则多翻页兜底。
    const maxPages = trend.length >= 120 ? 2 : 18;
    try {
      f10 = await fetchF10NetValuesPaged(code, { maxPages, per: 100, years: 3 });
    } catch (error) {
      errors.push(`F10：${error.message}`);
    }

    const values = mergeNetValueLists(trend, f10);
    const source = [trend.length ? `走势图${trend.length}条` : '', f10.length ? `F10 ${f10.length}条` : ''].filter(Boolean).join(' + ') || '无';
    return {
      values,
      source,
      count: values.length,
      earliest: values[0]?.date || null,
      latest: values[values.length - 1]?.date || null,
      error: values.length ? null : errors.join('；'),
    };
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
      const w = toNum(h.weight);
      const c = toNum(h.change);
      if (Number.isFinite(w) && w > 0) coverage += w;
      if (Number.isFinite(w) && Number.isFinite(c)) {
        contributionPct += (w / 100) * c;
        validCount += 1;
      }
    }
    const proxyPct = coverage > 0 && validCount > 0 ? contributionPct / (coverage / 100) : null;
    return {
      coverage,
      validCount,
      contributionPct: validCount > 0 && Number.isFinite(contributionPct) ? contributionPct : null,
      proxyPct: Number.isFinite(proxyPct) ? proxyPct : null,
    };
  }

  function pickEstimate(fund) {
    const mode = state.settings.valuationMode || 'auto';
    const unitNav = toNum(fund.unitNav);
    const platformNav = toNum(fund.platformNav);
    const model = computeHoldingModel(getActiveHoldings(fund));
    const navFromPct = (p) => Number.isFinite(unitNav) && Number.isFinite(p) ? unitNav * (1 + p / 100) : null;
    const candidates = {
      platform: Number.isFinite(platformNav) ? { nav: platformNav, pct: toNum(fund.platformPct), source: '平台估值' } : null,
      top10_contribution: Number.isFinite(model.contributionPct) ? { nav: navFromPct(model.contributionPct), pct: model.contributionPct, source: 'Top10贡献' } : null,
      top10_proxy: Number.isFinite(model.proxyPct) ? { nav: navFromPct(model.proxyPct), pct: model.proxyPct, source: 'Top10归一化' } : null,
    };
    if (mode !== 'auto') return candidates[mode] || { nav: null, pct: null, source: '无可用估值' };
    return candidates.platform || candidates.top10_proxy || candidates.top10_contribution || { nav: null, pct: null, source: '无可用估值' };
  }

  function isOfficialNavReady(fund) {
    return getOfficialNavStatus(fund).ready;
  }

  function getPrimaryValuation(fund) {
    const officialStatus = getOfficialNavStatus(fund);
    if (officialStatus.ready) {
      return {
        nav: toNum(fund.unitNav),
        pct: toNum(fund.dailyGrowth),
        source: '官方净值',
        official: true,
        officialStatus,
      };
    }

    // QDII/跨境基金：今天公布了更早净值日的官方净值时，主展示这个官方最新净值。
    // 但它代表的是净值日表现，不是估值日/今天的涨跌。
    if (officialStatus.staleButFresh && Number.isFinite(toNum(fund.unitNav))) {
      return {
        nav: toNum(fund.unitNav),
        pct: toNum(fund.dailyGrowth),
        source: '官方净值（净值日）',
        official: false,
        officialLagged: true,
        officialStatus,
      };
    }

    const estimate = pickEstimate(fund);
    if (Number.isFinite(toNum(estimate.nav)) || Number.isFinite(toNum(estimate.pct))) {
      return { ...estimate, official: false, officialStatus };
    }

    // 没有可用盘中估值时，仍展示最新官方净值作为“资产参考”，但不把它当成今日涨幅。
    if (officialStatus.stale && Number.isFinite(toNum(fund.unitNav))) {
      return {
        nav: toNum(fund.unitNav),
        pct: null,
        source: officialStatus.showLagWarning ? '最新净值（海外滞后）' : '最新净值',
        official: false,
        staleOfficialOnly: true,
        officialStatus,
      };
    }

    return { ...estimate, official: false, officialStatus };
  }

  function getDisplayMode(fund) {
    const primary = getPrimaryValuation(fund);
    const officialStatus = primary.officialStatus || getOfficialNavStatus(fund);
    if (primary.official) {
      return {
        title: '官方净值',
        value: nav(primary.nav),
        pct: primary.pct,
        sub: `净值日 ${fund.unitNavDate || '--'}`,
        badge: '净值已出',
        source: 'official',
      };
    }
    if (primary.officialLagged) {
      const lag = Number.isFinite(officialStatus.lagDays) ? `滞后 ${officialStatus.lagDays} 天` : '滞后';
      return {
        title: '最新净值',
        value: nav(primary.nav),
        pct: primary.pct,
        sub: `净值日 ${officialStatus.navDate || '--'}`,
        badge: '海外净值已更新',
        source: 'official_lagged',
      };
    }
    if (primary.staleOfficialOnly) {
      const lag = Number.isFinite(officialStatus.lagDays) ? `滞后 ${officialStatus.lagDays} 天` : '滞后';
      return {
        title: '最新净值',
        value: nav(primary.nav),
        pct: null,
        sub: officialStatus.showLagWarning ? `净值日 ${officialStatus.navDate || '--'}` : `净值日 ${officialStatus.navDate || '--'} · 暂无盘中估值`,
        badge: officialStatus.showLagWarning ? '海外净值滞后' : '最新净值',
        source: 'stale',
      };
    }
    const staleText = officialStatus.showLagWarning ? ` · 最新净值日 ${officialStatus.navDate || '--'}` : '';
    return {
      title: '盘中估值',
      value: nav(primary.nav),
      pct: primary.pct,
      sub: `${primary.source}${staleText}`,
      badge: officialStatus.showLagWarning ? '海外净值滞后' : '盘中估值',
      source: 'estimate',
    };
  }

  function getChartRangeKey(fund) {
    return CHART_RANGES[fund?.chartRange] ? fund.chartRange : 'm3';
  }

  function computePosition(fund) {
    const units = toNum(fund.units);
    const costAmount = toNum(fund.costAmount);
    const latestNav = toNum(fund.unitNav);
    const estimate = pickEstimate(fund);
    const primary = getPrimaryValuation(fund);
    const primaryNav = toNum(primary.nav);
    const marketValue = Number.isFinite(units) && Number.isFinite(primaryNav) ? units * primaryNav : null;
    const latestValue = Number.isFinite(units) && Number.isFinite(latestNav) ? units * latestNav : null;
    const totalProfit = Number.isFinite(marketValue) && Number.isFinite(costAmount) ? marketValue - costAmount : null;
    const totalProfitPct = Number.isFinite(totalProfit) && Number.isFinite(costAmount) && costAmount !== 0 ? totalProfit / costAmount * 100 : null;
    let todayProfit = null;
    if (primary.official || primary.officialLagged) {
      const growth = toNum(fund.dailyGrowth);
      const prevNav = Number.isFinite(latestNav) && Number.isFinite(growth) && growth !== -100 ? latestNav / (1 + growth / 100) : null;
      todayProfit = Number.isFinite(units) && Number.isFinite(latestNav) && Number.isFinite(prevNav) ? units * (latestNav - prevNav) : null;
    } else if (primary.staleOfficialOnly) {
      todayProfit = null;
    } else {
      todayProfit = Number.isFinite(marketValue) && Number.isFinite(latestValue) ? marketValue - latestValue : null;
    }
    return {
      units,
      costAmount,
      latestNav,
      estimate,
      primary,
      marketValue,
      latestValue,
      totalProfit,
      totalProfitPct,
      todayProfit,
      officialReady: !!primary.official,
      officialLagged: !!primary.officialLagged,
      usingOfficialNav: !!(primary.official || primary.officialLagged),
      officialStatus: primary.officialStatus || getOfficialNavStatus(fund),
    };
  }

  async function refreshFund(fund, { includeHoldings = true } = {}) {
    const code = fund.code;
    const [valuation, netValueResult] = await Promise.all([
      fetchFundValuation(code),
      fetchFundNetValues(code),
    ]);
    const netValues = Array.isArray(netValueResult?.values) ? netValueResult.values : [];
    const latest = netValues[netValues.length - 1] || null;
    const nowIso = new Date().toISOString();
    const nowChinaDate = chinaDateStr();
    const latestNav = latest?.unitNav ?? null;
    const latestGrowth = latest?.growth ?? null;
    const officialChanged = !!latest && (
      dateOnly(latest.date) !== dateOnly(fund.unitNavDate) ||
      toNum(latestNav) !== toNum(fund.unitNav) ||
      toNum(latestGrowth) !== toNum(fund.dailyGrowth)
    );
    const officialNavDetectedDate = latest
      ? (officialChanged || !fund.officialNavDetectedDate ? nowChinaDate : fund.officialNavDetectedDate)
      : (fund.officialNavDetectedDate || null);
    const officialNavUpdatedAt = latest
      ? (officialChanged || !fund.officialNavUpdatedAt ? nowIso : fund.officialNavUpdatedAt)
      : (fund.officialNavUpdatedAt || null);
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
      officialNavDetectedDate,
      officialNavUpdatedAt,
      officialNavLastSeenAt: latest ? nowIso : (fund.officialNavLastSeenAt || null),
      netValues: netValues.length ? netValues : (fund.netValues || []),
      netValueSource: netValueResult?.source || fund.netValueSource || null,
      netValueEarliest: netValueResult?.earliest || fund.netValueEarliest || null,
      netValueLatest: netValueResult?.latest || fund.netValueLatest || null,
      netValueCount: netValueResult?.count || fund.netValueCount || null,
      netValueError: netValueResult?.error || null,
      platformNav: valuation.platformNav,
      platformPct: valuation.platformPct,
      gztime: valuation.gztime,
      valuationError: valuation.error || null,
      holdings: holdingsData.holdings?.length ? holdingsData.holdings : (fund.holdings || []),
      holdingsReportDate: holdingsData.reportDate || fund.holdingsReportDate || null,
      lastRefreshAt: nowIso,
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
      chartRange: 'm3',
      netValueSource: null,
      addedAt: new Date().toISOString(),
    });
    saveState();
    render();
    toast(`已添加 ${normalized}`);
  }

  function removeFund(code) {
    if (!confirm(`确定删除 ${code} 吗？本地持仓数据也会删除。`)) return;
    state.funds = state.funds.filter((x) => x.code !== code);
    if (expandedFundCode === code) expandedFundCode = null;
    saveState();
    render();
  }


  function moveFund(code, direction) {
    const from = state.funds.findIndex((x) => x.code === code);
    if (from < 0) return;
    const to = from + direction;
    if (to < 0 || to >= state.funds.length) return;
    const next = [...state.funds];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    state.funds = next;
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
      summaryCard('当前持仓', hasMarket ? money(totalMarket) : '--', `优先用已发布官方净值，否则用${labelMode(state.settings.valuationMode)}`),
      summaryCard('持有收益', Number.isFinite(totalProfit) ? money(totalProfit) : '--', Number.isFinite(totalProfitPct) ? pct(totalProfitPct) : '需要填写成本金额', clsByNum(totalProfit)),
      summaryCard('收益变化', hasToday ? money(totalToday) : '--', '普通基金优先盘中估值；海外滞后类显示净值日收益', clsByNum(totalToday)),
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
    const listDisplayModeSelect = $('listDisplayModeSelect');
    if (listDisplayModeSelect) listDisplayModeSelect.value = state.settings.listMode || 'compact';
    renderSummary();
    if (!state.funds.length) {
      $('fundList').className = 'fund-list empty-list';
      $('fundList').textContent = '暂无基金。可以先点“一键加入示例基金”。';
      return;
    }
    $('fundList').className = 'fund-list';
    $('fundList').innerHTML = state.funds.map((fund, index) => renderFundCard(fund, index)).join('');
    bindChartControls($('fundList'));
  }

  function renderFundCard(fund, index = 0) {
    const activeHoldings = getActiveHoldings(fund);
    const model = computeHoldingModel(activeHoldings);
    const pos = computePosition(fund);
    const primary = pos.primary;
    const display = getDisplayMode(fund);
    const manual = Array.isArray(fund.manualHoldings) && fund.manualHoldings.length > 0;
    const coverageText = model.coverage ? `${model.coverage.toFixed(2)}%` : '--';
    const report = fund.holdingsReportDate || '--';
    const error = fund.lastError || fund.valuationError;
    const expanded = expandedFundCode === fund.code;
    const navStatus = pos.officialStatus || getOfficialNavStatus(fund);
    const listMode = state.settings.listMode || 'compact';
    const simpleMode = listMode !== 'normal';
    const officialBadge = pos.officialReady
      ? '<span class="mode-badge official">净值已出</span>'
      : pos.officialLagged
        ? '<span class="mode-badge official lagged">海外净值已更新</span>'
        : navStatus.showLagWarning
          ? '<span class="mode-badge stale">海外净值滞后</span>'
          : '<span class="mode-badge estimate">盘中估值</span>';
    const simpleBadge = pos.officialReady
      ? '<span class="simple-badge official">官方</span>'
      : pos.officialLagged
        ? '<span class="simple-badge official">净值日</span>'
        : '<span class="simple-badge estimate">估值</span>';
    const platformSub = pos.usingOfficialNav ? `参考 ${pct(fund.platformPct)} · ${fund.gztime || '--'}` : `${pct(fund.platformPct)} · ${fund.gztime || '--'}`;
    const todayLabel = pos.officialReady ? '今日收益' : pos.officialLagged ? '净值日收益' : primary.staleOfficialOnly ? '今日估算不可用' : '今日估算';
    const performanceTitle = pos.officialLagged ? '净值日表现' : '今日表现';
    const performanceSub = pos.officialReady ? '官方涨幅' : pos.officialLagged ? `净值日 ${navStatus.navDate || '--'} 涨幅` : primary.staleOfficialOnly ? (navStatus.showLagWarning ? '海外净值滞后' : '暂无盘中估值') : '估算涨幅';
    const subtitle = simpleMode
      ? `${escapeHtml(fund.code)} · ${display.source === 'official' ? `净值日 ${escapeHtml(fund.unitNavDate || '--')}` : (fund.gztime ? `估值 ${escapeHtml(fund.gztime)}` : `净值日 ${escapeHtml(fund.unitNavDate || '--')}`)}${error ? ` · ${escapeHtml(error)}` : ''}`
      : `${escapeHtml(fund.code)} · 净值日 ${escapeHtml(fund.unitNavDate || '--')} · ${fund.lastRefreshAt ? `刷新 ${new Date(fund.lastRefreshAt).toLocaleTimeString('zh-CN', { hour12: false })}` : '未刷新'}`;
    return `
      <article class="fund-card ${expanded ? 'is-expanded' : ''} ${simpleMode ? 'is-simple' : 'is-normal'}" data-code="${escapeHtml(fund.code)}">
        <div class="fund-compact">
          <div class="fund-mainline">
            <div class="fund-title compact-fund-title">
              <h3>${escapeHtml(fund.name || `基金(${fund.code})`)} ${simpleMode ? '' : officialBadge}</h3>
              <p>${subtitle}</p>
              ${error && !simpleMode ? `<p class="warn-text">${escapeHtml(error)}</p>` : ''}
            </div>
            <div class="compact-controls" aria-label="基金操作">
              <button type="button" class="order-btn" data-action="moveUp" data-code="${escapeHtml(fund.code)}" ${index <= 0 ? 'disabled' : ''} aria-label="上移 ${escapeHtml(fund.code)}">↑</button>
              <button type="button" class="order-btn" data-action="moveDown" data-code="${escapeHtml(fund.code)}" ${index >= state.funds.length - 1 ? 'disabled' : ''} aria-label="下移 ${escapeHtml(fund.code)}">↓</button>
              <button type="button" class="detail-toggle" data-action="detail" data-code="${escapeHtml(fund.code)}">${expanded ? '收起' : '详情'}</button>
            </div>
          </div>
          ${simpleMode ? `
            <div class="simple-quote-row">
              <div class="simple-quote-main">
                ${simpleBadge}
                <strong class="${clsByNum(display.pct)}">${escapeHtml(pct(display.pct))}</strong>
                <span class="simple-nav-value">${escapeHtml(display.value)}</span>
              </div>
              <div class="simple-quote-sub">${escapeHtml(display.sub)}</div>
            </div>
          ` : `
            <div class="compact-metrics">
              ${metric(display.title, display.value, clsByNum(display.pct), display.sub)}
              ${metric(performanceTitle, pct(display.pct), clsByNum(display.pct), performanceSub)}
              ${metric('持仓金额', compactMoney(pos.marketValue), '', `${todayLabel} ${compactMoney(pos.todayProfit)}`)}
              ${metric('持有收益', compactMoney(pos.totalProfit), clsByNum(pos.totalProfit), pct(pos.totalProfitPct))}
            </div>
          `}
        </div>
        ${expanded ? renderFundDetail(fund, { activeHoldings, model, pos, primary, manual, coverageText, report, platformSub }) : ''}
      </article>`;
  }

  function renderFundDetail(fund, context) {
    const { activeHoldings, model, pos, manual, coverageText, report, platformSub } = context;
    const primary = pos.primary;
    const navStatus = pos.officialStatus || getOfficialNavStatus(fund);
    const navFreshness = pos.officialReady
      ? `净值日 ${navStatus.navDate || fund.unitNavDate || '--'} 已覆盖估值日 ${navStatus.targetDate || '--'}`
      : pos.officialLagged
        ? `${navStatus.publishDate || '--'} 更新了净值日 ${navStatus.navDate || '--'} 的官方净值；它是最新官方净值，但不是估值日 ${navStatus.targetDate || '--'} 的当日涨幅`
        : navStatus.showLagWarning
          ? `海外滞后类：净值日 ${navStatus.navDate || '--'} 落后估值日 ${navStatus.targetDate || '--'}；列表仍会在有盘中估值时优先显示盘中估值`
          : `普通/亚洲跨境基金：净值日未覆盖估值日时，列表优先显示盘中估值`;
    return `
      <div class="fund-detail expanded-detail">
        <div class="detail-actions">
          <button type="button" data-action="refresh" data-code="${escapeHtml(fund.code)}">刷新这只</button>
          <button type="button" data-action="manual" data-code="${escapeHtml(fund.code)}">手动重仓</button>
          <button type="button" data-action="remove" data-code="${escapeHtml(fund.code)}">删除</button>
        </div>

        <div class="chart-box detail-box">
          <div class="detail-head">
            <div>
              <h4>净值走势</h4>
              <p>主图改为区间涨跌幅；鼠标悬停或手指点按某一天，可查看当日涨幅、净值和净值差。</p>
            </div>
          </div>
          ${renderNavChart(fund)}
        </div>

        <div class="position-box detail-box">
          <div class="detail-head">
            <div>
              <h4>持仓设置</h4>
              <p>份额、成本和备注只保存在本机浏览器。</p>
            </div>
          </div>
          <div class="position-grid">
            <label>持有份额<input data-action="edit" data-field="units" data-code="${escapeHtml(fund.code)}" value="${escapeAttr(fund.units ?? '')}" inputmode="decimal" /></label>
            <label>成本金额<input data-action="edit" data-field="costAmount" data-code="${escapeHtml(fund.code)}" value="${escapeAttr(fund.costAmount ?? '')}" inputmode="decimal" /></label>
            <label>备注<textarea data-action="edit" data-field="note" data-code="${escapeHtml(fund.code)}">${escapeHtml(fund.note || '')}</textarea></label>
          </div>
          <div class="footer-row">
            <span>${pos.officialReady ? '今日收益' : pos.officialLagged ? '净值日收益' : '今日估算'}：<b class="${clsByNum(pos.todayProfit)}">${money(pos.todayProfit)}</b></span>
            <span>来源：${escapeHtml(primary.source)}</span>
          </div>
        </div>

        <div class="valuation-box detail-box">
          <div class="detail-head">
            <div>
              <h4>估值拆分</h4>
              <p>普通基金默认优先看盘中估值；只有美股/明显海外滞后类 QDII，才会把“今天公布的更早净值日”作为净值日表现单独展示。</p>
            </div>
          </div>
          <div class="detail-metrics">
            ${metric('最新净值', nav(fund.unitNav), clsByNum(fund.dailyGrowth), `${pct(fund.dailyGrowth)} · ${fund.unitNavDate || '--'}`)}
            ${metric('净值状态', pos.officialReady ? '已覆盖' : pos.officialLagged ? '海外已更新' : navStatus.showLagWarning ? '海外滞后' : '估值优先', navStatus.showLagWarning && !pos.officialLagged ? 'warn-text' : '', navFreshness)}
            ${metric(pos.officialReady ? '盘中估值' : '平台估值', nav(fund.platformNav), clsByNum(fund.platformPct), platformSub)}
            ${metric('Top10贡献', pct(model.contributionPct), clsByNum(model.contributionPct), 'Σ 权重 × 个股涨跌')}
            ${metric('Top10归一化', pct(model.proxyPct), clsByNum(model.proxyPct), '贡献 ÷ Top10覆盖率')}
          </div>
          <div class="valuation-explain">
            <p><b>Top10贡献</b>：只计算已披露前十大重仓对基金净值的直接贡献，公式是 Σ 持仓权重 × 个股涨跌。</p>
            <p><b>Top10归一化</b>：把前十大覆盖的仓位视作 100% 后得到的代理涨跌，更适合用来粗略观察基金经理重仓方向的当天表现。</p>
          </div>
        </div>

        <div class="holdings-box detail-box">
          <div class="holdings-head">
            <div>
              <h4>${manual ? '手动重仓' : '自动重仓'} <span class="holdings-meta">覆盖 ${coverageText} · 报告期 ${escapeHtml(report)} · 有行情 ${model.validCount}/${activeHoldings.length}</span></h4>
              <p class="mini-note">这里仅展示持仓明细；估值含义已经放到上面的“估值拆分”。</p>
            </div>
          </div>
          ${renderHoldingsTable(activeHoldings)}
        </div>
      </div>`;
  }

  function renderNavChart(fund) {
    const values = fund?.netValues || [];
    const all = (Array.isArray(values) ? values : [])
      .filter((x) => Number.isFinite(toNum(x.unitNav)) && dateOnly(x.date))
      .map((x) => ({ ...x, date: dateOnly(x.date) }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (all.length < 2) return '<div class="empty-list chart-empty">暂无走势图。先点“刷新全部”或“刷新这只”。</div>';

    const rangeKey = getChartRangeKey(fund);
    const range = CHART_RANGES[rangeKey] || CHART_RANGES.m3;
    const lastAll = all[all.length - 1];
    const cutoffTime = rangeKey === 'all' ? -Infinity : subtractMonthsTime(lastAll.date, range.months);
    const earliestAllTime = parseIsoDateTime(all[0]?.date);
    let list = all.filter((item) => rangeKey === 'all' || parseIsoDateTime(item.date) >= cutoffTime);
    // 如果接口暂时只给了很短一段数据，保留所有可用点，并在图下明确提示覆盖范围。
    if (list.length < 2) list = all.slice(-Math.min(range.days, all.length));
    const rangeLimitedByData = rangeKey !== 'all' && Number.isFinite(cutoffTime) && earliestAllTime > cutoffTime;
    const requestedStart = rangeKey === 'all' ? all[0]?.date : formatDateInChina(cutoffTime);

    const width = 560;
    const height = 390;
    const pad = { left: 58, right: 86, top: 34, bottom: 42 };
    const lineH = 244;
    const barTop = pad.top + lineH + 28;
    const barH = 54;
    const chartW = width - pad.left - pad.right;
    const baseNav = toNum(list[0]?.unitNav);
    const navValues = list.map((x) => toNum(x.unitNav));
    const returnValues = list.map((x) => Number.isFinite(baseNav) && baseNav > 0 ? (toNum(x.unitNav) / baseNav - 1) * 100 : 0);
    const highIndex = returnValues.indexOf(Math.max(...returnValues));
    const lowIndex = returnValues.indexOf(Math.min(...returnValues));

    let minRet = Math.min(0, ...returnValues);
    let maxRet = Math.max(0, ...returnValues);
    const spanRet = maxRet - minRet;
    const extra = spanRet === 0 ? 1 : Math.max(0.35, spanRet * 0.14);
    minRet -= extra;
    maxRet += extra;

    const xAt = (i) => pad.left + (i / Math.max(1, list.length - 1)) * chartW;
    const yAtRet = (v) => pad.top + (maxRet - v) / Math.max(0.000001, maxRet - minRet) * lineH;
    const point = (_item, i) => `${xAt(i).toFixed(2)},${yAtRet(returnValues[i]).toFixed(2)}`;
    const linePath = list.map((item, i) => `${i === 0 ? 'M' : 'L'}${point(item, i)}`).join(' ');
    const zeroYLine = clamp(yAtRet(0), pad.top, pad.top + lineH);
    const areaPath = `${linePath} L${xAt(list.length - 1).toFixed(2)},${zeroYLine.toFixed(2)} L${xAt(0).toFixed(2)},${zeroYLine.toFixed(2)} Z`;
    const first = list[0];
    const last = list[list.length - 1];
    const trendPct = returnValues[returnValues.length - 1];
    const latestGrowth = toNum(last.growth);
    const avgGrowth = (() => {
      const gs = list.map((x) => toNum(x.growth)).filter(Number.isFinite);
      return gs.length ? gs.reduce((a, b) => a + b, 0) / gs.length : null;
    })();
    const maxDrawdown = computeMaxDrawdown(list);
    const yTicks = [maxRet, minRet + (maxRet - minRet) * 0.75, (maxRet + minRet) / 2, minRet + (maxRet - minRet) * 0.25, minRet];
    const xLabelIndexes = uniqueIndexes([0, Math.floor((list.length - 1) / 4), Math.floor((list.length - 1) / 2), Math.floor((list.length - 1) * 3 / 4), list.length - 1]);
    const gradientId = `retGradient_${String(fund.code || 'fund').replace(/[^A-Za-z0-9_-]/g, '')}_${rangeKey}`;
    const growthValues = list.map((x) => toNum(x.growth)).filter(Number.isFinite);
    const maxAbsGrowth = Math.max(0.01, ...growthValues.map((x) => Math.abs(x)));
    const zeroY = barTop + barH / 2;
    const barW = Math.max(1.2, Math.min(7, chartW / Math.max(1, list.length) * 0.68));
    const bars = list.map((item, i) => {
      const g = toNum(item.growth);
      if (!Number.isFinite(g)) return '';
      const h = Math.min(barH / 2, Math.abs(g) / maxAbsGrowth * (barH / 2));
      const x = xAt(i) - barW / 2;
      const y = g >= 0 ? zeroY - h : zeroY;
      return `<rect class="${g >= 0 ? 'chart-bar-up' : 'chart-bar-down'}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${Math.max(1, h).toFixed(2)}" rx="0.8"></rect>`;
    }).join('');

    const points = list.map((item, i) => {
      const ret = returnValues[i];
      const daily = toNum(item.growth);
      const diff = (() => {
        const cur = toNum(item.unitNav);
        const prev = i > 0 ? toNum(list[i - 1]?.unitNav) : null;
        return Number.isFinite(cur) && Number.isFinite(prev) ? cur - prev : null;
      })();
      return {
        index: i,
        date: item.date,
        x: xAt(i),
        y: yAtRet(ret),
        returnPct: ret,
        growth: daily,
        unitNav: toNum(item.unitNav),
        diff,
      };
    });
    const hitZones = points.map((p, i) => {
      const prevX = i === 0 ? pad.left : (points[i - 1].x + p.x) / 2;
      const nextX = i === points.length - 1 ? width - pad.right : (p.x + points[i + 1].x) / 2;
      const x = clamp(prevX, pad.left, width - pad.right);
      const w = Math.max(4, clamp(nextX, pad.left, width - pad.right) - x);
      const diffText = Number.isFinite(p.diff) ? `${p.diff >= 0 ? '+' : ''}${p.diff.toFixed(4)}` : '--';
      return `<rect class="chart-hit-zone" x="${x.toFixed(2)}" y="${pad.top}" width="${w.toFixed(2)}" height="${lineH}" data-x="${p.x.toFixed(2)}" data-y="${p.y.toFixed(2)}" data-date="${escapeAttr(p.date)}" data-return="${escapeAttr(pct(p.returnPct))}" data-return-num="${Number.isFinite(p.returnPct) ? p.returnPct.toFixed(4) : ''}" data-growth="${escapeAttr(pct(p.growth))}" data-growth-num="${Number.isFinite(p.growth) ? p.growth.toFixed(4) : ''}" data-nav="${escapeAttr(nav(p.unitNav))}" data-diff="${escapeAttr(diffText)}"></rect>`;
    }).join('');

    const recentRows = list.slice(-12).reverse().map((item) => {
      const idx = list.indexOf(item);
      return `
      <tr>
        <td>${escapeHtml(item.date)}</td>
        <td class="${clsByNum(returnValues[idx])}">${pct(returnValues[idx])}</td>
        <td class="${clsByNum(item.growth)}">${pct(item.growth)}</td>
        <td>${nav(item.unitNav)}</td>
      </tr>`;
    }).join('');

    const rangeTabs = Object.entries(CHART_RANGES).map(([key, item]) => `
      <button type="button" class="chart-range-tab ${key === rangeKey ? 'active' : ''}" data-action="chartRange" data-code="${escapeHtml(fund.code)}" data-range="${key}" aria-pressed="${key === rangeKey ? 'true' : 'false'}">${escapeHtml(item.label)}</button>
    `).join('');
    const rangeSelect = `<select class="chart-range-select" data-action="chartRangeSelect" data-code="${escapeHtml(fund.code)}" aria-label="走势图区间">
      ${Object.entries(CHART_RANGES).map(([key, item]) => `<option value="${key}" ${key === rangeKey ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
    </select>`;

    return `
      <div class="nav-chart-wrap rich-chart return-chart" data-chart-code="${escapeHtml(fund.code)}" data-chart-range="${escapeHtml(rangeKey)}">
        <div class="chart-control-row">
          <div class="chart-range-tabs">${rangeTabs}</div>
          ${rangeSelect}
        </div>
        <div class="chart-stat-row chart-stat-row-v2">
          <div><span>${escapeHtml(range.label)}涨跌</span><strong class="${clsByNum(trendPct)}">${pct(trendPct)}</strong></div>
          <div><span>最新净值</span><strong>${nav(last.unitNav)}</strong></div>
          <div><span>最新日涨幅</span><strong class="${clsByNum(latestGrowth)}">${pct(latestGrowth)}</strong></div>
          <div><span>最大回撤</span><strong class="${clsByNum(maxDrawdown)}">${pct(maxDrawdown)}</strong></div>
        </div>
        <div class="chart-stage">
          <svg class="nav-chart detailed-nav-chart detailed-nav-chart-v2 detailed-return-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="基金区间涨跌幅走势图" data-chart-width="${width}" data-chart-height="${height}">
            <defs>
              <linearGradient id="${gradientId}" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stop-color="#22d3ee" stop-opacity="0.30" />
                <stop offset="100%" stop-color="#22d3ee" stop-opacity="0.03" />
              </linearGradient>
            </defs>
            <text class="chart-axis-title" x="${pad.left}" y="18">区间涨跌幅</text>
            ${yTicks.map((tick) => {
              const y = yAtRet(tick);
              return `<g class="chart-grid-line"><line x1="${pad.left}" y1="${y.toFixed(2)}" x2="${width - pad.right}" y2="${y.toFixed(2)}"></line><text x="8" y="${(y + 4).toFixed(2)}">${pct(tick)}</text></g>`;
            }).join('')}
            ${xLabelIndexes.map((idx) => {
              const x = xAt(idx);
              return `<text class="chart-x-label" x="${x.toFixed(2)}" y="${height - 12}" text-anchor="${idx === 0 ? 'start' : idx === list.length - 1 ? 'end' : 'middle'}">${escapeHtml(String(list[idx].date || '').slice(5))}</text>`;
            }).join('')}
            <path class="chart-area" d="${areaPath}" fill="url(#${gradientId})"></path>
            <path class="chart-line return-chart-line" d="${linePath}"></path>
            <line class="chart-zero-line" x1="${pad.left}" y1="${zeroYLine.toFixed(2)}" x2="${width - pad.right}" y2="${zeroYLine.toFixed(2)}"></line>
            <text class="chart-axis-title" x="${pad.left}" y="${(barTop - 8).toFixed(2)}">日涨跌</text>
            ${bars}
            <line class="chart-zero-line" x1="${pad.left}" y1="${zeroY.toFixed(2)}" x2="${width - pad.right}" y2="${zeroY.toFixed(2)}"></line>
            <g class="chart-point high-point"><circle cx="${xAt(highIndex).toFixed(2)}" cy="${yAtRet(returnValues[highIndex]).toFixed(2)}" r="4.3"></circle><text x="${clamp(xAt(highIndex) + 7, pad.left + 4, width - 112).toFixed(2)}" y="${Math.max(17, yAtRet(returnValues[highIndex]) - 8).toFixed(2)}">高 ${pct(returnValues[highIndex])}</text></g>
            <g class="chart-point low-point"><circle cx="${xAt(lowIndex).toFixed(2)}" cy="${yAtRet(returnValues[lowIndex]).toFixed(2)}" r="4.3"></circle><text x="${clamp(xAt(lowIndex) + 7, pad.left + 4, width - 112).toFixed(2)}" y="${Math.min(barTop - 10, yAtRet(returnValues[lowIndex]) + 16).toFixed(2)}">低 ${pct(returnValues[lowIndex])}</text></g>
            <g class="chart-point latest-point"><circle cx="${xAt(list.length - 1).toFixed(2)}" cy="${yAtRet(trendPct).toFixed(2)}" r="5"></circle></g>
            <g class="chart-latest-badge" transform="translate(${(width - pad.right + 10).toFixed(2)} ${clamp(yAtRet(trendPct) - 26, pad.top + 4, pad.top + lineH - 46).toFixed(2)})">
              <rect x="0" y="0" width="72" height="43" rx="9"></rect>
              <text class="chart-latest-title" x="8" y="15">最新</text>
              <text class="chart-latest-return ${trendPct >= 0 ? 'up-text' : 'down-text'}" x="8" y="29">${pct(trendPct)}</text>
              <text class="chart-latest-nav" x="8" y="40">净值 ${nav(last.unitNav)}</text>
            </g>
            <g class="chart-hover-marker" data-chart-marker style="display:none">
              <line class="chart-hover-line" x1="0" x2="0" y1="${pad.top}" y2="${(pad.top + lineH).toFixed(2)}"></line>
              <circle class="chart-hover-circle" cx="0" cy="0" r="5.5"></circle>
            </g>
            <g class="chart-hit-layer">${hitZones}</g>
          </svg>
          <div class="chart-tooltip hidden" data-chart-tooltip></div>
        </div>
        <div class="chart-meta rich-chart-meta rich-chart-meta-v2">
          <span>${escapeHtml(first.date || '--')} → ${escapeHtml(last.date || '--')}</span>
          <span>样本 ${list.length} 条 / 已缓存 ${all.length} 条</span>
          <span>区间高 ${pct(returnValues[highIndex])} / 低 ${pct(returnValues[lowIndex])}</span>
          <span>平均日涨跌 ${pct(avgGrowth)}</span>
          <span>数据源 ${escapeHtml(fund.netValueSource || '历史净值')}</span>
        </div>
        ${rangeLimitedByData ? `<div class="chart-data-warning">当前本地历史净值最早是 ${escapeHtml(all[0]?.date || '--')}，不足以完整覆盖 ${escapeHtml(range.label)}（目标起点约 ${escapeHtml(requestedStart || '--')}）。点“刷新这只”会重新拉取更长历史；如果仍不足，就是接口暂时没给到更早数据。</div>` : ''}
        <details class="nav-detail-table" open>
          <summary>最近 12 条涨跌明细</summary>
          <table>
            <thead><tr><th>日期</th><th>区间涨跌</th><th>日涨幅</th><th>单位净值</th></tr></thead>
            <tbody>${recentRows}</tbody>
          </table>
        </details>
      </div>`;
  }

  function parseIsoDateTime(date) {
    const m = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return 0;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function subtractMonthsTime(date, months) {
    if (!months) return -Infinity;
    const m = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return 0;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    d.setUTCMonth(d.getUTCMonth() - Number(months));
    return d.getTime();
  }

  function uniqueIndexes(indexes) {
    return Array.from(new Set(indexes.filter((x) => Number.isFinite(x) && x >= 0))).sort((a, b) => a - b);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function computeMaxDrawdown(list) {
    let peak = -Infinity;
    let maxDd = 0;
    for (const item of list || []) {
      const v = toNum(item.unitNav);
      if (!Number.isFinite(v)) continue;
      if (v > peak) peak = v;
      if (Number.isFinite(peak) && peak > 0) {
        const dd = (v / peak - 1) * 100;
        if (dd < maxDd) maxDd = dd;
      }
    }
    return maxDd;
  }

  function renderNavDiff(item, list, idx) {
    const cur = toNum(item?.unitNav);
    const prev = idx > 0 ? toNum(list[idx - 1]?.unitNav) : null;
    if (!Number.isFinite(cur) || !Number.isFinite(prev)) return '--';
    const diff = cur - prev;
    return `${diff >= 0 ? '+' : ''}${diff.toFixed(4)}`;
  }

  function metric(label, value, valueClass = '', sub = '') {
    return `<div class="metric"><span>${escapeHtml(label)}</span><strong class="${valueClass}">${escapeHtml(value)}</strong>${sub ? `<span>${escapeHtml(sub)}</span>` : ''}</div>`;
  }

  function renderHoldingsTable(holdings) {
    if (!holdings || !holdings.length) return '<div class="empty-list">暂无重仓数据。可刷新，或点“手动重仓”粘贴季报持仓。</div>';
    const rows = holdings.map((h) => {
      const weight = toNum(h.weight);
      const change = toNum(h.change);
      const contribution = Number.isFinite(weight) && Number.isFinite(change) ? weight / 100 * change : null;
      return `<tr>
        <td>${escapeHtml(h.code || '--')}</td>
        <td>${escapeHtml(h.name || h.quoteName || '--')}</td>
        <td>${Number.isFinite(weight) ? weight.toFixed(2) + '%' : '--'}</td>
        <td class="${clsByNum(change)}">${pct(change)}</td>
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


  function cssSafe(value) {
    const raw = String(value ?? '');
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(raw);
    return raw.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function bindChartControls(root = document) {
    const scope = root || document;
    scope.querySelectorAll('button[data-action="chartRange"]').forEach((btn) => {
      btn.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        setChartRange(btn.dataset.code, btn.dataset.range);
      };
    });
    scope.querySelectorAll('select[data-action="chartRangeSelect"]').forEach((select) => {
      select.onchange = (event) => {
        event.preventDefault();
        event.stopPropagation();
        setChartRange(select.dataset.code, select.value);
      };
      select.onclick = (event) => event.stopPropagation();
    });
    bindChartTooltips(scope);
  }

  function bindChartTooltips(root = document) {
    const scope = root || document;
    scope.querySelectorAll('.nav-chart-wrap').forEach((wrap) => {
      const svg = wrap.querySelector('svg[data-chart-width]');
      const tooltip = wrap.querySelector('[data-chart-tooltip]');
      const marker = wrap.querySelector('[data-chart-marker]');
      if (!svg || !tooltip || !marker) return;
      const line = marker.querySelector('.chart-hover-line');
      const circle = marker.querySelector('.chart-hover-circle');
      const width = Number(svg.dataset.chartWidth) || 560;
      const height = Number(svg.dataset.chartHeight) || 390;

      const showPoint = (zone) => {
        if (!zone) return;
        const x = Number(zone.dataset.x);
        const y = Number(zone.dataset.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        marker.style.display = 'block';
        if (line) {
          line.setAttribute('x1', x.toFixed(2));
          line.setAttribute('x2', x.toFixed(2));
        }
        if (circle) {
          circle.setAttribute('cx', x.toFixed(2));
          circle.setAttribute('cy', y.toFixed(2));
        }

        const returnNum = Number(zone.dataset.returnNum);
        const growthNum = Number(zone.dataset.growthNum);
        tooltip.className = `chart-tooltip ${Number.isFinite(returnNum) && returnNum >= 0 ? 'tooltip-up' : 'tooltip-down'}`;
        tooltip.innerHTML = `
          <strong>${escapeHtml(zone.dataset.date || '--')}</strong>
          <span>区间涨跌：<b class="${clsByNum(returnNum)}">${escapeHtml(zone.dataset.return || '--')}</b></span>
          <span>当日涨幅：<b class="${clsByNum(growthNum)}">${escapeHtml(zone.dataset.growth || '--')}</b></span>
          <span>单位净值：${escapeHtml(zone.dataset.nav || '--')}</span>
          <span>净值差：${escapeHtml(zone.dataset.diff || '--')}</span>
        `;
        const svgW = svg.clientWidth || svg.getBoundingClientRect().width || 1;
        const svgH = svg.clientHeight || svg.getBoundingClientRect().height || 1;
        const left = (x / width) * svgW;
        const top = (y / height) * svgH;
        const tooltipGap = 14;
        const tooltipWidth = 176;
        const useRightSide = left < svgW * 0.58;
        tooltip.classList.toggle('tooltip-right', useRightSide);
        tooltip.classList.toggle('tooltip-left', !useRightSide);
        tooltip.style.left = `${clamp(useRightSide ? left + tooltipGap : left - tooltipGap, tooltipWidth + 6, Math.max(tooltipWidth + 6, svgW - 6)).toFixed(1)}px`;
        tooltip.style.top = `${clamp(top, 48, Math.max(48, svgH - 48)).toFixed(1)}px`;
      };

      const hidePoint = () => {
        marker.style.display = 'none';
        tooltip.className = 'chart-tooltip hidden';
      };

      wrap.querySelectorAll('.chart-hit-zone').forEach((zone) => {
        zone.onpointerenter = () => showPoint(zone);
        zone.onpointermove = () => showPoint(zone);
        zone.onclick = (event) => {
          event.preventDefault();
          event.stopPropagation();
          showPoint(zone);
        };
        zone.ontouchstart = (event) => {
          event.stopPropagation();
          showPoint(zone);
        };
      });
      svg.onpointerleave = (event) => {
        if (event.pointerType !== 'touch') hidePoint();
      };
    });
  }

  function renderChartOnly(code) {
    const fund = state.funds.find((x) => x.code === code);
    if (!fund) return false;
    const current = document.querySelector(`.nav-chart-wrap[data-chart-code="${cssSafe(code)}"]`);
    if (!current) return false;
    current.outerHTML = renderNavChart(fund);
    bindChartControls($('fundList'));
    return true;
  }

  function setChartRange(code, rangeKey) {
    const fund = state.funds.find((x) => x.code === code);
    if (!fund || !CHART_RANGES[rangeKey]) return;
    const normalizedRange = CHART_RANGES[rangeKey] ? rangeKey : 'm3';
    if (fund.chartRange === normalizedRange) {
      // 即使区间没变，也强制局部重画一次，避免 PWA/手机浏览器保留旧 SVG。
      renderChartOnly(code);
      return;
    }
    fund.chartRange = normalizedRange;
    saveState();
    if (!renderChartOnly(code)) render();
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
          state.funds.push({ code, name: `基金(${code})`, units: '', costAmount: '', note: '', holdings: [], manualHoldings: [], netValues: [], chartRange: 'm3', addedAt: new Date().toISOString() });
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
    $('listDisplayModeSelect')?.addEventListener('change', (e) => {
      state.settings.listMode = e.target.value === 'normal' ? 'normal' : 'compact';
      saveState();
      render();
      toast(state.settings.listMode === 'normal' ? '已切换为普通列表' : '已切换为简洁列表');
    });
    $('exportBtn').addEventListener('click', exportBackup);
    $('importFile').addEventListener('change', importBackup);
    $('fundList').addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const code = btn.dataset.code;
      const action = btn.dataset.action;
      if (action === 'remove') return removeFund(code);
      if (action === 'moveUp') return moveFund(code, -1);
      if (action === 'moveDown') return moveFund(code, 1);
      if (action === 'manual') return openManualDialog(code);
      if (action === 'detail') {
        expandedFundCode = expandedFundCode === code ? null : code;
        render();
        return;
      }
      if (action === 'chartRange') {
        e.preventDefault();
        setChartRange(code, btn.dataset.range);
        return;
      }
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
    $('fundList').addEventListener('change', (e) => {
      const el = e.target.closest('[data-action="chartRangeSelect"]');
      if (!el) return;
      setChartRange(el.dataset.code, el.value);
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
