// Phone rules. Single source of truth: served to the browser through /config.js
// and used by the server validator, so the form and the API always agree.
const COUNTRIES = [
  { c: 'IN', d: '+91',  re: '^[6-9]\\d{9}$',  hint: '10 digits starting with 6–9' },
  { c: 'AE', d: '+971', re: '^5\\d{8}$',      hint: '9 digits starting with 5' },
  { c: 'SA', d: '+966', re: '^5\\d{8}$',      hint: '9 digits starting with 5' },
  { c: 'QA', d: '+974', re: '^[3-7]\\d{7}$',  hint: '8 digits' },
  { c: 'KW', d: '+965', re: '^[569]\\d{7}$',  hint: '8 digits' },
  { c: 'OM', d: '+968', re: '^[79]\\d{7}$',   hint: '8 digits' },
  { c: 'BH', d: '+973', re: '^[36]\\d{7}$',   hint: '8 digits' },
  { c: 'US', d: '+1',   re: '^[2-9]\\d{9}$',  hint: '10 digits' },
  { c: 'CA', d: '+1',   re: '^[2-9]\\d{9}$',  hint: '10 digits' },
  { c: 'GB', d: '+44',  re: '^7\\d{9}$',      hint: '10 digits starting with 7' },
  { c: 'AU', d: '+61',  re: '^4\\d{8}$',      hint: '9 digits starting with 4' },
  { c: 'SG', d: '+65',  re: '^[89]\\d{7}$',   hint: '8 digits' },
  { c: 'XX', d: '+',    re: '^\\d{6,14}$',    hint: '6–14 digits', other: true }
];

module.exports = { COUNTRIES };
