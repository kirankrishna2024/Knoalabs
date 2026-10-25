const ExcelJS = require('exceljs');
const { wallClock } = require('./time');

const GREEN = 'FF0E2C2B';   // header fill (brand primary)

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
  ['UTM campaign', 18, (l) => l.utm_campaign],
  ['Meta app (Facebook / Instagram)', 20, (l) => l.meta_platform],
  ['Meta placement', 22, (l) => l.meta_placement],
  ['Form version', 12, (l) => l.form_version],
  ['Other answers (added in Form Studio)', 40, (l) => {
    const c = typeof l.custom_fields === 'string' ? (() => { try { return JSON.parse(l.custom_fields); } catch { return null; } })() : l.custom_fields;
    return c && typeof c === 'object' ? Object.entries(c).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('; ') : null;
  }],
  ['Source (detected)', 18, (l) => l.source_detected],
  ['Source (as shown on the dashboard)', 22, (l) => l.channel_label],
  ['How the source was found', 22, (l) => l.source_via],
  ['Referring website', 22, (l) => { try { return l.referrer ? new URL(l.referrer).hostname.replace(/^www\./, '') : null; } catch { return null; } }],
  ['Campaign', 20, (l) => l.campaign_label],
  ['Medium', 12, (l) => l.medium_label],
  ['Browser (as listed)', 24, (l) => l.browser_label],
  ['Device', 10, (l) => l.device_type],
  ['System', 12, (l) => l.os],
  ['Browser', 14, (l) => l.browser],
  ['Opened in app', 14, (l) => l.in_app],
  ['City', 16, (l) => l.geo_city],
  ['State / region', 18, (l) => l.geo_region],
  ['Country (from IP)', 14, (l) => l.geo_country_code],
  ['Exact latitude (browser)', 16, (l) => (l.browser_lat == null ? null : Number(l.browser_lat))],
  ['Exact longitude (browser)', 16, (l) => (l.browser_lon == null ? null : Number(l.browser_lon))],
  ['Location accuracy (m)', 14, (l) => (l.browser_accuracy == null ? null : Number(l.browser_accuracy))],
  ['Returning (same person)', 14, (l) => (l.is_returning_lead ? 'Yes' : null)],
  ['Same person because', 16, (l) => l.match_basis],
  ['Visits before registering', 12, (l) => l.visit_count_before_signup],
  ['Seconds to register', 12, (l) => l.time_to_register_seconds]
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

const UNREG_COLUMNS = [
  ['This visit', 20, (v, tz) => (v.at ? wallClock(tz, new Date(v.at)) : null)],
  ['First seen', 20, (v, tz) => (v.first_seen ? wallClock(tz, new Date(v.first_seen)) : null)],
  ['Last seen', 20, (v, tz) => (v.last_seen ? wallClock(tz, new Date(v.last_seen)) : null)],
  ['Visits', 8, (v) => v.visits], ['Sessions', 9, (v) => v.sessions],
  ['Master class', 28, (v) => v.course], ['Campaign', 20, (v) => v.campaign], ['Medium', 12, (v) => v.medium],
  ['Source (as shown on the dashboard)', 22, (v) => v.channel], ['How the source was found', 22, (v) => v.via], ['Referring website', 22, (v) => v.referrer_host],
  ['Device', 10, (v) => v.device], ['System', 14, (v) => v.os], ['Browser (as listed)', 24, (v) => v.browser], ['Opened in app', 14, (v) => v.in_app],
  ['Language', 10, (v) => v.language], ['Time zone', 18, (v) => v.timezone], ['Screen', 11, (v) => v.screen],
  ['City', 16, (v) => v.city], ['State / region', 18, (v) => v.region], ['Country', 16, (v) => v.country], ['IP (masked)', 18, (v) => v.ip], ['Landing page', 20, (v) => v.landing],
  ['Started filling the form', 12, (v) => (v.started_form ? 'Yes' : 'No')], ['Pressed Register', 12, (v) => (v.pressed_register ? 'Yes' : 'No')],
  ['Last field touched', 18, (v) => v.last_field], ['Fields that failed the check', 28, (v) => (v.failed_fields && v.failed_fields.length ? v.failed_fields.join(', ') : null)]
];

/**
 * The file behind "Leads in this view": sheet "Registered leads" (every answer + where they came from), sheet "Did not register"
 * (visitors who opened the link and left: only what the tracker saw, there are no answers), and a Summary with the filters used.
 */
async function buildViewWorkbook({ registered, unregistered, unregisteredAvailable, filtersText, periodText, tz, generatedAt = new Date() }) {
  const wb = await buildWorkbook({ leads: registered, stats: null, filtersText, tz, generatedAt });
  const ws = wb.getWorksheet('Leads'); ws.name = 'Registered leads';
  const un = wb.addWorksheet('Did not register', { views: [{ state: 'frozen', ySplit: 1 }] });
  un.columns = UNREG_COLUMNS.map(([header, width]) => ({ header, width }));
  un.getRow(1).height = 24;
  un.getRow(1).eachCell((cell) => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } }; cell.alignment = { vertical: 'middle', wrapText: true }; });
  for (const v of unregistered) { const row = un.addRow(UNREG_COLUMNS.map(([, , get]) => { const x = get(v, tz); return x === undefined || x === '' ? null : x; })); for (const c of [1, 2, 3]) row.getCell(c).numFmt = 'dd-mmm-yyyy hh:mm'; }
  un.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: UNREG_COLUMNS.length } };
  const sm = wb.getWorksheet('Summary');
  sm.insertRow(4, ['Period', periodText || '']);
  sm.spliceRows(6, 0, ['Registered leads', registered.length], ['Visitors who did not register', unregisteredAvailable ? unregistered.length : 'not available when "I am a" is chosen']);
  return wb;
}

module.exports = { buildWorkbook, buildViewWorkbook };
