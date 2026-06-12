import { NextResponse } from 'next/server';

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

// ─── Mailjet email notification ──────────────────────────────────────────────

async function sendEmailNotification(contact, htmlBody) {
  if (!MJ_KEY || !MJ_SECRET) {
    console.error('Mailjet keys missing');
    return;
  }

  const message = {
    From: { Email: 'questionaire@acemq.com', Name: 'AceMQ Sizing Tool' },
    To: [{ Email: 'submissions@acemq.com', Name: 'AceMQ Submissions' }],
    Subject: `Redis Enterprise Sizing Request — ${contact.company || contact.email}`,
    HTMLPart: htmlBody,
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

    // 5. Forms API + Email — run in parallel
    const plainSummary = buildPlainSummary(contact, prodRows, nonprodRows, prodPersistence, nonprodPersistence, notes);
    await Promise.allSettled([
      submitToForm(contact, plainSummary, hutk, ipAddress),
      sendEmailNotification(contact, noteBody),
    ]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Submission error:', err.message);
    return NextResponse.json({ error: 'Failed to submit', detail: err.message }, { status: 500 });
  }
}
