'use client';

import { useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const PERSISTENCE_OPTIONS = [
  'None — no persistence required',
  'RDB — periodic snapshots',
  'AOF — every second',
  'AOF — every write (fsync always)',
  'Not sure — need guidance',
];

const PROD_ENVIRONMENTS = ['Production (Prod)', 'Disaster Recovery (DR)', 'Staging (Stg)'];
const NONPROD_ENVIRONMENTS = ['Development (Dev)', 'Test', 'QA'];

const mkRow = () => ({ name: '', region: '', memory: '', throughput: '', ha: '' });

// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVE COMPONENTS — matching acemq.com design language
// ─────────────────────────────────────────────────────────────────────────────

function BtnOrange({ onClick, disabled, children, className = '' }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`bg-[#FF6600] text-white border-none rounded-[3rem] px-[4rem] py-[1.2rem] text-[1.7rem] font-[400] cursor-pointer hover:opacity-90 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all inline-flex items-center gap-[0.8rem] ${className}`}
    >
      {children}
    </button>
  );
}

function BtnGhost({ onClick, children, className = '' }) {
  return (
    <button
      onClick={onClick}
      className={`bg-white text-black border border-black rounded-[3rem] px-[3.5rem] py-[1.2rem] text-[1.7rem] font-[400] cursor-pointer hover:bg-[#f5f5f5] active:scale-[0.98] transition-all`}
    >
      {children}
    </button>
  );
}

function SectionLabel({ children }) {
  return (
    <p className="text-[#FF6600] text-[1.2rem] font-[400] tracking-[0.15em] uppercase mb-[0.8rem]">
      {children}
    </p>
  );
}

function QNum({ current, total }) {
  return <p className="text-[#999999] text-[1.3rem] mb-[1.2rem]">Step {current} of {total}</p>;
}

function QHead({ children }) {
  return (
    <h2 className="text-[#000000] text-[2.8rem] leading-[1.3] font-[700] mb-[0.8rem]">
      {children}
    </h2>
  );
}

function QSub({ children, className = '' }) {
  return (
    <p className={`text-[#999999] text-[1.6rem] leading-[1.65] mb-[2.4rem] ${className}`}>
      {children}
    </p>
  );
}

function TF({ type = 'text', placeholder, value, onChange }) {
  return (
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      className="w-full bg-white border border-[rgba(0,0,0,0.12)] rounded-[1rem] px-[1.6rem] py-[1.3rem] text-[1.6rem] text-black placeholder:text-[#bbbbbb] outline-none focus:border-[#FF6600] focus:shadow-[0_0_0_3px_rgba(255,102,0,0.08)] transition-all mb-[1rem]"
    />
  );
}

function TA({ placeholder, value, onChange, minHeight = '12rem' }) {
  return (
    <textarea
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      style={{ minHeight }}
      className="w-full bg-white border border-[rgba(0,0,0,0.12)] rounded-[1rem] px-[1.6rem] py-[1.3rem] text-[1.6rem] text-black placeholder:text-[#bbbbbb] outline-none focus:border-[#FF6600] focus:shadow-[0_0_0_3px_rgba(255,102,0,0.08)] transition-all mb-[1rem] resize-y leading-[1.6]"
    />
  );
}

