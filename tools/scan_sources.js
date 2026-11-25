// Read-only preflight for both agents. Keep verbose results out of model prompts.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { priorityCompanies } = require('./priority_companies');
const root = path.join(__dirname, '..');
const date = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const dir = path.join(root, '_workspace', date);
fs.mkdirSync(dir, { recursive: true });
console.log('우선 기업 (' + date + '): ' + priorityCompanies().join(', '));
for (const script of ['official_check', 'saramin_diff']) {
  const file = path.join(dir, script + '.txt');
  const result = spawnSync(process.execPath, [path.join(__dirname, script + '.js')], {
    cwd: root, encoding: 'utf8', timeout: 6 * 60 * 1000, maxBuffer: 8 * 1024 * 1024,
  });
  const output = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n');
  fs.writeFileSync(file, output);
  const candidates = output.split(/\r?\n/).filter(s => /^(NEW |\+ )/.test(s)).length;
  console.log(script + ': 후보 ' + candidates + '건 · ' + path.relative(root, file));
  const summary = output.match(/"failed":\s*(\[[\s\S]*?\])/);
  if (result.status !== 0 || (summary && summary[1] !== '[]')) {
    console.log('재확인 필요: ' + script + ' (실패·부분 수집을 0건으로 처리하지 말 것)');
    process.exitCode = 2;
  }
}
