const fs = require('fs');
const path = require('path');

const base = path.join(__dirname, '..', '..');

let template = fs.readFileSync(path.join(__dirname, 'dashboard_template.html'), 'utf8');
const reactSrc = fs.readFileSync(path.join(base, 'report', 'vendor', 'react.production.min.js'), 'utf8');
const reactDomSrc = fs.readFileSync(path.join(base, 'report', 'vendor', 'react-dom.production.min.js'), 'utf8');
const postings = fs.readFileSync(path.join(base, 'data', 'postings.json'), 'utf8');
const companies = fs.readFileSync(path.join(base, 'data', 'companies.json'), 'utf8');
const applications = fs.existsSync(path.join(base, 'data', 'applications.json')) ? fs.readFileSync(path.join(base, 'data', 'applications.json'), 'utf8') : '{"applications":[]}';

function sub(str, token, value) {
  return str.split(token).join(value);
}

template = sub(template, '%%CLASSIFY_SRC%%', fs.readFileSync(path.join(__dirname, 'classify.js'), 'utf8'));
template = sub(template, '%%REACT_SRC%%', reactSrc);
template = sub(template, '%%REACT_DOM_SRC%%', reactDomSrc);
template = sub(template, '%%JOB_DATA%%', postings.trim());
template = sub(template, '%%COMPANY_INFO%%', companies.trim());
template = sub(template, '%%APPLICATIONS%%', applications.trim());

fs.writeFileSync(path.join(base, 'report', 'index.html'), template, 'utf8');
console.log('rebuilt index.html, size:', template.length);
