// worker/utils/docx.js
// DOCX generation without external dependencies.
// Uses ZIP store method (no compression) for maximum compatibility.

import { extractTaggedSection } from "./files.js";

// ── ZIP builder (store/no-compression) ───────────────────────────────────────

function crc32(data) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(n) { return [(n) & 0xff, (n >> 8) & 0xff]; }
function u32(n) { return [(n) & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]; }

function buildZip(files) {
  const enc = new TextEncoder();
  const localHeaders = [];
  const centralDirs = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const size = data.length;

    // Local file header
    const local = [
      0x50, 0x4b, 0x03, 0x04, // signature
      0x14, 0x00,             // version needed: 2.0
      0x00, 0x00,             // flags
      0x00, 0x00,             // method: STORE (0)
      0x00, 0x00,             // mod time
      0x00, 0x00,             // mod date
      ...u32(crc),
      ...u32(size),
      ...u32(size),
      ...u16(nameBytes.length),
      0x00, 0x00,             // extra length
      ...nameBytes,
      ...data,
    ];

    // Central directory entry
    const central = [
      0x50, 0x4b, 0x01, 0x02, // signature
      0x14, 0x00,             // version made by
      0x14, 0x00,             // version needed
      0x00, 0x00,             // flags
      0x00, 0x00,             // method: STORE
      0x00, 0x00,             // mod time
      0x00, 0x00,             // mod date
      ...u32(crc),
      ...u32(size),
      ...u32(size),
      ...u16(nameBytes.length),
      0x00, 0x00,             // extra length
      0x00, 0x00,             // comment length
      0x00, 0x00,             // disk start
      0x00, 0x00,             // int attribs
      0x00, 0x00, 0x00, 0x00, // ext attribs
      ...u32(offset),
      ...nameBytes,
    ];

    localHeaders.push(...local);
    centralDirs.push(...central);
    offset += local.length;
  }

  const centralOffset = offset;
  const centralSize = centralDirs.length;

  const eocd = [
    0x50, 0x4b, 0x05, 0x06, // signature
    0x00, 0x00,             // disk number
    0x00, 0x00,             // start disk
    ...u16(files.length),
    ...u16(files.length),
    ...u32(centralSize),
    ...u32(centralOffset),
    0x00, 0x00,             // comment length
  ];

  return new Uint8Array([...localHeaders, ...centralDirs, ...eocd]);
}

// ── OOXML helpers ─────────────────────────────────────────────────────────────

