import { NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const TOKEN     = process.env.HUBSPOT_TOKEN;
const PORTAL_ID = process.env.HUBSPOT_PORTAL_ID;
const FORM_GUID = process.env.HUBSPOT_FORM_GUID;
const MJ_KEY    = process.env.MAILJET_API_KEY?.trim();
const MJ_SECRET = process.env.MAILJET_SECRET_KEY?.trim();
const HS_API    = 'https://api.hubapi.com';

// ─── HubSpot CRM helpers ────────────────────────────────────────────────────

async function hsRequest(path, method, body) {
  const res = await fetch(`${HS_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(JSON.stringify({ status: res.status, detail: data }));
  return data;
}

async function findContact(email) {
  try {
    const result = await hsRequest('/crm/v3/objects/contacts/search', 'POST', {
      filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
    });
    return result.results?.[0] || null;
  } catch { return null; }
}

async function findCompany(name) {
  try {
    const result = await hsRequest('/crm/v3/objects/companies/search', 'POST', {
      filterGroups: [{ filters: [{ propertyName: 'name', operator: 'EQ', value: name }] }],
    });
    return result.results?.[0] || null;
  } catch { return null; }
}

async function upsertContact(contact) {
  const existing = await findContact(contact.email);
  const properties = {
    email:     contact.email,
    firstname: contact.first   || '',
    lastname:  contact.last    || '',
    company:   contact.company || '',
    jobtitle:  contact.role    || '',
    phone:     contact.phone   || '',
  };
  if (existing) {
    await hsRequest(`/crm/v3/objects/contacts/${existing.id}`, 'PATCH', { properties });
    return existing.id;
  }
  const created = await hsRequest('/crm/v3/objects/contacts', 'POST', { properties });
  return created.id;
}

async function upsertCompany(name) {
  const existing = await findCompany(name);
  if (existing) return existing.id;
  const created = await hsRequest('/crm/v3/objects/companies', 'POST', {
    properties: { name },
  });
  return created.id;
}

async function associateContactToCompany(contactId, companyId) {
  try {
    await hsRequest(
      `/crm/v3/objects/contacts/${contactId}/associations/companies/${companyId}/contact_to_company`,
      'PUT'
    );
  } catch { /* association may already exist */ }
}

async function createNote(contactId, companyId, noteBody) {
  const note = await hsRequest('/crm/v3/objects/notes', 'POST', {
    properties: {
      hs_timestamp: new Date().toISOString(),
      hs_note_body: noteBody,
    },
  });
  const noteId = note.id;
  await Promise.all(
    [
      contactId && hsRequest(
        `/crm/v3/objects/notes/${noteId}/associations/contacts/${contactId}/note_to_contact`, 'PUT'
      ),
      companyId && hsRequest(
        `/crm/v3/objects/notes/${noteId}/associations/companies/${companyId}/note_to_company`, 'PUT'
      ),
    ].filter(Boolean)
  );
  return noteId;
}

// ─── HubSpot Forms submission ────────────────────────────────────────────────

async function submitToForm(contact, plainSummary, hutk, ipAddress) {
  if (!PORTAL_ID || !FORM_GUID) return;
  const context = {
    pageUri:  'redis-sizing.acemq.com',
    pageName: 'AceMQ Redis Enterprise Sizing Tool',
  };
  if (hutk) context.hutk = hutk;
  if (ipAddress) context.ipAddress = ipAddress;

  const res = await fetch(
    `https://api.hsforms.com/submissions/v3/integration/submit/${PORTAL_ID}/${FORM_GUID}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: [
          { name: 'firstname', value: contact.first   || '' },
          { name: 'lastname',  value: contact.last    || '' },
          { name: 'email',     value: contact.email   || '' },
          { name: 'company',   value: contact.company || '' },
          { name: 'jobtitle',  value: contact.role    || '' },
          { name: 'phone',     value: contact.phone   || '' },
          { name: 'message',   value: plainSummary },
        ],
        context,
      }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('HubSpot form submission failed:', err);
  }
}

// ─── PDF report (pdf-lib, standard Helvetica fonts, no file deps) ────────────

