// scripts/scrape.js
// 毎日 https://www.shokucho.co.jp/original4.html を取得し、docs/data に CSV/JSON を出力。
// 既存GASの算出式: market = (momoAvg*0.55 + muneAvg*0.45) * 0.32; transaction = floor(market)+10

import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import iconv from "iconv-lite";
import cheerio from "cheerio";
import Papa from "papaparse";

const URL = "https://www.shokucho.co.jp/original4.html";
const OUT_DIR = path.join("docs", "data");
const DAILY_JSON = path.join(OUT_DIR, "daily.json");
const DAILY_CSV = path.join(OUT_DIR, "daily.csv");
const MONTHLY_JSON = path.join(OUT_DIR, "monthly-summary.json");

const MARKET = { momo: 0.55, mune: 0.45, scale: 0.32 };

function toHalf(s) {
  return String(s).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
}
function sanitizeCell(s) {
  return String(s)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function splitNumbers(s) {
  const t = toHalf((s||"")).replace(/[^\d\.\s\-]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return [];
  return t.split(" ").map(x => Number(String(x).replace(/,/g,""))).filter(n => Number.isFinite(n));
}
function pad4(arr) {
  const a = arr.slice(0,4);
  while (a.length < 4) a.push(undefined);
  return a;
}
function ymd(date) {
  const y = date.getFullYear();
  const m = (date.getMonth()+1).toString().padStart(2,"0");
  const d = date.getDate().toString().padStart(2,"0");
  return `${y}-${m}-${d}`;
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (GitHubActions; ChickenPrice/1.0)"
    },
  });
  const buf = await res.arrayBuffer();
  const ct = res.headers.get("content-type") || "";
  const isSjis = /shift_jis|sjis/i.test(ct);
  return isSjis ? iconv.decode(Buffer.from(buf), "Shift_JIS") : iconv.decode(Buffer.from(buf), "UTF-8");
}

function loadExistingDaily() {
  if (fs.existsSync(DAILY_JSON)) {
    return JSON.parse(fs.readFileSync(DAILY_JSON, "utf8"));
  }
  return [];
}

function writeOutputs(rows) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(DAILY_JSON, JSON.stringify(rows, null, 2));

  const csv = Papa.unparse(rows, { header: true });
  fs.writeFileSync(DAILY_CSV, csv);

  const groups = {};
  for (const r of rows) {
    if (Number.isFinite(r.market_price)) {
      const [y, m] = r.date.split("-").map(Number);
      groups[y] ??= {};
      groups[y][m] ??= [];
      groups[y][m].push(r.market_price);
    }
  }
  const monthly = [];
  for (const y of Object.keys(groups).sort()) {
    for (const m of Object.keys(groups[y]).map(Number).sort((a,b)=>a-b)) {
      const arr = groups[y][m];
      const avg = Math.floor(arr.reduce((s,v)=>s+v,0) / arr.length);
      monthly.push({ year: Number(y), month: m, market_price_avg: avg });
    }
  }
  fs.writeFileSync(MONTHLY_JSON, JSON.stringify(monthly, null, 2));
}

function mergeAppend(existing, appended) {
  const set = new Set(existing.map(r => r.date));
  const merged = existing.slice();
  for (const r of appended) {
    if (!set.has(r.date)) {
      merged.push(r);
      set.add(r.date);
    }
  }
  merged.sort((a,b)=> a.date.localeCompare(b.date));
  return merged;
}

async function main() {
  const html = await fetchHtml(URL);
  const $ = cheerio.load(html);

  const tables = $("table").toArray();
  const today = new Date();
  const thisYear = today.getFullYear();

  const out = [];

  for (const t of tables) {
    const $table = $(t);
    const text = $table.text();
    const m = text.match(/([０-９\\d]{1,2})\\s*月/);
    const currentMonth = m ? (parseInt(toHalf(m[1])) - 1) : null;

    $table.find("tr").each((_, tr) => {
      const cells = $(tr).find("td,th").toArray().map(td => sanitizeCell($(td).html() || ""));
      if (cells.length !== 4) return;

      const dayText = toHalf(cells[0]);
      const weekday = cells[1];
      if (!/^\\d{1,2}日$/.test(dayText)) return;
      if (!/^[月火水木金土日]$/.test(weekday)) return;
      if (weekday === "水") return;
      if (currentMonth === null) return;

      const day = parseInt(dayText.replace("日",""));
      const dateObj = new Date(thisYear, currentMonth, day);
      if (dateObj > today) return;
      const dateKey = ymd(dateObj);

      const momoNums = splitNumbers(cells[2]);
      const muneNums = splitNumbers(cells[3]);
      if (momoNums.length < 3 || muneNums.length < 3) return;
      const [momoLow, momoAvg, momoHigh, momoVol] = pad4(momoNums);
      const [muneLow, muneAvg, muneHigh, muneVol] = pad4(muneNums);

      const market = (momoAvg * MARKET.momo + muneAvg * MARKET.mune) * MARKET.scale;
      const transaction = Math.floor(market) + 10;

      out.push({
        date: dateKey,
        weekday,
        momo_low: Math.floor(momoLow),
        momo_avg: Math.floor(momoAvg),
        momo_high: Math.floor(momoHigh),
        momo_vol: Number.isFinite(momoVol) ? momoVol : "",
        mune_low: Math.floor(muneLow),
        mune_avg: Math.floor(muneAvg),
        mune_high: Math.floor(muneHigh),
        mune_vol: Number.isFinite(muneVol) ? muneVol : "",
        market_price: Math.floor(market),
        transaction_price: transaction
      });
    });
  }

  const existing = loadExistingDaily();
  const merged = mergeAppend(existing, out);
  writeOutputs(merged);

  console.log(`✅ done. appended=${out.length}, total=${merged.length}`);
}

main().catch(e => {
  console.error("❌ scrape failed", e);
  process.exit(1);
});
