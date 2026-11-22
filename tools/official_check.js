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

const SITES = [
  { company: '셀트리온', url: 'https://celltrion.recruiter.co.kr/career/jobs', wait: '채용공고 목록', extract: extractCelltrion, label: '셀트리온 공식 채용사이트' },
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
      const r = await page.evaluate(s.extract);
      // Structure-change guard: "접수중" appears more often than parsed rows => parser is stale.
      if (!r.sawList || r.items.length !== r.total) {
        alerts++;
        console.log(`ALERT ${s.company}: parsed ${r.items.length} of ${r.total} rows (sawList=${r.sawList}) - site layout may have changed, check manually`);
      }
      console.log(`${s.company}: ${r.items.length} open postings`);
      for (const it of r.items) {
        const exists = db.postings.some((p) => p.company === s.company && p.title.replace(/\s/g, '') === it.title.replace(/\s/g, '') && (p.deadline || '') === it.end);
        if (exists) continue;
        console.log(`NEW ${s.company} | ${it.title} | ${it.start}~${it.end} | ${it.rest}`);
        if (APPLY) {
          db.postings.push({
            id: `official-${s.company}-${it.end.replace(/-/g, '')}-${Buffer.from(it.title).toString('hex').slice(0, 12)}`,
            company: s.company, title: it.title, url: s.url, jobFunction: '분야별 상이(공고 확인 필요)',
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
      console.log(`ALERT ${s.company}: ${e.message.split('\n')[0]}`);
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
module.exports = { extractCelltrion };