async function buildReportPdf(contact, prodRows, nonprodRows, prodPersistence, nonprodPersistence, notes) {
  const doc = await PDFDocument.create();

  // Embed standard fonts
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);

  // Colours
  const BLACK   = rgb(0,    0,    0);
  const ORANGE  = rgb(1,    0.4,  0);
  const DARK    = rgb(0.1,  0.1,  0.1);
  const MID     = rgb(0.33, 0.33, 0.33);
  const LIGHT   = rgb(0.6,  0.6,  0.6);
  const WHITE   = rgb(1,    1,    1);
  const ROWALT  = rgb(0.98, 0.98, 0.98);
  const TOTALBG = rgb(1,    0.97, 0.94);

  // Page constants
  const W = 595, H = 842;         // A4 pt
  const ML = 56, MR = 56;
  const BODY_W = W - ML - MR;

  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const name = [contact.first, contact.last].filter(Boolean).join(' ');
  const company = contact.company || '—';
  const filledProd    = prodRows.filter(r => r.memory || r.name);
  const filledNonprod = nonprodRows.filter(r => r.memory || r.name);

  // ── cursor helper ──
  // We accumulate pages; `y` is the current write position from top.
  let page = doc.addPage([W, H]);
  let y = H - 56;                  // top margin

  function ensureSpace(needed) {
    if (y - needed < 50) {
      page = doc.addPage([W, H]);
      y = H - 56;
      drawFooter(page);
    }
  }

  function drawFooter(p) {
    const fy = 36;
    p.drawLine({ start:{x:ML,y:fy+12}, end:{x:W-MR,y:fy+12}, thickness:0.5, color:LIGHT, opacity:0.5 });
    p.drawText('AceMQ · an ace8 company', { x:ML, y:fy, font:regular, size:7, color:LIGHT });
    const right = `Redis Enterprise Sizing Report · ${date}`;
    const rw = regular.widthOfTextAtSize(right, 7);
    p.drawText(right, { x:W-MR-rw, y:fy, font:regular, size:7, color:LIGHT });
  }

  // Kick off first-page footer
  drawFooter(page);

  // ── COVER HEADER ──
  // Orange rule
  page.drawRectangle({ x:ML, y:y-2, width:BODY_W, height:2, color:ORANGE });
  y -= 16;

  // "SIZING REFERENCE" label
  page.drawText('SIZING REFERENCE', { x:ML, y, font:bold, size:7.5, color:ORANGE, characterSpacing:1.8 });
  y -= 14;

  // Title
  page.drawText('Redis Enterprise Sizing Report', { x:ML, y, font:bold, size:22, color:BLACK });
  y -= 28;

  // Subtitle
  page.drawText(`${company}  ·  Prepared by AceMQ  ·  ${date}`, { x:ML, y, font:regular, size:10, color:LIGHT });
  y -= 20;

  // Orange breadcrumb banner
  page.drawRectangle({ x:ML, y:y-18, width:BODY_W, height:18, color:ORANGE });
  page.drawText('SUBMITTED REPORT', { x:ML+10, y:y-13, font:bold, size:7.5, color:WHITE, characterSpacing:0.6 });
  y -= 30;

  // ── SUBMISSION DETAILS TABLE ──
  y -= 6;
  page.drawText('Submission Details', { x:ML, y, font:bold, size:13, color:BLACK });
  y -= 12;

  const detailRows = [
    ['Title',          'Redis Enterprise Sizing Report'],
    ['Prepared By',    'AceMQ — Redis Subject-Matter Engineering'],
    ['Contact',        name],
    ['Company',        company],
    ['Role',           contact.role  || '—'],
    ['Email',          contact.email],
    ['Phone',          contact.phone || '—'],
    ['Date Submitted', date],
    ['Classification', 'Confidential — Prepared by AceMQ'],
  ];

  const COL1 = BODY_W * 0.3;
  const ROW_H = 16;

  // Header row
  page.drawRectangle({ x:ML, y:y-ROW_H, width:BODY_W, height:ROW_H, color:DARK });
  page.drawText('Document', { x:ML+6, y:y-ROW_H+5, font:bold, size:8, color:WHITE });
  page.drawText('Detail',   { x:ML+COL1+6, y:y-ROW_H+5, font:bold, size:8, color:WHITE });
  y -= ROW_H;

  detailRows.forEach(([l, v], i) => {
    ensureSpace(ROW_H + 2);
    if (i % 2 === 1) page.drawRectangle({ x:ML, y:y-ROW_H, width:BODY_W, height:ROW_H, color:ROWALT });
    page.drawLine({ start:{x:ML,y:y-ROW_H}, end:{x:ML+BODY_W,y:y-ROW_H}, thickness:0.4, color:rgb(0.91,0.91,0.91) });
    page.drawText(l, { x:ML+6, y:y-ROW_H+5, font:regular, size:8, color:LIGHT });
    const vFont = l === 'Company' ? bold : regular;
    page.drawText(v, { x:ML+COL1+6, y:y-ROW_H+5, font:vFont, size:8, color:DARK,
      maxWidth: BODY_W - COL1 - 12 });
    y -= ROW_H;
  });
  y -= 12;

  // ── DB TABLE HELPER ──
  function drawDbTable(rows, haLabel) {
    if (!rows.length) {
      ensureSpace(18);
      page.drawText('No databases entered for this environment.', { x:ML, y, font:regular, size:8.5, color:LIGHT });
      y -= 16;
      return;
    }
    const COLS = [BODY_W*0.24, BODY_W*0.20, BODY_W*0.16, BODY_W*0.20, BODY_W*0.20];
    const HEADS = ['Database Name', 'Region / DC', 'Peak Mem (GB)', 'Throughput', haLabel];
    const RH = 15;

    // Header
    ensureSpace(RH + 2);
    let xo = ML;
    page.drawRectangle({ x:ML, y:y-RH, width:BODY_W, height:RH, color:DARK });
    HEADS.forEach((h, ci) => {
      page.drawText(h, { x:xo+4, y:y-RH+5, font:bold, size:7.5, color:WHITE, maxWidth:COLS[ci]-8 });
      xo += COLS[ci];
    });
    y -= RH;

    let total = 0;
    rows.forEach((r, i) => {
      ensureSpace(RH + 2);
      if (i % 2 === 1) page.drawRectangle({ x:ML, y:y-RH, width:BODY_W, height:RH, color:ROWALT });
      page.drawLine({ start:{x:ML,y:y-RH}, end:{x:ML+BODY_W,y:y-RH}, thickness:0.4, color:rgb(0.91,0.91,0.91) });
      const cells = [r.name||'—', r.region||'—', r.memory||'—', r.throughput||'—', r.ha||'—'];
      xo = ML;
      cells.forEach((c, ci) => {
        const f = ci === 2 ? bold : regular;
        page.drawText(c, { x:xo+4, y:y-RH+5, font:f, size:8, color:DARK, maxWidth:COLS[ci]-8 });
        xo += COLS[ci];
      });
      total += parseFloat(r.memory) || 0;
      y -= RH;
    });

    // Total row
    ensureSpace(RH);
    page.drawRectangle({ x:ML, y:y-RH, width:BODY_W, height:RH, color:TOTALBG });
    page.drawText('Total Peak Memory', { x:ML+6, y:y-RH+5, font:bold, size:8, color:ORANGE });
    page.drawText(`${total} GB`, { x:ML+COLS[0]+COLS[1]+6, y:y-RH+5, font:bold, size:8, color:ORANGE });
    y -= RH + 6;
  }

  // ── PERSISTENCE TABLE HELPER ──
  function drawPersistTable() {
    const allPersist = [
      ...Object.entries(prodPersistence||{}).filter(([,v])=>v).map(([k,v])=>({group:'Production',env:k,type:v})),
      ...Object.entries(nonprodPersistence||{}).filter(([,v])=>v).map(([k,v])=>({group:'Non-Production',env:k,type:v})),
    ];
    if (!allPersist.length) {
      ensureSpace(16);
      page.drawText('No persistence requirements specified.', { x:ML, y, font:regular, size:8.5, color:LIGHT });
      y -= 16;
      return;
    }
    const COLS = [BODY_W*0.25, BODY_W*0.35, BODY_W*0.40];
    const HEADS = ['Group', 'Environment', 'Persistence Type'];
    const RH = 15;

    ensureSpace(RH + 2);
    let xo = ML;
    page.drawRectangle({ x:ML, y:y-RH, width:BODY_W, height:RH, color:DARK });
    HEADS.forEach((h, ci) => {
      page.drawText(h, { x:xo+4, y:y-RH+5, font:bold, size:7.5, color:WHITE, maxWidth:COLS[ci]-8 });
      xo += COLS[ci];
    });
    y -= RH;

    allPersist.forEach((e, i) => {
      ensureSpace(RH + 2);
      if (i % 2 === 1) page.drawRectangle({ x:ML, y:y-RH, width:BODY_W, height:RH, color:ROWALT });
      page.drawLine({ start:{x:ML,y:y-RH}, end:{x:ML+BODY_W,y:y-RH}, thickness:0.4, color:rgb(0.91,0.91,0.91) });
      xo = ML;
      [e.group, e.env, e.type].forEach((c, ci) => {
        page.drawText(c, { x:xo+4, y:y-RH+5, font:regular, size:8, color: ci===0 ? MID : DARK, maxWidth:COLS[ci]-8 });
        xo += COLS[ci];
      });
      y -= RH;
    });
    y -= 6;
  }

  // ── SECTION BANNER HELPER ──
  function drawSectionBanner(num, title) {
    ensureSpace(32);
    y -= 8;
    page.drawRectangle({ x:ML, y:y-18, width:BODY_W, height:18, color:ORANGE });
    page.drawText(`${num}.  ${title}`, { x:ML+10, y:y-13, font:bold, size:8, color:WHITE, characterSpacing:0.8 });
    y -= 28;
  }

  // ── SECTION HEADING HELPER ──
  function drawSectionHead(text) {
    ensureSpace(22);
    page.drawText(text, { x:ML, y, font:bold, size:12, color:BLACK });
    y -= 16;
  }

  // ── SECTIONS ──

  // 1. Production
  drawSectionBanner('1', 'PRODUCTION DATABASES');
  drawSectionHead('1. Production Environments (Prod · DR · Staging)');
  drawDbTable(filledProd, 'HA — Cross Region');

  // 2. Non-production
  drawSectionBanner('2', 'NON-PRODUCTION DATABASES');
  drawSectionHead('2. Non-Production Environments (Dev · Test · QA)');
  drawDbTable(filledNonprod, 'High Availability');

  // 3. Persistence
  drawSectionBanner('3', 'DATA PERSISTENCE REQUIREMENTS');
  drawSectionHead('3. Data Persistence');
  drawPersistTable();

  // 4. Notes
  if (notes) {
    drawSectionBanner('4', 'ADDITIONAL NOTES');
    ensureSpace(40);
    page.drawRectangle({ x:ML, y:y-3, width:3, height:-(Math.min(notes.length / 60 + 1, 10) * 12 + 16), color:ORANGE });
    page.drawText(notes, { x:ML+10, y:y-3, font:regular, size:8.5, color:DARK,
      maxWidth: BODY_W - 14, lineHeight: 13 });
  }

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}