function xe(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

function para(text, opts = {}) {
  const { bold, heading, spaceAfter = 120 } = opts;
  const styleId = heading === 1 ? 'Heading1' : heading === 2 ? 'Heading2' : 'Normal';
  const rPr = bold ? '<w:b/><w:bCs/>' : '';
  const pPr = `<w:pStyle w:val="${styleId}"/><w:spacing w:after="${spaceAfter}"/>`;

  if (!text || !text.trim()) {
    return `<w:p><w:pPr>${pPr}</w:pPr></w:p>`;
  }

  const lines = text.split('\n');
  const runs = lines.map((line, i) => {
    const t = `<w:t xml:space="preserve">${xe(line)}</w:t>`;
    const br = i < lines.length - 1 ? '<w:br/>' : '';
    return `<w:r><w:rPr>${rPr}</w:rPr>${t}${br}</w:r>`;
  }).join('');

  return `<w:p><w:pPr>${pPr}</w:pPr>${runs}</w:p>`;
}

function buildDocx(bodyParagraphs) {
  const enc = new TextEncoder();

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${bodyParagraphs.join('\n')}
<w:sectPr>
  <w:pgSz w:w="12240" w:h="15840"/>
  <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
</w:sectPr>
</w:body>
</w:document>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>
    <w:rPr><w:b/><w:bCs/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="160" w:after="80"/></w:pPr>
    <w:rPr><w:b/><w:bCs/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr>
  </w:style>
</w:styles>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

  const packageRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  return buildZip([
    { name: '[Content_Types].xml',         data: enc.encode(contentTypesXml) },
    { name: '_rels/.rels',                 data: enc.encode(packageRelsXml) },
    { name: 'word/document.xml',           data: enc.encode(documentXml) },
    { name: 'word/styles.xml',             data: enc.encode(stylesXml) },
    { name: 'word/_rels/document.xml.rels', data: enc.encode(relsXml) },
  ]);
}

// ── Text parsing ──────────────────────────────────────────────────────────────

function cleanAnalysis(text) {
  return text
    .replace(/\[TITLE\][\s\S]*?\[\/TITLE\]/g, '')
    .replace(/\[INTRO\][\s\S]*?\[\/INTRO\]/g, '')
    .replace(/\[LETTER\][\s\S]*?\[\/LETTER\]/g, '')
    .replace(/\[\/?[A-Z_]+\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

export function makeAnalysisDocx(analysis, name, email, triage, type) {
  const title = (extractTaggedSection(analysis, 'TITLE') || 'Document Analysis').trim();
  const intro = (extractTaggedSection(analysis, 'INTRO') || '').trim();
  const rest  = cleanAnalysis(analysis);
  const date  = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const paras = [
    para(title, { heading: 1 }),
    para(`Prepared for: ${name}   |   Date: ${date}`, { bold: false, spaceAfter: 80 }),
    triage?.sender         ? para(`Sender: ${triage.sender}`, { spaceAfter: 60 }) : null,
    triage?.amount_claimed ? para(`Amount: £${triage.amount_claimed}`, { spaceAfter: 120 }) : null,
    para(''),
    intro ? para(intro, { spaceAfter: 120 }) : null,
    para(''),
    ...rest.split('\n\n').map(block => {
      const b = block.trim();
      if (!b) return para('');
      if (b.length < 60 && b === b.toUpperCase() && /[A-Z]{3}/.test(b)) return para(b, { heading: 2 });
      if (b.endsWith(':') && b.length < 80) return para(b, { bold: true, spaceAfter: 60 });
      return para(b, { spaceAfter: 120 });
    }),
    para(''),
    para('─'.repeat(60), { spaceAfter: 60 }),
    para('This document is for informational purposes only and does not constitute legal advice. DoIPayThat does not provide legal representation.', { spaceAfter: 0 }),
  ].filter(Boolean);

  return buildDocx(paras);
}

export function makeLetterDocx(analysis, name, triage, type) {
  const raw = extractTaggedSection(analysis, 'LETTER') || analysis;
  const letterBody = raw.replace(/\[\/?[A-Z_]+\]/g, '').trim();
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const paras = [
    para(name, { spaceAfter: 60 }),
    para(date, { spaceAfter: 240 }),
    para(''),
    ...letterBody.split('\n').map(line => para(line.trim(), { spaceAfter: 120 })),
    para(''),
    para('─'.repeat(60), { spaceAfter: 60 }),
    para('This is a draft for informational purposes only and does not constitute legal advice.', { spaceAfter: 0 }),
  ];

  return buildDocx(paras);
}

export function docxToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function makePlainText(analysis, name) {
  const clean = analysis.replace(/\[\/?\w+\]/g, '').replace(/\n{3,}/g, '\n\n').trim();
  const date = new Date().toLocaleDateString('en-GB');
  return `Document Analysis\nPrepared for: ${name}\nDate: ${date}\n\n${'─'.repeat(60)}\n\n${clean}\n\n${'─'.repeat(60)}\n\nThis document is for informational purposes only and does not constitute legal advice.`;
}

export function makeAnalysisDocxDE(analysis, name, email, triage, type) {
  const title = (extractTaggedSection(analysis, 'TITLE') || 'Dokumentenanalyse').trim();
  const intro = (extractTaggedSection(analysis, 'INTRO') || '').trim();
  const rest  = cleanAnalysis(analysis);
  const date  = new Date().toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });

  const paras = [
    para(title, { heading: 1 }),
    para(`Erstellt für: ${name}   |   Datum: ${date}`, { spaceAfter: 80 }),
    triage?.sender         ? para(`Absender: ${triage.sender}`, { spaceAfter: 60 }) : null,
    triage?.amount_claimed ? para(`Forderung: ${triage.amount_claimed} €`, { spaceAfter: 120 }) : null,
    para(''),
    intro ? para(intro, { spaceAfter: 120 }) : null,
    para(''),
    ...rest.split('\n\n').map(block => {
      const b = block.trim();
      if (!b) return para('');
      if (b.length < 60 && b === b.toUpperCase() && /[A-Z]{3}/.test(b)) return para(b, { heading: 2 });
      if (b.endsWith(':') && b.length < 80) return para(b, { bold: true, spaceAfter: 60 });
      return para(b, { spaceAfter: 120 });
    }),
    para(''),
    para('─'.repeat(60), { spaceAfter: 60 }),
    para('Dieses Dokument dient ausschließlich zur Information und stellt keine Rechtsberatung dar. MussIchZahlen.de bietet keine rechtliche Vertretung an.', { spaceAfter: 0 }),
  ].filter(Boolean);

  return buildDocx(paras);
}

export function makeLetterDocxDE(analysis, name, triage, type) {
  const raw = extractTaggedSection(analysis, 'LETTER') || analysis;
  const letterBody = raw.replace(/\[\/?[A-Z_]+\]/g, '').trim();
  const date = new Date().toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });

  const paras = [
    para(name, { spaceAfter: 60 }),
    para(date, { spaceAfter: 240 }),
    para(''),
    ...letterBody.split('\n').map(line => para(line.trim(), { spaceAfter: 120 })),
    para(''),
    para('─'.repeat(60), { spaceAfter: 60 }),
    para('Dieser Entwurf dient ausschließlich zur Information und stellt keine Rechtsberatung dar.', { spaceAfter: 0 }),
  ];

  return buildDocx(paras);
}
