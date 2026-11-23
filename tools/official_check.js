// Official career-site check (no LLM, 0 tokens). Additive only: never edits or closes existing postings.
// Usage: node tools/official_check.js [--apply]   (needs: npm i playwright-core, and Chrome installed)
const fs = require('fs');
const path = require('path');
const APPLY = process.argv.includes('--apply');
const DATA = path.join(__dirname, '..', 'data', 'postings.json');

// Runs inside the page. Returns [{title, dday, start, end, endTime, rest}]
function extractCelltrion() {
  const t = document.body.innerText.replace(/\s+/g, ' ');
  const out = [];
  const re = /접수중\s+(.+?)\s+D-(\d+)\s+(\d{4})\.(\d{2})\.(\d{2})\s*~\s*(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}:\d{2})\s+(.+?)(?=\s+\(새 창\))/g;
  let m;
  while ((m = re.exec(t))) {
    out.push({ title: m[1].trim(), start: `${m[3]}-${m[4]}-${m[5]}`, end: `${m[6]}-${m[7]}-${m[8]}`, endTime: m[9], rest: m[10].trim() });
  }
  return { items: out, sawList: /채용공고 목록/.test(t), total: (t.match(/접수중/g) || []).length };
}

// SK Careers lists every SK group company on one page; "더보기" loads 40 more each click.
async function prepareSK(page) {
  for (let i = 0; i < 25; i++) {
    const before = await page.$$eval('a[href*="Recruit/Detail"]', (a) => new Set(a.map((x) => x.href)).size);
    const btn = await page.$('button:has-text("더보기"):visible, a:has-text("더보기"):visible');
    if (!btn) break;
    await btn.click();
    await page.waitForTimeout(1500);
    const after = await page.$$eval('a[href*="Recruit/Detail"]', (a) => new Set(a.map((x) => x.href)).size);
    if (after === before) break;
  }
}
function extractSK() {
  const seen = new Set();
  const items = [];
  document.querySelectorAll('a[href*="Recruit/Detail"]').forEach((a) => {
    if (seen.has(a.href)) return;
    seen.add(a.href);
    const li = a.closest('li') || a.parentElement;
    const t = li.innerText.replace(/\s+/g, ' ').trim();
    const m = t.match(/^(.+?)\s+(\d{4})년 (\d{2})월 (\d{2})일\([^)]\) ~ (\d{4})년 (\d{2})월 (\d{2})일\([^)]\)\s+(D-\d+|D-DAY|상시|채용시)?\s*(.+)$/);
    if (m) items.push({ title: m[1], start: `${m[2]}-${m[3]}-${m[4]}`, end: `${m[5]}-${m[6]}-${m[7]}`, rest: m[9].replace(/공유하기.*$/, '').trim(), url: a.href });
  });
  const mt = document.body.innerText.match(/현재 총 (\d+)건/);
  return { items, sawList: items.length > 0, total: mt ? parseInt(mt[1], 10) : seen.size, seen: seen.size };
}
const SK_BIO = /(SK바이오팜|SK바이오사이언스|SK바이오텍|SK케미칼|SK플라즈마|SK디스커버리)/;

const SITES = [
  { company: '셀트리온', url: 'https://celltrion.recruiter.co.kr/career/jobs', wait: '채용공고 목록', extract: extractCelltrion, label: '셀트리온 공식 채용사이트' },
  { company: null, url: 'https://www.skcareers.com/Recruit', wait: '현재 총', prepare: prepareSK, extract: extractSK, label: 'SK Careers 공식 채용사이트', keep: (it) => /(신입|인턴|무관)/.test(it.rest), companyOf: (it) => { const m = (it.title + ' ' + it.rest).match(SK_BIO); return m ? m[1] : null; } },
];

async function main() {
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const db = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  let added = 0, alerts = 0;
  for (const s of SITES) {
    const page = await browser.newPage();
    try {
      await page.goto(s.url, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForFunction((w) => document.body.innerText.includes(w), s.wait, { timeout: 30000 });
      await page.waitForTimeout(2000);
      if (s.prepare) await s.prepare(page);
      const r = await page.evaluate(s.extract);
      // Structure-change guard: "접수중" appears more often than parsed rows => parser is stale.
      if (!r.sawList || r.items.length !== r.total) {
        alerts++;
        console.log(`ALERT ${s.company || s.label}: parsed ${r.items.length} of ${r.total} rows (sawList=${r.sawList}) - site layout may have changed, check manually`);
      }
      console.log(`${s.company || s.label}: ${r.items.length} open postings`);
      const norm = (x) => String(x || '').replace(/[\s\[\]()]/g, '');
      const bigrams = (x) => { const g = new Set(); for (let i = 0; i < x.length - 1; i++) g.add(x.slice(i, i + 2)); return g; };
      const similar = (a, b) => { if (a === b || a.includes(b) || b.includes(a)) return true; const A = bigrams(a), B = bigrams(b); let n = 0; A.forEach((x) => B.has(x) && n++); return n / (A.size + B.size - n) >= 0.75; };
      for (const it of r.items) {
        const company = s.company || (s.companyOf && s.companyOf(it));
        if (!company) continue; // not a target company
        if (s.keep && !s.keep(it)) continue; // experienced-only rows are excluded by the user's own rule
        const exists = db.postings.some((p) => {
          if (p.company !== company) return false;
          if (it.url && p.url && p.url.includes(it.url.split('/').pop())) return true;
          return similar(norm(p.title), norm(it.title)) && (p.deadline || '') === it.end;
        });
        if (exists) continue;
        console.log(`NEW ${company} | ${it.title} | ${it.start}~${it.end} | ${it.rest}`);
        if (APPLY) {
          db.postings.push({
            id: `official-${company}-${it.end.replace(/-/g, '')}-${Buffer.from(it.title).toString('hex').slice(0, 12)}`,
            company, title: it.title, url: it.url || s.url, jobFunction: '분야별 상이(공고 확인 필요)',
            employmentType: it.rest, location: null, requiredQualifications: null, preferredQualifications: null,
            jobDescription: null, postedDate: it.start, deadline: it.end, processSchedule: null,
            source: 'official', sourceLabel: s.label, status: 'confirmed',
            note: `${today} official_check.js가 공식 채용사이트 목록에서 자동 추가. 상세 직무·자격 미수집, 원문 확인 필요.`,
            firstSeen: today, isNew: true, addedBy: 'official_check',
          });
          added++;
        }
      }
    } catch (e) {
      alerts++;
      console.log(`ALERT ${s.company || s.label}: ${e.message.split('\n')[0]}`);
    } finally { await page.close(); }
  }
  await browser.close();
  if (APPLY && added) {
    db.lastUpdated = today;
    fs.writeFileSync(DATA, JSON.stringify(db, null, 2) + '\n');
  }
  console.log(`done: added=${added} alerts=${alerts}`);
  process.exit(alerts ? 2 : 0);
}
if (require.main === module) main();
module.exports = { extractCelltrion, extractSK };