// ─── Branded report HTML (email-safe inline styles) ─────────────────────────

function buildReportHtml(contact, prodRows, nonprodRows, prodPersistence, nonprodPersistence, notes) {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const name = [contact.first, contact.last].filter(Boolean).join(' ');
  const company = contact.company || '—';
  const LOGO = 'https://redis-sizing.acemq.com/redesign/logo.png';

  const filledProd = prodRows.filter((r) => r.memory || r.name);
  const filledNonprod = nonprodRows.filter((r) => r.memory || r.name);

  const banner = (num, title) => `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
      <tr><td style="background:#FF6600;padding:9px 14px;">
        <p style="margin:0;font-size:11px;color:#fff;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;font-family:'Helvetica Neue',Arial,sans-serif;">${num}.&nbsp;&nbsp;${title}</p>
      </td></tr>
    </table>`;

  const dbTable = (rows, haLabel) => {
    if (!rows.length) return '<p style="font-size:12px;color:#999;margin:8px 0 16px;font-family:\'Helvetica Neue\',Arial,sans-serif;">No databases entered.</p>';
    const total = rows.reduce((s, r) => s + (parseFloat(r.memory) || 0), 0);
    return `
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;margin-bottom:4px;">
        <thead><tr>
          <th style="background:#1a1a1a;color:#fff;text-align:left;padding:8px 10px;font-size:11px;font-weight:600;font-family:'Helvetica Neue',Arial,sans-serif;">Database Name</th>
          <th style="background:#1a1a1a;color:#fff;text-align:left;padding:8px 10px;font-size:11px;font-weight:600;font-family:'Helvetica Neue',Arial,sans-serif;">Region / DC</th>
          <th style="background:#1a1a1a;color:#fff;text-align:left;padding:8px 10px;font-size:11px;font-weight:600;font-family:'Helvetica Neue',Arial,sans-serif;">Peak Mem (GB)</th>
          <th style="background:#1a1a1a;color:#fff;text-align:left;padding:8px 10px;font-size:11px;font-weight:600;font-family:'Helvetica Neue',Arial,sans-serif;">Throughput</th>
          <th style="background:#1a1a1a;color:#fff;text-align:left;padding:8px 10px;font-size:11px;font-weight:600;font-family:'Helvetica Neue',Arial,sans-serif;">${haLabel}</th>
        </tr></thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr style="background:${i % 2 === 0 ? '#fff' : '#f9f9f9'};">
              <td style="padding:7px 10px;border-bottom:1px solid #ebebeb;color:#1a1a1a;font-family:'Helvetica Neue',Arial,sans-serif;">${r.name || '—'}</td>
              <td style="padding:7px 10px;border-bottom:1px solid #ebebeb;color:#1a1a1a;font-family:'Helvetica Neue',Arial,sans-serif;">${r.region || '—'}</td>
              <td style="padding:7px 10px;border-bottom:1px solid #ebebeb;color:#1a1a1a;font-weight:600;font-family:'Helvetica Neue',Arial,sans-serif;">${r.memory || '—'}</td>
              <td style="padding:7px 10px;border-bottom:1px solid #ebebeb;color:#1a1a1a;font-family:'Helvetica Neue',Arial,sans-serif;">${r.throughput || '—'}</td>
              <td style="padding:7px 10px;border-bottom:1px solid #ebebeb;color:#1a1a1a;font-family:'Helvetica Neue',Arial,sans-serif;">${r.ha || '—'}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr style="background:#fff8f0;">
          <td colspan="2" style="padding:7px 10px;font-size:11px;color:#FF6600;font-weight:600;font-family:'Helvetica Neue',Arial,sans-serif;">Total Peak Memory</td>
          <td style="padding:7px 10px;font-size:12px;color:#FF6600;font-weight:700;font-family:'Helvetica Neue',Arial,sans-serif;">${total} GB</td>
          <td colspan="2"></td>
        </tr></tfoot>
      </table>`;
  };

  const allPersist = [
    ...Object.entries(prodPersistence || {}).filter(([, v]) => v).map(([k, v]) => ({ group: 'Production', env: k, type: v })),
    ...Object.entries(nonprodPersistence || {}).filter(([, v]) => v).map(([k, v]) => ({ group: 'Non-Production', env: k, type: v })),
  ];

  const persistTable = allPersist.length > 0 ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;margin-bottom:4px;">
      <thead><tr>
        <th width="28%" style="background:#1a1a1a;color:#fff;text-align:left;padding:8px 10px;font-size:11px;font-weight:600;font-family:'Helvetica Neue',Arial,sans-serif;">Group</th>
        <th width="35%" style="background:#1a1a1a;color:#fff;text-align:left;padding:8px 10px;font-size:11px;font-weight:600;font-family:'Helvetica Neue',Arial,sans-serif;">Environment</th>
        <th style="background:#1a1a1a;color:#fff;text-align:left;padding:8px 10px;font-size:11px;font-weight:600;font-family:'Helvetica Neue',Arial,sans-serif;">Persistence Type</th>
      </tr></thead>
      <tbody>
        ${allPersist.map((e, i) => `
          <tr style="background:${i % 2 === 0 ? '#fff' : '#f9f9f9'};">
            <td style="padding:7px 10px;border-bottom:1px solid #ebebeb;color:#555;font-family:'Helvetica Neue',Arial,sans-serif;">${e.group}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #ebebeb;color:#1a1a1a;font-family:'Helvetica Neue',Arial,sans-serif;">${e.env}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #ebebeb;color:#1a1a1a;font-family:'Helvetica Neue',Arial,sans-serif;">${e.type}</td>
          </tr>`).join('')}
      </tbody>
    </table>` :
    '<p style="font-size:12px;color:#999;margin:8px 0 16px;font-family:\'Helvetica Neue\',Arial,sans-serif;">No persistence requirements specified.</p>';

  const detailRow = (label, value, bg, bold = false) =>
    `<tr style="background:${bg};"><td style="padding:8px 12px;border-bottom:1px solid #ebebeb;color:#555555;font-family:'Helvetica Neue',Arial,sans-serif;">${label}</td><td style="padding:8px 12px;border-bottom:1px solid #ebebeb;color:#1a1a1a;${bold ? 'font-weight:600;' : ''}font-family:'Helvetica Neue',Arial,sans-serif;">${value}</td></tr>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f0f0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f0;padding:24px 0;">
<tr><td align="center">
<table width="700" cellpadding="0" cellspacing="0" style="background:#ffffff;max-width:700px;width:100%;">
<tr><td style="padding:48px 56px 56px;">

<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
  <tr><td></td><td align="right" style="width:90px;"><img src="${LOGO}" height="20" alt="AceMQ" style="display:block;"></td></tr>
</table>

<img src="${LOGO}" height="40" alt="AceMQ" style="display:block;height:40px;margin-bottom:20px;">

<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
  <tr><td style="background:#FF6600;height:2px;font-size:0;line-height:0;">&nbsp;</td></tr>
</table>

<p style="color:#FF6600;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 6px;font-family:'Helvetica Neue',Arial,sans-serif;">SIZING REFERENCE</p>
<h1 style="font-size:26px;font-weight:700;color:#000000;line-height:1.25;margin:0 0 6px;font-family:'Helvetica Neue',Arial,sans-serif;">Redis Enterprise Sizing Report</h1>
<p style="font-size:13px;color:#666666;margin:0 0 24px;font-family:'Helvetica Neue',Arial,sans-serif;">${company} &middot; Prepared by AceMQ &middot; ${date}</p>

<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
  <tr><td style="background:#FF6600;padding:10px 14px;">
    <p style="margin:0;font-size:11px;letter-spacing:1px;text-transform:uppercase;font-family:'Helvetica Neue',Arial,sans-serif;">
      <span style="color:rgba(255,255,255,0.6);">REDIS ENTERPRISE SIZING &nbsp;&middot;&nbsp; </span><strong style="color:#ffffff;">SUBMITTED REPORT</strong><span style="color:rgba(255,255,255,0.6);"> &nbsp;&middot;&nbsp; Contact &middot; Production &middot; Non-Production &middot; Persistence</span>
    </p>
  </td></tr>
</table>

<h2 style="font-size:15px;font-weight:700;color:#000000;margin:0 0 10px;font-family:'Helvetica Neue',Arial,sans-serif;">Submission Details</h2>
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;margin-bottom:28px;">
  <thead><tr>
    <th width="35%" style="background:#1a1a1a;color:#fff;text-align:left;padding:9px 12px;font-size:12px;font-weight:600;font-family:'Helvetica Neue',Arial,sans-serif;">Document</th>
    <th style="background:#1a1a1a;color:#fff;text-align:left;padding:9px 12px;font-size:12px;font-weight:600;font-family:'Helvetica Neue',Arial,sans-serif;">Detail</th>
  </tr></thead>
  <tbody>
    ${detailRow('Title', 'Redis Enterprise Sizing Report', '#fff')}
    ${detailRow('Prepared By', 'AceMQ — Redis Subject-Matter Engineering', '#fafafa')}
    ${detailRow('Contact', name, '#fff')}
    ${detailRow('Company', company, '#fafafa', true)}
    ${detailRow('Role', contact.role || '—', '#fff')}
    ${detailRow('Email', contact.email, '#fafafa')}
    ${detailRow('Phone', contact.phone || '—', '#fff')}
    ${detailRow('Date Submitted', date, '#fafafa')}
    ${detailRow('Classification', 'Confidential — Prepared by AceMQ', '#fff')}
  </tbody>
</table>

${banner('1', 'PRODUCTION DATABASES')}
<h2 style="font-size:14px;font-weight:700;color:#000;margin:14px 0 6px;font-family:'Helvetica Neue',Arial,sans-serif;">1. Production Environments (Prod &middot; DR &middot; Staging)</h2>
${dbTable(filledProd, 'HA — Cross Region')}

${banner('2', 'NON-PRODUCTION DATABASES')}
<h2 style="font-size:14px;font-weight:700;color:#000;margin:14px 0 6px;font-family:'Helvetica Neue',Arial,sans-serif;">2. Non-Production Environments (Dev &middot; Test &middot; QA)</h2>
${dbTable(filledNonprod, 'High Availability')}

${banner('3', 'DATA PERSISTENCE REQUIREMENTS')}
<h2 style="font-size:14px;font-weight:700;color:#000;margin:14px 0 6px;font-family:'Helvetica Neue',Arial,sans-serif;">3. Data Persistence</h2>
${persistTable}

${notes ? `${banner('4', 'ADDITIONAL NOTES')}
<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;margin-bottom:4px;">
  <tr><td style="background:#f9f9f9;border-left:3px solid #FF6600;padding:14px 16px;">
    <p style="font-size:13px;color:#333333;line-height:1.65;margin:0;font-family:'Helvetica Neue',Arial,sans-serif;">${notes.replace(/\n/g, '<br>')}</p>
  </td></tr>
</table>` : ''}

<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:48px;">
  <tr>
    <td style="border-top:1px solid #cccccc;padding-top:14px;font-size:11px;color:#999999;font-family:'Helvetica Neue',Arial,sans-serif;">AceMQ &middot; an ace8 company</td>
    <td align="right" style="border-top:1px solid #cccccc;padding-top:14px;font-size:11px;color:#999999;font-family:'Helvetica Neue',Arial,sans-serif;">Redis Enterprise Sizing Report &middot; ${date}</td>
  </tr>
</table>

</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ─── Mailjet email notification ──────────────────────────────────────────────

async function sendEmailNotification(contact, reportHtml, pdfBuffer) {
  if (!MJ_KEY || !MJ_SECRET) {
    console.error('Mailjet keys missing');
    return;
  }

  const safeName = (contact.company || contact.email || 'Submission').replace(/[^a-z0-9]/gi, '_');
  const dateStr = new Date().toISOString().slice(0, 10);

  const message = {
    From: { Email: 'submissions@acemq.com', Name: 'AceMQ Sizing Tool' },
    To: [{ Email: 'sales@acemq.com', Name: 'AceMQ Sales' }],
    Subject: `Redis Enterprise Sizing Report — ${contact.company || contact.email}`,
    HTMLPart: reportHtml,
    ...(pdfBuffer ? {
      Attachments: [{
        ContentType: 'application/pdf',
        Filename: `AceMQ_Redis_Sizing_${safeName}_${dateStr}.pdf`,
        Base64Content: pdfBuffer.toString('base64'),
      }],
    } : {}),
  };

  const auth = Buffer.from(`${MJ_KEY}:${MJ_SECRET}`).toString('base64');
  const res = await fetch('https://api.mailjet.com/v3.1/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({ Messages: [message] }),
  });

  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Mailjet send failed:', JSON.stringify(result));
  } else {
    console.log('Mailjet send success:', result?.Messages?.[0]?.Status);
  }
}

