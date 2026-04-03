import {
  buildInputPromptDescription,
  getInputType,
  type InputDefinition,
  type Inputs,
} from '../types/shared';

const SVG_WIDTH = 1200;
const SVG_LINE_HEIGHT = 32;
const SVG_PADDING = 48;
const PDF_LINE_HEIGHT = 16;
const PDF_MARGIN_LEFT = 50;
const PDF_MARGIN_TOP = 780;

const CRC32_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let i = 0; i < 8; i++) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapePdfText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function normalizeDocumentText(value: string): string[] {
  return value.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return [''];
    }

    const chunks: string[] = [];
    let remaining = trimmed;
    while (remaining.length > 90) {
      let splitAt = remaining.lastIndexOf(' ', 90);
      if (splitAt <= 0) {
        splitAt = 90;
      }
      chunks.push(remaining.slice(0, splitAt).trimEnd());
      remaining = remaining.slice(splitAt).trimStart();
    }
    chunks.push(remaining);
    return chunks;
  });
}

function toDataUri(mimeType: string, content: string | Buffer): string {
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function buildSvgImage(text: string): string {
  const lines = normalizeDocumentText(text);
  const height = SVG_PADDING * 2 + Math.max(lines.length, 1) * SVG_LINE_HEIGHT;

  const textNodes =
    lines.length > 0
      ? lines
          .map(
            (line, index) =>
              `<text x="${SVG_PADDING}" y="${SVG_PADDING + (index + 1) * SVG_LINE_HEIGHT}" font-family="Arial, sans-serif" font-size="22" fill="#111827">${escapeXml(line || ' ')}</text>`,
          )
          .join('')
      : `<text x="${SVG_PADDING}" y="${SVG_PADDING + SVG_LINE_HEIGHT}" font-family="Arial, sans-serif" font-size="22" fill="#111827"> </text>`;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${height}" viewBox="0 0 ${SVG_WIDTH} ${height}">`,
    '<rect width="100%" height="100%" fill="#ffffff" stroke="#d1d5db"/>',
    textNodes,
    '</svg>',
  ].join('');
}

function buildPdfData(text: string): Buffer {
  const lines = normalizeDocumentText(text);
  const textCommands = lines
    .map((line, index) => {
      const position =
        index === 0
          ? `BT /F1 12 Tf ${PDF_MARGIN_LEFT} ${PDF_MARGIN_TOP} Td`
          : `0 -${PDF_LINE_HEIGHT} Td`;
      return `${position} (${escapePdfText(line || ' ')}) Tj`;
    })
    .join('\n');

  const stream = `${textCommands}\nET`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj',
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf-8')} >>\nstream\n${stream}\nendstream\nendobj`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf-8'));
    pdf += `${object}\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf-8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'utf-8');
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf-8');
    const data = entry.data;
    const checksum = crc32(data);

    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuffer.copy(localHeader, 30);

    localParts.push(localHeader, data);

    const centralHeader = Buffer.alloc(46 + nameBuffer.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuffer.copy(centralHeader, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
  endOfCentralDirectory.writeUInt32LE(offset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory]);
}

function buildDocxData(text: string): Buffer {
  const paragraphs = normalizeDocumentText(text)
    .map(
      (line) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line || ' ')}</w:t></w:r></w:p>`,
    )
    .join('');

  const entries = [
    {
      name: '[Content_Types].xml',
      data: Buffer.from(
        [
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
          '<Default Extension="xml" ContentType="application/xml"/>',
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
          '</Types>',
        ].join(''),
        'utf-8',
      ),
    },
    {
      name: '_rels/.rels',
      data: Buffer.from(
        [
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
          '</Relationships>',
        ].join(''),
        'utf-8',
      ),
    },
    {
      name: 'word/document.xml',
      data: Buffer.from(
        [
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
          '<w:body>',
          paragraphs,
          '<w:sectPr/>',
          '</w:body>',
          '</w:document>',
        ].join(''),
        'utf-8',
      ),
    },
  ];

  return createZip(entries);
}

export function buildPromptInputDescriptions(inputs?: Inputs): Record<string, string> | undefined {
  if (!inputs) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(inputs).map(([key, definition]) => [
      key,
      buildInputPromptDescription(definition),
    ]),
  );
}

export function materializeInputValue(value: string, definition: InputDefinition): string {
  const inputType = getInputType(definition);

  switch (inputType) {
    case 'pdf':
      return toDataUri('application/pdf', buildPdfData(value));
    case 'docx':
      return toDataUri(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buildDocxData(value),
      );
    case 'image':
      return toDataUri('image/svg+xml', buildSvgImage(value));
    case 'text':
    default:
      return value;
  }
}

export function materializeInputVariables(
  variables: Record<string, string>,
  inputs: Inputs,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(variables).map(([key, value]) => {
      const definition = inputs[key];
      return [key, definition ? materializeInputValue(value, definition) : value];
    }),
  );
}

export function createPlaceholderInputValue(name: string, definition: InputDefinition): string {
  const placeholder = `Test value for ${name}`;
  return materializeInputValue(placeholder, definition);
}
