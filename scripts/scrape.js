// scripts/scrape.js
// PuppeteerでHTMLを取得（403回避）→ Cheerioで解析 → docs/data へ出力

import fs from "fs";
import path from "path";
import { load } from "cheerio";
import Papa from "papaparse";
import puppeteer from "puppeteer";

const URL = "https://www.shokucho.co.jp/original4.html";
const OUT_DIR = path.join("docs", "data");
const DAILY_JSON = path.join(OUT_DIR, "daily.json");
const DAILY_CSV = path.join(OUT_DIR, "daily.csv");
const MONTHLY_JSON = path.join(OUT_DIR, "monthly-summary.json");

const MARKET = { momo: 0.55, mune: 0.45, scale: 0.32 };

function toHalf(s) { return String(s).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)); }
function sanitizeCell(s) {
  return String(s).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;?/g, " ").replace(/\s+/g, " ").trim();
}
function splitNumbers(s) {
  const t = toHalf((s || "")).replace(/[^\d.\s-]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return [];
  return t.split(" ").map(x => Number(String(x).replace(/,/g, ""))).filter(Number.isFinite);
}
function pad4(arr) { const a = arr.slice(0, 4); while (a.length < 4) a.push(undefined); return a; }
function ymd(date) { const y = date.getFullYear(); const m = String(date.getMonth()+1).padStart(2,"0"); const d = String(date.getDate()).padStart(2,"0"); return `${y}-${m}-${d}`; }
function decideYear(currentMonth0, today) { const thisYear=today.getFullYear(); const thisMonth0=today.getMonth(); return (currentMonth0>thisMonth0+1)? thisYear-1: thisYear; }

async function fetchHtmlWithPuppeteer(url) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox","--disable-setuid-sandbox",
      "--disable-gpu","--disable-dev-shm-usage"
    ]
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
    await page.setExtraHTTPHeaders({
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ja,en;q=0.9",
      "Referer": "https://www.google.com/"
    });
    // 軽量化：画像/フォント/スタイルのリクエストはブロック
    await page.setRequestInterception(true);
    page.on("request", req => {
      const type = req.resourceType();
      if (["image","font","stylesheet"].includes(type)) req.abort();
      else req.continue();
    });

    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (!resp || !resp.ok()) throw new Error(`HTTP ${resp ? resp.status() : "NO_RESPONSE"}`);

    // ページ内の動的テーブル対策：軽く待機
    await page.waitForTimeout(800);
    const html = await page.content();
    console.log("fetch: ok, html length =", html.length);
    return html;
  } finally {
    await browser.close();
  }
}

function loadExistingDaily() {
  try {
    if (fs.existsSync(DAILY_JSON)) return JSON.parse(fs.readFileSync(DAILY_JSON, "utf8"));
  } catch {}
  return [];
}

function writeOutputs(rows) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(DAILY_JSON, JSON.stringify(rows, null, 2));
  fs.writeFileSync(DAILY_CSV, Papa.unparse(rows, { header: true }));

  const groups = {};
  rows.forEach(r => {
    if (!Number.isFinite(r.market_price)) return;
    const [y, m] = r.date.split("-").map(Number);
    (groups[y] ??= {}); (groups[y][m] ??= []).push(r.market_price);
  });
  const monthly = [];
  Object.keys(groups).sort().forEach(y => {
    Object.keys(groups[y]).map(Number).sort((a,b)=>a-b).forEach(m => {
      const arr = groups[y][m];
      const avg = Math.floor(arr.reduce((s,v)=>s+v,0)/arr.length);
      monthly.push({ year: Number(y), month: m, market_price_avg: avg });
    });
  });
  fs.writeFileSync(MONTHLY_JSON, JSON.stringify(monthly, null, 2));
}

function mergeAppend(existing, appended) {
  const set = new Set(existing.map(r => r.date));
  const merged = existing.slice();
  for (const r of appended) if (!set.has(r.date)) { merged.push(r); set.add(r.date); }
  merged.sort((a,b)=> a.date.localeCompare(b.date));
  return merged;
}

async function main() {
  const html = await fetchHtmlWithPuppeteer(URL);
  const $ = load(html);

  const tables = $("table").toArray();
  console.log("tables found:", tables.length);

  const today = new Date();
  const out = [];

  for (const t of tables) {
    const $table = $(t);
    const text = $table.text();
    const m = text.match(/([０-９\d]{1,2})\s*月/);
    const currentMonth0 = m ? parseInt(toHalf(m[1])) - 1 : null;
    if (currentMonth0 === null) continue;

    const year = decideYear(currentMonth0, today);

    $table.find("tr").each((_, tr) => {
      const cells = $(tr).find("td,th").toArray().map(td => sanitizeCell($(td).html() || ""));
      if (cells.length < 3) return;

      const dayText = toHalf(cells[0]);
      const weekday = cells[1];
      if (!/^\d{1,2}日$/.test(dayText)) return;
      if (!/^[月火水木金土日]$/.test(weekday)) return;
      if (weekday === "水") return;

      const numsJoined = cells.slice(2).join(" ");
      const allNums = splitNumbers(numsJoined);
      if (allNums.length < 6) return;

      const tail = allNums.slice(-8);
      const half = Math.floor(tail.length / 2);
      const [momoLow, momoAvg, momoHigh, momoVol] = pad4(tail.slice(0, half));
      const [muneLow, muneAvg, muneHigh, muneVol] = pad4(tail.slice(half));
      if (![momoLow,momoAvg,momoHigh].every(Number.isFinite)) return;
      if (![muneLow,muneAvg,muneHigh].every(Number.isFinite)) return;

      const day = parseInt(dayText.replace("日",""));
      const dateObj = new Date(year, currentMonth0, day);
      if (dateObj > today) return;

      const market = (momoAvg * MARKET.momo + muneAvg * MARKET.mune) * MARKET.scale;
      const transaction = Math.floor(market) + 10;

      out.push({
        date: ymd(dateObj), weekday,
        momo_low: Math.floor(momoLow), momo_avg: Math.floor(momoAvg), momo_high: Math.floor(momoHigh), momo_vol: Number.isFinite(momoVol)?momoVol:"",
        mune_low: Math.floor(muneLow), mune_avg: Math.floor(muneAvg), mune_high: Math.floor(muneHigh), mune_vol: Number.isFinite(muneVol)?muneVol:"",
        market_price: Math.floor(market), transaction_price: transaction
      });
    });
  }

  if (out.length === 0) console.warn("WARN: parsed 0 rows. Check markup/structure.");
  const merged = mergeAppend(loadExistingDaily(), out);
  writeOutputs(merged);
  console.log(`✅ done. appended=${out.length}, total=${merged.length}`);
}

main().catch(e => { console.error("❌ scrape failed", e); process.exit(1); });