// ─── Note / summary builders ─────────────────────────────────────────────────

function dbTableHtml(rows, title, haLabel) {
  if (!rows?.length) return '';
  return `
    <h3>${title}</h3>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:13px;">
      <thead style="background:#fff3e8;">
        <tr>
          <th style="text-align:left;">Database Name</th>
          <th style="text-align:left;">Region / Datacenter</th>
          <th style="text-align:left;">Peak Memory (GB)</th>
          <th style="text-align:left;">Throughput (ops/sec)</th>
          <th style="text-align:left;">${haLabel}</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => `
          <tr>
            <td>${r.name || '—'}</td>
            <td>${r.region || '—'}</td>
            <td><strong>${r.memory || '—'}</strong></td>
            <td>${r.throughput || '—'}</td>
            <td>${r.ha || '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function persistenceHtml(persistence, title) {
  const entries = Object.entries(persistence || {}).filter(([, v]) => v);
  if (!entries.length) return '';
  return `
    <h3>${title}</h3>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
      <thead style="background:#fff3e8;">
        <tr>
          <th style="text-align:left;">Environment</th>
          <th style="text-align:left;">Persistence Type</th>
        </tr>
      </thead>
      <tbody>
        ${entries.map(([env, val]) => `
          <tr>
            <td>${env}</td>
            <td>${val}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function buildNoteBody(contact, prodRows, nonprodRows, prodPersistence, nonprodPersistence, notes) {
  const submitted = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const totalProdMem = prodRows.reduce((s, r) => s + (parseFloat(r.memory) || 0), 0);
  const totalNonprodMem = nonprodRows.reduce((s, r) => s + (parseFloat(r.memory) || 0), 0);

  return [
    '<h2>Redis Enterprise Sizing Request</h2>',
    `<p><strong>Submitted:</strong> ${submitted}</p>`,
    '<hr>',
    '<h3>Contact Information</h3>',
    `<p><strong>Name:</strong> ${[contact.first, contact.last].filter(Boolean).join(' ')}</p>`,
    `<p><strong>Company:</strong> ${contact.company || '—'}</p>`,
    `<p><strong>Role:</strong> ${contact.role || '—'}</p>`,
    `<p><strong>Email:</strong> ${contact.email || '—'}</p>`,
    `<p><strong>Phone:</strong> ${contact.phone || '—'}</p>`,
    '<hr>',
    '<h3>Sizing Summary</h3>',
    `<p><strong>Production databases:</strong> ${prodRows.length} (${totalProdMem} GB total peak memory)</p>`,
    `<p><strong>Non-production databases:</strong> ${nonprodRows.length} (${totalNonprodMem} GB total peak memory)</p>`,
    '<hr>',
    dbTableHtml(prodRows, 'Production Databases', 'HA — Cross Region'),
    dbTableHtml(nonprodRows, 'Non-Production Databases', 'High Availability'),
    persistenceHtml(prodPersistence, 'Data Persistence — Prod, DR & Staging'),
    persistenceHtml(nonprodPersistence, 'Data Persistence — Dev, Test & QA'),
    notes ? `<hr><h3>Additional Notes</h3><p>${notes.replace(/\n/g, '<br>')}</p>` : '',
    '<hr>',
    '<p><em>Submitted via AceMQ Redis Enterprise Sizing Tool</em></p>',
  ].join('\n');
}

function buildPlainSummary(contact, prodRows, nonprodRows, prodPersistence, nonprodPersistence, notes) {
  const lines = [
    `Contact: ${[contact.first, contact.last].filter(Boolean).join(' ')} — ${contact.company}`,
    `Email: ${contact.email}`,
    '',
    `Production databases: ${prodRows.length}`,
    ...prodRows.map((r) => `  ${r.name || '(unnamed)'} | ${r.region || '—'} | ${r.memory || '—'} GB | throughput: ${r.throughput || '—'} | HA: ${r.ha || '—'}`),
    '',
    `Non-production databases: ${nonprodRows.length}`,
    ...nonprodRows.map((r) => `  ${r.name || '(unnamed)'} | ${r.region || '—'} | ${r.memory || '—'} GB | throughput: ${r.throughput || '—'} | HA: ${r.ha || '—'}`),
  ];

  const pp = Object.entries(prodPersistence || {}).filter(([, v]) => v);
  if (pp.length) {
    lines.push('', 'Prod persistence:');
    pp.forEach(([k, v]) => lines.push(`  ${k}: ${v}`));
  }

  const np = Object.entries(nonprodPersistence || {}).filter(([, v]) => v);
  if (np.length) {
    lines.push('', 'Non-prod persistence:');
    np.forEach(([k, v]) => lines.push(`  ${k}: ${v}`));
  }

  if (notes) lines.push('', `Notes: ${notes}`);

  return lines.join('\n');
}

// ─── Route handler ───────────────────────────────────────────────────────────

export async function POST(request) {
  if (!TOKEN) {
    return NextResponse.json({ error: 'Missing HUBSPOT_TOKEN' }, { status: 500 });
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { contact, prodRows = [], nonprodRows = [], prodPersistence = {}, nonprodPersistence = {}, notes = '', hutk } = data;

  const forwarded = request.headers.get('x-forwarded-for');
  const ipAddress = forwarded
    ? forwarded.split(',')[0].trim()
    : (request.headers.get('x-real-ip') || null);

  try {
    // 1. CRM: create/update contact
    const contactId = await upsertContact(contact);

    // 2. CRM: create/find company
    let companyId = null;
    if (contact.company?.trim()) {
      companyId = await upsertCompany(contact.company.trim());
    }

    // 3. CRM: associate contact → company
    if (contactId && companyId) {
      await associateContactToCompany(contactId, companyId);
    }

    // 4. CRM: create note with full sizing data
    const noteBody = buildNoteBody(contact, prodRows, nonprodRows, prodPersistence, nonprodPersistence, notes);
    await createNote(contactId, companyId, noteBody);

    // 5. Forms API + Email (with PDF attachment) — run in parallel
    const plainSummary = buildPlainSummary(contact, prodRows, nonprodRows, prodPersistence, nonprodPersistence, notes);
    const reportHtml   = buildReportHtml(contact, prodRows, nonprodRows, prodPersistence, nonprodPersistence, notes);
    const pdfBuffer    = await buildReportPdf(contact, prodRows, nonprodRows, prodPersistence, nonprodPersistence, notes)
      .catch((err) => { console.error('PDF build failed:', err.message); return null; });
    await Promise.allSettled([
      submitToForm(contact, plainSummary, hutk, ipAddress),
      sendEmailNotification(contact, reportHtml, pdfBuffer),
    ]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Submission error:', err.message);
    return NextResponse.json({ error: 'Failed to submit', detail: err.message }, { status: 500 });
  }
}