function Choice({ selected, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-[1.4rem] border rounded-[1rem] px-[1.6rem] py-[1.3rem] w-full text-left text-[1.6rem] cursor-pointer transition-all ${
        selected
          ? 'border-[#FF6600] bg-[rgba(255,102,0,0.05)] text-[#000000] font-[400]'
          : 'border-[rgba(0,0,0,0.1)] bg-[#fafafa] text-[#161616] hover:border-[#FF6600] hover:bg-[rgba(255,102,0,0.03)]'
      }`}
    >
      <span
        className={`w-[1.8rem] h-[1.8rem] rounded-full border flex-shrink-0 flex items-center justify-center transition-all ${
          selected ? 'border-[#FF6600] bg-[#FF6600]' : 'border-[rgba(0,0,0,0.2)]'
        }`}
      >
        {selected && <span className="w-[0.6rem] h-[0.6rem] bg-white rounded-full block" />}
      </span>
      {children}
    </button>
  );
}

function BtnRow({ onBack, onNext, nextDisabled, onSkip, nextLabel = 'Continue →' }) {
  return (
    <div className="flex items-center justify-between mt-[3rem] pt-[2.2rem] border-t border-[rgba(0,0,0,0.08)]">
      <BtnGhost onClick={onBack}>{'←'} Back</BtnGhost>
      <div className="flex items-center gap-[1.4rem]">
        {onSkip && (
          <button
            onClick={onSkip}
            className="text-[1.3rem] text-[#999999] underline underline-offset-2 bg-transparent border-none cursor-pointer hover:text-[#666] transition-colors"
          >
            Skip
          </button>
        )}
        <BtnOrange onClick={onNext} disabled={nextDisabled}>
          {nextLabel}
        </BtnOrange>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE TABLE
// ─────────────────────────────────────────────────────────────────────────────

function HAToggle({ value, onChange }) {
  return (
    <div className="flex gap-[0.5rem]">
      {['Yes', 'No'].map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`flex-1 border rounded-[0.6rem] py-[0.65rem] text-[1.2rem] cursor-pointer transition-all whitespace-nowrap ${
            value === opt
              ? 'border-[#FF6600] bg-[rgba(255,102,0,0.06)] text-[#FF6600] font-[400]'
              : 'border-[rgba(0,0,0,0.1)] bg-[#fafafa] text-[#666] hover:border-[#FF6600]'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function CellInput({ value, onChange, placeholder }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-white border border-[rgba(0,0,0,0.1)] rounded-[0.6rem] px-[0.9rem] py-[0.65rem] text-[1.3rem] text-black placeholder:text-[#cccccc] outline-none focus:border-[#FF6600] focus:shadow-[0_0_0_2px_rgba(255,102,0,0.08)] transition-all"
    />
  );
}

function DatabaseTable({ rows, onChange, onAdd, onRemove, haLabel }) {
  return (
    <div>
      {/* Mobile card layout */}
      <div className="sm:hidden flex flex-col gap-[1.4rem]">
        {rows.map((row, i) => (
          <div key={i} className="border border-[rgba(0,0,0,0.1)] rounded-[1rem] p-[1.4rem] bg-[#fafafa]">
            <div className="flex items-center justify-between mb-[1.2rem]">
              <span className="text-[1.2rem] font-[400] text-[#FF6600] uppercase tracking-[0.1em]">
                Database {i + 1}
              </span>
              {rows.length > 1 && (
                <button
                  onClick={() => onRemove(i)}
                  className="text-[1.2rem] text-[#999] hover:text-red-500 bg-transparent border-none cursor-pointer transition-colors"
                >
                  Remove
                </button>
              )}
            </div>
            <div className="flex flex-col gap-[0.8rem]">
              <div>
                <label className="text-[1.1rem] text-[#666] mb-[0.3rem] block">Database Name</label>
                <CellInput value={row.name} onChange={(v) => onChange(i, 'name', v)} placeholder="e.g. session-cache" />
              </div>
              <div>
                <label className="text-[1.1rem] text-[#666] mb-[0.3rem] block">Region / Datacenter</label>
                <CellInput value={row.region} onChange={(v) => onChange(i, 'region', v)} placeholder="e.g. us-east-1" />
              </div>
              <div>
                <label className="text-[1.1rem] text-[#666] mb-[0.3rem] block">
                  Peak Memory (GB) <span className="text-[#FF6600]">*</span>
                </label>
                <CellInput value={row.memory} onChange={(v) => onChange(i, 'memory', v)} placeholder="e.g. 64" />
              </div>
              <div>
                <label className="text-[1.1rem] text-[#666] mb-[0.3rem] block">Throughput (ops/sec) — optional</label>
                <CellInput value={row.throughput} onChange={(v) => onChange(i, 'throughput', v)} placeholder="e.g. 100,000" />
              </div>
              <div>
                <label className="text-[1.1rem] text-[#666] mb-[0.5rem] block">{haLabel}</label>
                <HAToggle value={row.ha} onChange={(v) => onChange(i, 'ha', v)} />
              </div>
            </div>
          </div>
        ))}
        <button
          onClick={onAdd}
          className="border-2 border-dashed border-[rgba(0,0,0,0.15)] rounded-[1rem] py-[1.2rem] text-[1.4rem] text-[#999] hover:border-[#FF6600] hover:text-[#FF6600] transition-all cursor-pointer bg-transparent w-full"
        >
          + Add Database
        </button>
      </div>

      {/* Desktop table layout */}
      <div className="hidden sm:block overflow-x-auto -mx-[2.4rem] px-[2.4rem]">
        <table className="w-full min-w-[58rem] border-collapse">
          <thead>
            <tr>
              <th className="text-left text-[1.1rem] font-[400] uppercase tracking-[0.08em] text-[#FF6600] bg-[rgba(255,102,0,0.05)] px-[1rem] py-[0.9rem] border-b border-[rgba(0,0,0,0.08)] w-[22%]">
                Database Name
              </th>
              <th className="text-left text-[1.1rem] font-[400] uppercase tracking-[0.08em] text-[#FF6600] bg-[rgba(255,102,0,0.05)] px-[1rem] py-[0.9rem] border-b border-[rgba(0,0,0,0.08)] w-[22%]">
                Region / Datacenter
              </th>
              <th className="text-left text-[1.1rem] font-[400] uppercase tracking-[0.08em] text-[#FF6600] bg-[rgba(255,102,0,0.05)] px-[1rem] py-[0.9rem] border-b border-[rgba(0,0,0,0.08)] w-[16%]">
                Peak Memory (GB){' '}
                <span className="text-[#FF6600] normal-case tracking-normal">*</span>
              </th>
              <th className="text-left text-[1.1rem] font-[400] uppercase tracking-[0.08em] text-[#FF6600] bg-[rgba(255,102,0,0.05)] px-[1rem] py-[0.9rem] border-b border-[rgba(0,0,0,0.08)] w-[18%]">
                Throughput (ops/sec)
              </th>
              <th className="text-left text-[1.1rem] font-[400] uppercase tracking-[0.08em] text-[#FF6600] bg-[rgba(255,102,0,0.05)] px-[1rem] py-[0.9rem] border-b border-[rgba(0,0,0,0.08)] w-[16%]">
                {haLabel}
              </th>
              <th className="bg-[rgba(255,102,0,0.05)] border-b border-[rgba(0,0,0,0.08)] w-[6%]" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-[rgba(0,0,0,0.05)] hover:bg-[rgba(0,0,0,0.01)] transition-colors">
                <td className="px-[1rem] py-[0.8rem]">
                  <CellInput value={row.name} onChange={(v) => onChange(i, 'name', v)} placeholder="e.g. session-cache" />
                </td>
                <td className="px-[1rem] py-[0.8rem]">
                  <CellInput value={row.region} onChange={(v) => onChange(i, 'region', v)} placeholder="e.g. us-east-1" />
                </td>
                <td className="px-[1rem] py-[0.8rem]">
                  <CellInput value={row.memory} onChange={(v) => onChange(i, 'memory', v)} placeholder="e.g. 64" />
                </td>
                <td className="px-[1rem] py-[0.8rem]">
                  <CellInput value={row.throughput} onChange={(v) => onChange(i, 'throughput', v)} placeholder="optional" />
                </td>
                <td className="px-[1rem] py-[0.8rem]">
                  <HAToggle value={row.ha} onChange={(v) => onChange(i, 'ha', v)} />
                </td>
                <td className="px-[1rem] py-[0.8rem] text-center">
                  {rows.length > 1 && (
                    <button
                      onClick={() => onRemove(i)}
                      className="text-[1.4rem] text-[#ccc] hover:text-red-400 bg-transparent border-none cursor-pointer transition-colors leading-none"
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          onClick={onAdd}
          className="mt-[1rem] border-dashed border-2 border-[rgba(0,0,0,0.12)] rounded-[0.8rem] px-[2rem] py-[0.8rem] text-[1.3rem] text-[#999] hover:border-[#FF6600] hover:text-[#FF6600] transition-all cursor-pointer bg-transparent"
        >
          + Add Row
        </button>
      </div>

      <p className="text-[1.2rem] text-[#bbbbbb] mt-[1.4rem]">
        * Peak Memory Limit is required. Throughput is optional but helps us size more accurately for high-volume workloads.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENCE SELECTOR
// ─────────────────────────────────────────────────────────────────────────────

function PersistenceSelector({ environments, selections, onChange }) {
  return (
    <div className="flex flex-col gap-[2.8rem]">
      {environments.map((env) => (
        <div key={env}>
          <p className="text-[1.5rem] font-[400] text-[#000] mb-[1rem] flex items-center gap-[0.8rem]">
            <span className="w-[0.8rem] h-[0.8rem] bg-[#FF6600] rounded-full flex-shrink-0 inline-block" />
            {env}
          </p>
          <div className="flex flex-col gap-[0.7rem]">
            {PERSISTENCE_OPTIONS.map((opt) => (
              <Choice
                key={opt}
                selected={selections[env] === opt}
                onClick={() => onChange(env, opt)}
              >
                {opt}
              </Choice>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REVIEW SUMMARY TABLE
// ─────────────────────────────────────────────────────────────────────────────

function ReviewDbTable({ rows, title }) {
  const filled = rows.filter((r) => r.memory || r.name);
  if (!filled.length) return null;
  return (
    <div className="mb-[2rem]">
      <p className="text-[1.2rem] font-[400] tracking-[0.12em] uppercase text-[#999] mb-[1rem]">{title}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] text-[1.3rem] border-collapse">
          <thead>
            <tr className="bg-[rgba(255,102,0,0.04)]">
              {['Database', 'Region', 'Memory (GB)', 'Throughput', 'HA'].map((h) => (
                <th key={h} className="text-left px-[1rem] py-[0.7rem] text-[#666] font-[400] border-b border-[rgba(0,0,0,0.06)]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filled.map((r, i) => (
              <tr key={i} className="border-b border-[rgba(0,0,0,0.04)]">
                <td className="px-[1rem] py-[0.6rem] text-[#161616]">{r.name || '—'}</td>
                <td className="px-[1rem] py-[0.6rem] text-[#161616]">{r.region || '—'}</td>
                <td className="px-[1rem] py-[0.6rem] text-[#161616] font-[400]">{r.memory || '—'}</td>
                <td className="px-[1rem] py-[0.6rem] text-[#161616]">{r.throughput || '—'}</td>
                <td className="px-[1rem] py-[0.6rem] text-[#161616]">{r.ha || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BRANDED REPORT (shown on done page + matches email style)
// ─────────────────────────────────────────────────────────────────────────────

function ReportSectionBanner({ num, title }) {
  return (
    <div style={{ backgroundColor: '#FF6600', padding: '0.9rem 1.4rem', marginTop: '2.8rem' }}>
      <p style={{ margin: 0, fontSize: '1.1rem', color: '#fff', fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {num}.&nbsp;&nbsp;{title}
      </p>
    </div>
  );
}

function ReportDbTable({ rows, haLabel }) {
  if (!rows.length) {
    return <p style={{ fontSize: '1.3rem', color: '#999', margin: '1rem 0 1.6rem' }}>No databases entered for this environment.</p>;
  }
  const total = rows.reduce((s, r) => s + (parseFloat(r.memory) || 0), 0);
  return (
    <div style={{ overflowX: 'auto', marginBottom: '0.4rem' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '1.3rem', minWidth: '50rem' }}>
        <thead>
          <tr>
            {['Database Name', 'Region / Datacenter', 'Peak Memory (GB)', 'Throughput (ops/sec)', haLabel].map((h) => (
              <th key={h} style={{ background: '#1a1a1a', color: '#fff', textAlign: 'left', padding: '0.8rem 1rem', fontWeight: '600', fontSize: '1.2rem', whiteSpace: 'nowrap' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
              <td style={{ padding: '0.8rem 1rem', borderBottom: '1px solid #ebebeb', color: '#1a1a1a' }}>{r.name || '—'}</td>
              <td style={{ padding: '0.8rem 1rem', borderBottom: '1px solid #ebebeb', color: '#1a1a1a' }}>{r.region || '—'}</td>
              <td style={{ padding: '0.8rem 1rem', borderBottom: '1px solid #ebebeb', color: '#1a1a1a', fontWeight: '600' }}>{r.memory || '—'}</td>
              <td style={{ padding: '0.8rem 1rem', borderBottom: '1px solid #ebebeb', color: '#1a1a1a' }}>{r.throughput || '—'}</td>
              <td style={{ padding: '0.8rem 1rem', borderBottom: '1px solid #ebebeb', color: '#1a1a1a' }}>{r.ha || '—'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ background: '#fff8f0' }}>
            <td colSpan="2" style={{ padding: '0.7rem 1rem', color: '#FF6600', fontWeight: '600', fontSize: '1.2rem' }}>Total Peak Memory</td>
            <td style={{ padding: '0.7rem 1rem', color: '#FF6600', fontWeight: '700', fontSize: '1.3rem' }}>{total} GB</td>
            <td colSpan="2" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ReportPersistenceTable({ prod, nonprod }) {
  const entries = [
    ...Object.entries(prod || {}).filter(([, v]) => v).map(([k, v]) => ({ group: 'Production', env: k, type: v })),
    ...Object.entries(nonprod || {}).filter(([, v]) => v).map(([k, v]) => ({ group: 'Non-Production', env: k, type: v })),
  ];
  if (!entries.length) {
    return <p style={{ fontSize: '1.3rem', color: '#999', margin: '1rem 0 1.6rem' }}>No persistence requirements specified.</p>;
  }
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '1.3rem', marginBottom: '0.4rem' }}>
      <thead>
        <tr>
          {['Group', 'Environment', 'Persistence Type'].map((h) => (
            <th key={h} style={{ background: '#1a1a1a', color: '#fff', textAlign: 'left', padding: '0.8rem 1rem', fontWeight: '600', fontSize: '1.2rem' }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {entries.map((e, i) => (
          <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
            <td style={{ padding: '0.8rem 1rem', borderBottom: '1px solid #ebebeb', color: '#555', fontSize: '1.2rem' }}>{e.group}</td>
            <td style={{ padding: '0.8rem 1rem', borderBottom: '1px solid #ebebeb', color: '#1a1a1a' }}>{e.env}</td>
            <td style={{ padding: '0.8rem 1rem', borderBottom: '1px solid #ebebeb', color: '#1a1a1a' }}>{e.type}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SizingReport({ contact, prodRows, nonprodRows, prodPersistence, nonprodPersistence, notes }) {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const name = [contact.first, contact.last].filter(Boolean).join(' ');
  const filledProd = prodRows.filter((r) => r.memory || r.name);
  const filledNonprod = nonprodRows.filter((r) => r.memory || r.name);

  const detailRows = [
    { l: 'Title', v: 'Redis Enterprise Sizing Report' },
    { l: 'Prepared By', v: 'AceMQ — Redis Subject-Matter Engineering' },
    { l: 'Contact', v: name },
    { l: 'Company', v: contact.company, bold: true },
    { l: 'Role', v: contact.role || '—' },
    { l: 'Email', v: contact.email },
    { l: 'Phone', v: contact.phone || '—' },
    { l: 'Date Submitted', v: date },
    { l: 'Classification', v: 'Confidential — Prepared by AceMQ' },
  ];

  return (
    <div id="sizing-report" style={{ marginTop: '3.2rem' }}>
      <div className="no-print flex items-center justify-between mb-[1.8rem]">
        <p className="text-[1.2rem] font-[400] tracking-[0.12em] uppercase text-[#999]">Your Sizing Report</p>
        <button
          onClick={() => window.print()}
          className="border border-[rgba(0,0,0,0.14)] rounded-[3rem] px-[2rem] py-[0.9rem] text-[1.3rem] text-[#666] hover:border-[#FF6600] hover:text-[#FF6600] transition-all cursor-pointer bg-transparent"
        >
          ↓ Print / Save PDF
        </button>
      </div>

      <div
        id="print-report"
        style={{
          background: '#fff',
          border: '1px solid rgba(0,0,0,0.09)',
          borderRadius: '1.2rem',
          boxShadow: '0 2px 24px rgba(0,0,0,0.06)',
          padding: 'clamp(2.4rem,4vw,4.8rem) clamp(2rem,5vw,5.6rem)',
          overflow: 'hidden',
        }}
      >
        {/* Small logo top-right */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '2.8rem' }}>
          <img src="/redesign/logo.png" alt="AceMQ" style={{ height: '2rem' }} />
        </div>

        {/* Large logo */}
        <img src="/redesign/logo.png" alt="AceMQ" style={{ height: '4rem', marginBottom: '2rem', display: 'block' }} />

        {/* Orange rule */}
        <div style={{ height: '2px', background: '#FF6600', marginBottom: '2rem' }} />

        <p style={{ color: '#FF6600', fontSize: '1.1rem', fontWeight: '700', letterSpacing: '0.14em', textTransform: 'uppercase', margin: '0 0 0.6rem' }}>
          SIZING REFERENCE
        </p>

        <h1 style={{ fontSize: '2.8rem', fontWeight: '700', color: '#000', lineHeight: '1.25', margin: '0 0 0.5rem' }}>
          Redis Enterprise Sizing Report
        </h1>

        <p style={{ fontSize: '1.4rem', color: '#666', margin: '0 0 2.4rem' }}>
          {contact.company} · Prepared by AceMQ · {date}
        </p>

        {/* Orange breadcrumb banner */}
        <div style={{ background: '#FF6600', padding: '1rem 1.4rem', marginBottom: '2.8rem' }}>
          <p style={{ margin: 0, fontSize: '1.1rem', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            <span style={{ color: 'rgba(255,255,255,0.65)' }}>REDIS ENTERPRISE SIZING &nbsp;·&nbsp; </span>
            <strong style={{ color: '#fff', fontWeight: '700' }}>SUBMITTED REPORT</strong>
            <span style={{ color: 'rgba(255,255,255,0.65)' }}> &nbsp;·&nbsp; Contact · Production · Non-Production · Persistence</span>
          </p>
        </div>

        {/* Submission details table */}
        <h2 style={{ fontSize: '1.6rem', fontWeight: '700', color: '#000', margin: '0 0 1rem' }}>Submission Details</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '1.3rem', marginBottom: '2.8rem' }}>
          <thead>
            <tr>
              <th style={{ background: '#1a1a1a', color: '#fff', textAlign: 'left', padding: '0.9rem 1.2rem', fontWeight: '600', width: '30%' }}>Document</th>
              <th style={{ background: '#1a1a1a', color: '#fff', textAlign: 'left', padding: '0.9rem 1.2rem', fontWeight: '600' }}>Detail</th>
            </tr>
          </thead>
          <tbody>
            {detailRows.map((row, i) => (
              <tr key={row.l} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                <td style={{ padding: '0.8rem 1.2rem', borderBottom: '1px solid #ebebeb', color: '#555' }}>{row.l}</td>
                <td style={{ padding: '0.8rem 1.2rem', borderBottom: '1px solid #ebebeb', color: '#1a1a1a', fontWeight: row.bold ? '600' : '400' }}>{row.v}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Production */}
        <ReportSectionBanner num={1} title="PRODUCTION DATABASES" />
        <h2 style={{ fontSize: '1.6rem', fontWeight: '700', color: '#000', margin: '1.4rem 0 0.5rem' }}>1. Production Environments</h2>
        <p style={{ fontSize: '1.3rem', color: '#666', margin: '0 0 1rem' }}>Production (Prod) · Disaster Recovery (DR) · Staging (Stg)</p>
        <ReportDbTable rows={filledProd} haLabel="HA — Cross Region" />

        {/* Non-production */}
        <ReportSectionBanner num={2} title="NON-PRODUCTION DATABASES" />
        <h2 style={{ fontSize: '1.6rem', fontWeight: '700', color: '#000', margin: '1.4rem 0 0.5rem' }}>2. Non-Production Environments</h2>
        <p style={{ fontSize: '1.3rem', color: '#666', margin: '0 0 1rem' }}>Development (Dev) · Test · QA</p>
        <ReportDbTable rows={filledNonprod} haLabel="High Availability" />

        {/* Persistence */}
        <ReportSectionBanner num={3} title="DATA PERSISTENCE REQUIREMENTS" />
        <h2 style={{ fontSize: '1.6rem', fontWeight: '700', color: '#000', margin: '1.4rem 0 1rem' }}>3. Data Persistence</h2>
        <ReportPersistenceTable prod={prodPersistence} nonprod={nonprodPersistence} />

        {/* Notes */}
        {notes && (
          <>
            <ReportSectionBanner num={4} title="ADDITIONAL NOTES" />
            <div style={{ background: '#f9f9f9', borderLeft: '3px solid #FF6600', padding: '1.4rem 1.6rem', marginTop: '1.4rem' }}>
              <p style={{ fontSize: '1.3rem', color: '#333', lineHeight: '1.65', margin: 0 }}>{notes}</p>
            </div>
          </>
        )}

        {/* Footer */}
        <div style={{ marginTop: '4.8rem', paddingTop: '1.4rem', borderTop: '1px solid #ccc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '1.1rem', color: '#999' }}>AceMQ · an ace8 company</span>
          <span style={{ fontSize: '1.1rem', color: '#999' }}>Redis Enterprise Sizing Report · {date}</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

const FLOW = [
  { id: 'intro' },
  { id: 'contact', section: 'About You' },
  { id: 'prod_databases', section: 'Production Environments' },
  { id: 'nonprod_databases', section: 'Non-Production Environments' },
  { id: 'prod_persistence', section: 'Data Requirements' },
  { id: 'nonprod_persistence', section: 'Data Requirements' },
  { id: 'notes', section: 'Additional Context' },
  { id: 'review', section: 'Review' },
  { id: 'done' },
];

const SECTION_STEPS = FLOW.filter((f) => f.section && f.id !== 'review');

export default function SizingTool() {
  const [step, setStep] = useState(0);
  const [contact, setContact] = useState({ first: '', last: '', company: '', role: '', email: '', phone: '' });
  const [prodRows, setProdRows] = useState([mkRow(), mkRow(), mkRow()]);
  const [nonprodRows, setNonprodRows] = useState([mkRow(), mkRow(), mkRow(), mkRow(), mkRow()]);
  const [prodPersistence, setProdPersistence] = useState({});
  const [nonprodPersistence, setNonprodPersistence] = useState({});
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const current = FLOW[step] || FLOW[0];
  const questionNumber = FLOW.slice(0, step).filter((f) => f.section && f.id !== 'review').length;
  const pct =
    step === 0 || current.id === 'done'
      ? 0
      : Math.round((questionNumber / SECTION_STEPS.length) * 100);

  const updateContact = (field, val) => setContact((c) => ({ ...c, [field]: val }));
  const contactValid = contact.first.trim() && contact.company.trim() && contact.email.trim();

  const updateProdRow = (i, field, val) =>
    setProdRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)));
  const updateNonprodRow = (i, field, val) =>
    setNonprodRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)));

  const prodHasData = prodRows.some((r) => r.memory.trim());

  const goNext = () => {
    setStep((s) => s + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const goBack = () => {
    setStep((s) => s - 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const goTo = (s) => {
    setStep(s);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const hutk =
        document.cookie
          .split('; ')
          .find((r) => r.startsWith('hubspotutk='))
          ?.split('=')[1] || null;

      const payload = {
        contact,
        prodRows: prodRows.filter((r) => r.memory || r.name),
        nonprodRows: nonprodRows.filter((r) => r.memory || r.name),
        prodPersistence,
        nonprodPersistence,
        notes,
        hutk,
      };

      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Server error ${res.status}`);
      }

      goTo(FLOW.length - 1);
    } catch (err) {
      setSubmitError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const buildSummary = () => {
    const rows = [
      { l: 'Name', v: [contact.first, contact.last].filter(Boolean).join(' ') },
      { l: 'Company', v: contact.company },
      { l: 'Role', v: contact.role },
      { l: 'Email', v: contact.email },
      { l: 'Phone', v: contact.phone },
    ];

    const filledProd = prodRows.filter((r) => r.memory || r.name);
    if (filledProd.length) {
      rows.push({ l: 'Production DBs', v: `${filledProd.length} database${filledProd.length > 1 ? 's' : ''} — ${filledProd.reduce((sum, r) => sum + (parseFloat(r.memory) || 0), 0)} GB total peak memory` });
    }

    const filledNonprod = nonprodRows.filter((r) => r.memory || r.name);
    if (filledNonprod.length) {
      rows.push({ l: 'Non-Production DBs', v: `${filledNonprod.length} database${filledNonprod.length > 1 ? 's' : ''} — ${filledNonprod.reduce((sum, r) => sum + (parseFloat(r.memory) || 0), 0)} GB total peak memory` });
    }

    const pp = Object.entries(prodPersistence).filter(([, v]) => v);
    if (pp.length) rows.push({ l: 'Prod Persistence', v: pp.map(([k, v]) => `${k}: ${v}`).join(' · ') });

    const np = Object.entries(nonprodPersistence).filter(([, v]) => v);
    if (np.length) rows.push({ l: 'Non-Prod Persistence', v: np.map(([k, v]) => `${k}: ${v}`).join(' · ') });

    if (notes) rows.push({ l: 'Additional Notes', v: notes });

    return rows.filter((r) => r.v);
  };

  return (
    <div className="min-h-screen grid-bg flex flex-col relative">

      {/* ── NAV BAR ── */}
      <nav className="bg-white border-b border-[rgba(0,0,0,0.08)] px-[2rem] sm:px-[5.6rem] py-[1.4rem] sm:py-[1.8rem] flex items-center justify-between flex-shrink-0 relative z-10">
        <img src="/redesign/logo.png" alt="AceMQ" style={{ width: '11.3rem' }} />
        <p className="text-[1.2rem] text-[#999999] tracking-[0.05em] hidden sm:block">
          Redis Enterprise Sizing Tool
        </p>
      </nav>

      {/* ── PROGRESS BAR ── */}
      {step > 0 && current.id !== 'done' && (
        <div className="bg-white border-b border-[rgba(0,0,0,0.06)] px-[2rem] sm:px-[5.6rem] py-[1.2rem] sm:py-[1.4rem] flex-shrink-0 relative z-10">
          <div className="flex justify-between text-[1.2rem] text-[#999999] mb-[0.8rem]">
            <span>{current.section || ''}</span>
            <span>{pct}%</span>
          </div>
          <div className="h-[2px] bg-[rgba(0,0,0,0.08)] rounded-full max-w-[1300px] mx-auto">
            <div
              className="h-full bg-[#FF6600] rounded-full transition-all duration-500 ease-in-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* ── MAIN STAGE ── */}
      <div className="flex-1 flex items-start justify-center px-[1.5rem] sm:px-[5.6rem] py-[2.4rem] sm:py-[5.2rem] pb-[4rem] sm:pb-[8rem] relative z-[1]">
        <div
          className={`bg-white border border-[rgba(0,0,0,0.08)] rounded-[2rem] w-full relative overflow-hidden ${
            step > 0 && current.id !== 'done'
              ? 'shadow-[0_4px_48px_rgba(0,0,0,0.08)]'
              : 'shadow-[0_2px_40px_rgba(0,0,0,0.06)]'
          } ${
            current.id === 'prod_databases' || current.id === 'nonprod_databases' || current.id === 'review' || current.id === 'done'
              ? 'max-w-[76rem]'
              : 'max-w-[60rem]'
          }`}
          style={{ padding: 'clamp(3.2rem, 5vw, 5.2rem) clamp(2.4rem, 5vw, 5.6rem)' }}
        >
          {step > 0 && current.id !== 'done' && (
            <div className="absolute top-0 left-0 right-0 h-[3px] bg-[#FF6600]" />
          )}

          <div key={step} className="animate-fade-slide">

            {/* ══════════ INTRO ══════════ */}
            {current.id === 'intro' && (
              <div>
                <div className="inline-flex items-center gap-[0.7rem] text-[1.2rem] font-[400] tracking-[0.12em] uppercase text-[#8FD5CC] border border-[rgba(143,213,204,0.4)] bg-[rgba(143,213,204,0.08)] px-[1.4rem] py-[0.5rem] rounded-[2rem] mb-[2.8rem]">
                  <span className="w-[0.5rem] h-[0.5rem] bg-[#8FD5CC] rounded-full flex-shrink-0" />
                  Redis Enterprise Experts
                </div>

                <h1 className="text-[#000000] text-[3.6rem] sm:text-[4.8rem] leading-[1.2] font-[700] mb-[1.8rem]">
                  Size your Redis Enterprise
                  <br />
                  <span className="text-[#8FD5CC]">deployment.</span>
                </h1>

                <p className="text-[1.7rem] leading-[1.75] text-[#999999] mb-[3.2rem]">
                  Tell us about your environments and we&apos;ll work with Redis to generate accurate
                  formal pricing. The most important input is your peak memory limit — everything
                  else is helpful context.
                </p>

                <div className="flex flex-wrap gap-[1rem] mb-[3.6rem]">
                  {[
                    { svg: 'clock', text: '3–5 minutes' },
                    { svg: 'check', text: 'All environments' },
                    { svg: 'user', text: 'Accurate pricing' },
                  ].map(({ svg, text }) => (
                    <div
                      key={text}
                      className="flex items-center gap-[0.7rem] text-[1.3rem] text-[#666666] border border-[rgba(0,0,0,0.1)] bg-[#fafafa] rounded-[2rem] px-[1.4rem] py-[0.6rem]"
                    >
                      <svg
                        className="w-[1.3rem] h-[1.3rem] stroke-[#FF6600] fill-none flex-shrink-0"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        viewBox="0 0 24 24"
                      >
                        {svg === 'clock' && (
                          <>
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                          </>
                        )}
                        {svg === 'user' && (
                          <>
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                            <circle cx="12" cy="7" r="4" />
                          </>
                        )}
                        {svg === 'check' && <polyline points="20 6 9 17 4 12" />}
                      </svg>
                      {text}
                    </div>
                  ))}
                </div>

                <BtnOrange onClick={goNext}>Let&apos;s Get Started {'→'}</BtnOrange>
              </div>
            )}

            {/* ══════════ CONTACT ══════════ */}
            {current.id === 'contact' && (
              <div>
                <SectionLabel>About You</SectionLabel>
                <QNum current={questionNumber} total={SECTION_STEPS.length} />
                <QHead>First, tell us who you are.</QHead>
                <QSub>So we know who to send the pricing back to.</QSub>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-[1rem]">
                  <TF placeholder="First name *" value={contact.first} onChange={(e) => updateContact('first', e.target.value)} />
                  <TF placeholder="Last name" value={contact.last} onChange={(e) => updateContact('last', e.target.value)} />
                </div>
                <TF placeholder="Company name *" value={contact.company} onChange={(e) => updateContact('company', e.target.value)} />
                <TF placeholder="Your title or role" value={contact.role} onChange={(e) => updateContact('role', e.target.value)} />
                <TF type="email" placeholder="Work email *" value={contact.email} onChange={(e) => updateContact('email', e.target.value)} />
                <TF type="tel" placeholder="Phone number" value={contact.phone} onChange={(e) => updateContact('phone', e.target.value)} />
                <BtnRow onBack={goBack} onNext={goNext} nextDisabled={!contactValid} />
              </div>
            )}

            {/* ══════════ PRODUCTION DATABASES ══════════ */}
            {current.id === 'prod_databases' && (
              <div>
                <SectionLabel>Production Environments</SectionLabel>
                <QNum current={questionNumber} total={SECTION_STEPS.length} />
                <QHead>Production database details.</QHead>
                <QSub>
                  List each Redis database you plan to run in production, DR, and staging. At minimum,
                  fill in Peak Memory — that&apos;s what Redis needs to generate accurate pricing.
                  Throughput is optional.
                </QSub>
                <DatabaseTable
                  rows={prodRows}
                  onChange={updateProdRow}
                  onAdd={() => setProdRows((r) => [...r, mkRow()])}
                  onRemove={(i) => setProdRows((r) => r.filter((_, idx) => idx !== i))}
                  haLabel="HA — Cross Region"
                />
                <BtnRow onBack={goBack} onNext={goNext} nextDisabled={!prodHasData} />
              </div>
            )}

            {/* ══════════ NON-PRODUCTION DATABASES ══════════ */}
            {current.id === 'nonprod_databases' && (
              <div>
                <SectionLabel>Non-Production Environments</SectionLabel>
                <QNum current={questionNumber} total={SECTION_STEPS.length} />
                <QHead>Non-production database details.</QHead>
                <QSub>
                  List your Dev, Test, QA, or any other non-production Redis databases. Fill in what
                  you know — skip rows that don&apos;t apply to your environment.
                </QSub>
                <DatabaseTable
                  rows={nonprodRows}
                  onChange={updateNonprodRow}
                  onAdd={() => setNonprodRows((r) => [...r, mkRow()])}
                  onRemove={(i) => setNonprodRows((r) => r.filter((_, idx) => idx !== i))}
                  haLabel="High Availability"
                />
                <BtnRow onBack={goBack} onNext={goNext} onSkip={goNext} />
              </div>
            )}

            {/* ══════════ PROD PERSISTENCE ══════════ */}
            {current.id === 'prod_persistence' && (
              <div>
                <SectionLabel>Data Requirements</SectionLabel>
                <QNum current={questionNumber} total={SECTION_STEPS.length} />
                <QHead>Data persistence — Prod, DR & Staging.</QHead>
                <QSub>
                  Select the persistence type for each of your production-tier environments. This
                  affects storage sizing and failover behavior. You can skip if you&apos;re unsure.
                </QSub>
                <PersistenceSelector
                  environments={PROD_ENVIRONMENTS}
                  selections={prodPersistence}
                  onChange={(env, val) =>
                    setProdPersistence((p) => ({ ...p, [env]: val }))
                  }
                />
                <BtnRow onBack={goBack} onNext={goNext} onSkip={goNext} />
              </div>
            )}

            {/* ══════════ NONPROD PERSISTENCE ══════════ */}
            {current.id === 'nonprod_persistence' && (
              <div>
                <SectionLabel>Data Requirements</SectionLabel>
                <QNum current={questionNumber} total={SECTION_STEPS.length} />
                <QHead>Data persistence — Dev, Test & QA.</QHead>
                <QSub>
                  Select the persistence type for each of your non-production environments. It&apos;s
                  common to run with no persistence here. You can skip if you&apos;re unsure.
                </QSub>
                <PersistenceSelector
                  environments={NONPROD_ENVIRONMENTS}
                  selections={nonprodPersistence}
                  onChange={(env, val) =>
                    setNonprodPersistence((p) => ({ ...p, [env]: val }))
                  }
                />
                <BtnRow onBack={goBack} onNext={goNext} onSkip={goNext} />
              </div>
            )}

            {/* ══════════ NOTES ══════════ */}
            {current.id === 'notes' && (
              <div>
                <SectionLabel>Additional Context</SectionLabel>
                <QNum current={questionNumber} total={SECTION_STEPS.length} />
                <QHead>Anything else we should know?</QHead>
                <QSub>
                  Existing Redis setup, use cases (caching, session storage, pub/sub, leaderboards,
                  Streams), compliance requirements, Active-Active geo-replication needs, migration
                  timeline, or anything that helps us build a better quote.
                </QSub>
                <TA
                  placeholder="e.g. Migrating from ElastiCache, need Active-Active geo-replication across us-east-1 and eu-west-1, using Redis for session caching and real-time leaderboards, PCI compliance required..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
                <BtnRow
                  onBack={goBack}
                  onNext={goNext}
                  onSkip={() => { setNotes(''); goNext(); }}
                />
              </div>
            )}

            {/* ══════════ REVIEW ══════════ */}
            {current.id === 'review' && (
              <div>
                <SectionLabel>Review & Submit</SectionLabel>
                <QHead>Review your sizing request.</QHead>
                <QSub>Make sure everything looks right before submitting.</QSub>

                {/* Contact / meta summary */}
                <div className="bg-[#F5F5F5] border border-[rgba(0,0,0,0.06)] rounded-[1.2rem] p-[2.2rem] mb-[2.4rem]">
                  <p className="text-[1.1rem] font-[400] tracking-[0.15em] uppercase text-[#FF6600] mb-[1.6rem]">
                    Your Sizing Request
                  </p>
                  {buildSummary().map((r) => (
                    <div key={r.l} className="flex gap-[1.4rem] mb-[1rem] text-[1.4rem] items-start">
                      <span className="text-[#999999] min-w-[16rem] flex-shrink-0">{r.l}</span>
                      <span className="text-[#161616] font-[400] leading-[1.5]">{r.v}</span>
                    </div>
                  ))}
                </div>

                {/* Database tables */}
                <ReviewDbTable rows={prodRows} title="Production Databases" />
                <ReviewDbTable rows={nonprodRows} title="Non-Production Databases" />

                {/* What happens next */}
                <div className="bg-[rgba(143,213,204,0.08)] border border-[rgba(143,213,204,0.3)] rounded-[1.2rem] p-[2rem] mb-[1rem] mt-[0.4rem]">
                  <div className="flex items-start gap-[1.2rem]">
                    <span className="text-[2rem] flex-shrink-0">{'⚡'}</span>
                    <div>
                      <p className="text-[1.5rem] font-[700] text-[#000] mb-[0.4rem]">What happens next?</p>
                      <p className="text-[1.4rem] text-[#666] leading-[1.6]">
                        The AceMQ team will work with Redis to generate formal pricing and review the
                        options with you. We&apos;ll be in touch within 1–2 business days.
                      </p>
                    </div>
                  </div>
                </div>

                {submitError && (
                  <p className="text-[1.3rem] text-red-600 mt-[1.2rem]">{submitError}</p>
                )}

                <BtnRow
                  onBack={goBack}
                  onNext={submit}
                  nextDisabled={submitting}
                  nextLabel={submitting ? 'Submitting…' : 'Submit Sizing Request →'}
                />
              </div>
            )}

            {/* ══════════ DONE ══════════ */}
            {current.id === 'done' && (
              <div>
                <div className="no-print flex items-start gap-[1.6rem] mb-[0.4rem]">
                  <div className="w-[4.8rem] h-[4.8rem] bg-[#FF6600] rounded-full flex items-center justify-center text-white text-[2rem] flex-shrink-0 mt-[0.4rem]">
                    {'✓'}
                  </div>
                  <div>
                    <h2 className="text-[2.8rem] font-[700] text-[#000000] mb-[0.5rem]">
                      Sizing request submitted.
                    </h2>
                    <p className="text-[1.6rem] text-[#999999] leading-[1.65]">
                      The AceMQ team will review your requirements and be in touch within 1–2 business
                      days. Your sizing report is below — use the button to save or print it.
                    </p>
                  </div>
                </div>

                <SizingReport
                  contact={contact}
                  prodRows={prodRows}
                  nonprodRows={nonprodRows}
                  prodPersistence={prodPersistence}
                  nonprodPersistence={nonprodPersistence}
                  notes={notes}
                />
              </div>
            )}

          </div>
        </div>
      </div>

      {/* ── FOOTER ── */}
      <footer className="bg-black flex-shrink-0 relative z-10">
        <div className="px-[2rem] sm:px-[5.6rem] py-[3rem] sm:py-[4rem] flex flex-col sm:flex-row items-center justify-between gap-[2rem] border-b border-[#475467]">
          <p className="text-white text-[2rem] font-[400] leading-[1.3]">Stay in the know</p>
          <div className="flex items-center gap-[1.2rem]">
            <input
              type="email"
              placeholder="Enter your email"
              className="bg-transparent border border-[#475467] rounded-[3rem] px-[2.4rem] py-[1rem] text-[1.4rem] text-white placeholder-[#667085] outline-none focus:border-[#FF6600] w-full sm:w-[28rem]"
            />
            <button className="bg-[#FF6600] text-white rounded-[3rem] px-[2.4rem] py-[1rem] text-[1.4rem] font-[400] hover:opacity-90 transition-opacity whitespace-nowrap">
              Subscribe
            </button>
          </div>
        </div>

        <div className="px-[2rem] sm:px-[5.6rem] py-[3rem] sm:py-[4rem] grid grid-cols-1 sm:grid-cols-3 gap-[3rem] sm:gap-[4rem] border-b border-[#475467]">
          <div className="flex flex-col gap-[1.6rem]">
            <img src="/redesign/ace_logo_footer.png" alt="AceMQ" style={{ width: '10rem' }} />
            <p className="text-[#D0D5DD] text-[1.4rem] leading-[1.6]">Redis Enterprise Experts</p>
            <a href="https://www.linkedin.com/company/acemq" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn">
              <img src="/redesign/linkedin_.svg" alt="LinkedIn" style={{ width: '2rem', height: '2rem' }} />
            </a>
          </div>

          <div className="flex flex-col gap-[1.6rem]">
            <p className="text-white text-[1.4rem] font-[400] uppercase tracking-[0.1em]">Contact</p>
            <div className="flex flex-col gap-[1.2rem]">
              <div className="flex items-center gap-[1rem]">
                <img src="/redesign/phone.svg" alt="" style={{ width: '1.6rem', height: '1.6rem', flexShrink: 0 }} />
                <span className="text-[#D0D5DD] text-[1.4rem]">+1 305-204-2607</span>
              </div>
              <div className="flex items-start gap-[1rem]">
                <img src="/redesign/location.svg" alt="" style={{ width: '1.6rem', height: '1.6rem', flexShrink: 0, marginTop: '0.2rem' }} />
                <span className="text-[#D0D5DD] text-[1.4rem] leading-[1.5]">
                  66 W Flagler Street 9th Floor<br />Miami, Florida 33130
                </span>
              </div>
              <div className="flex items-center gap-[1rem]">
                <img src="/redesign/message.svg" alt="" style={{ width: '1.6rem', height: '1.6rem', flexShrink: 0 }} />
                <span className="text-[#D0D5DD] text-[1.4rem]">info@acemq.com</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-[1.6rem]">
            <p className="text-white text-[1.4rem] font-[400] uppercase tracking-[0.1em]">Navigate</p>
            <div className="flex flex-col gap-[1rem]">
              {['Home', 'Redis Services', 'Customer Stories', 'Contact'].map((link) => (
                <a key={link} href="#" className="text-[#D0D5DD] text-[1.4rem] hover:text-white transition-colors">
                  {link}
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="px-[2rem] sm:px-[5.6rem] py-[2rem] sm:py-[2.4rem] flex flex-col sm:flex-row items-center justify-between gap-[1rem]">
          <p className="text-[#667085] text-[1.2rem]">
            {'©'} {new Date().getFullYear()} AceMQ {'·'} An Ace8 Company
          </p>
          <p className="text-[#667085] text-[1.2rem]">
            Confidential {'·'} Redis Enterprise Sizing Tool
          </p>
        </div>
      </footer>
    </div>
  );
}
