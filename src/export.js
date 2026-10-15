const ExcelJS = require('exceljs');
const { wallClock } = require('./time');

const GREEN = 'FF0D1211';   // header fill (brand ink)

/** Columns of the "Leads" sheet: [header, width, value(lead)] */
const COLUMNS = [
  ['ID', 8, (l) => Number(l.id)],
  ['Registered on', 20, (l, tz) => (l.created_at ? wallClock(tz, new Date(l.created_at)) : null)],
  ['First name', 16, (l) => l.first_name],
  ['Last name', 16, (l) => l.last_name],
  ['Mobile / WhatsApp', 18, (l) => l.phone],
  ['Email', 28, (l) => l.email],
  ['I am a', 20, (l) => l.status],
  ['Course (student)', 16, (l) => l.student_course],
  ['Study status (student)', 20, (l) => l.student_status],
  ['College (student)', 28, (l) => l.college_name],
  ['Specialization (student)', 24, (l) => l.specialization],
  ['Total experience (professional)', 18, (l) => (l.experience_level ? l.experience_level.replace('-', '–') : null)],
  ['Role / domain (professional)', 28, (l) => l.job_role],
  ['Company (professional)', 26, (l) => l.current_company],
  ['Highest qualification (professional)', 24, (l) => l.highest_qualification],
  ['Master class', 30, (l) => l.course],
  ['Page link', 46, (l) => l.page_url],
  ['UTM source', 14, (l) => l.utm_source],
  ['UTM medium', 14, (l) => l.utm_medium],
  ['UTM campaign', 18, (l) => l.utm_campaign]
];

/**
 * Build the workbook: sheet "Leads" (one row per lead) and sheet "Summary".
 * Every value is written as plain data (never as a formula), so nothing typed on the form can run in Excel.
 */
async function buildWorkbook({ leads, stats, filtersText, tz, generatedAt = new Date() }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'KnoaLabs Admin';
  wb.created = generatedAt;

  const ws = wb.addWorksheet('Leads', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUMNS.map(([header, width]) => ({ header, width }));
  const head = ws.getRow(1);
  head.height = 24;
  head.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  for (const l of leads) {
    const row = ws.addRow(COLUMNS.map(([, , get]) => { const v = get(l, tz); return v === undefined || v === '' ? null : v; }));
    row.getCell(2).numFmt = 'dd-mmm-yyyy hh:mm';
    row.getCell(5).numFmt = '@';            // keep +91… as text
    row.getCell(5).alignment = { horizontal: 'left' };
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };

  const sm = wb.addWorksheet('Summary');
  sm.columns = [{ width: 34 }, { width: 14 }];
  const title = sm.addRow(['KnoaLabs leads']); title.font = { bold: true, size: 14 };
  sm.addRow(['Generated', wallClock(tz, generatedAt)]).getCell(2).numFmt = 'dd-mmm-yyyy hh:mm';
  sm.addRow(['Filters', filtersText || 'None (all leads)']);
  sm.addRow(['Leads in this file', leads.length]);
  if (stats) {
    sm.addRow([]);
    sm.addRow(['All leads (whole database)', stats.total]).font = { bold: true };
    sm.addRow(['Today', stats.today]);
    sm.addRow(['Last 7 days', stats.last7]);
    sm.addRow(['Last 30 days', stats.last30]);
    sm.addRow([]);
    sm.addRow(['By "I am a"']).font = { bold: true };
    stats.byStatus.forEach((s) => sm.addRow([s.status, s.n]));
    sm.addRow([]);
    sm.addRow(['By master class']).font = { bold: true };
    stats.byCourse.forEach((c) => sm.addRow([c.course || 'No course in link', c.n]));
  }
  return wb;
}

module.exports = { buildWorkbook };
