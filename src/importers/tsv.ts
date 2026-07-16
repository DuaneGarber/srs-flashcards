import type { DeckImporter, ParsedDeck } from './types';

interface Directives {
  separator: string;
  excludedColumns: Set<number>; // 0-indexed
}

function resolveSeparator(directiveValue: string): string {
  switch (directiveValue.trim().toLowerCase()) {
    case 'tab':
      return '\t';
    case 'comma':
      return ',';
    case 'semicolon':
      return ';';
    default:
      // a literal character, per §5.2.1
      return directiveValue;
  }
}

const COLUMN_DIRECTIVE_KEYS = new Set(['notetype column', 'deck column', 'tags column']);

/**
 * Consumes all leading `#`-prefixed lines (stopping at the first line that
 * isn't one — §5.2.2) and returns the resolved directives plus the index of
 * the first data line. Directives are simple single lines, never quoted, so
 * this can safely operate on a naive newline split even though data rows
 * cannot (see tokenizeRows).
 */
function parseDirectives(lines: string[]): { directives: Directives; dataStartIndex: number } {
  const excludedColumns = new Set<number>();
  let separator = '\t'; // default, per §5.2.1
  let i = 0;

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('#')) break;

    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(1, colonIndex).trim().toLowerCase();
    const value = line.slice(colonIndex + 1).trim();

    if (key === 'separator') {
      separator = resolveSeparator(value);
    } else if (COLUMN_DIRECTIVE_KEYS.has(key)) {
      const columnNumber = Number(value);
      if (Number.isInteger(columnNumber) && columnNumber >= 1) {
        excludedColumns.add(columnNumber - 1);
      }
    }
    // #html: and any other directive is recognized but doesn't affect
    // column mapping, so there's nothing further to do with it here.
  }

  return { directives: { separator, excludedColumns }, dataStartIndex: i };
}

/**
 * CSV/TSV-style tokenizer (§5.2.4): a field starting with `"` is quoted and
 * may contain the separator, or a literal newline, or `""` as an escaped
 * quote, until the closing `"`. Must run on the raw remaining text rather
 * than pre-split lines, since a quoted field can legitimately span more
 * than one physical line.
 */
function tokenizeRows(text: string, separator: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '\r') {
      continue; // normalize CRLF/CR line endings, quoted or not
    }

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === '') {
      inQuotes = true;
    } else if (char === separator) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** First two non-excluded columns, in order, are front/back (§5.2.3). Further columns are ignored. */
function mapRowToCard(row: string[], excludedColumns: Set<number>): { front: string; back: string } {
  let front = '';
  let back = '';
  let found = 0;

  for (let col = 0; col < row.length && found < 2; col++) {
    if (excludedColumns.has(col)) continue;
    if (found === 0) {
      front = row[col];
    } else {
      back = row[col];
    }
    found++;
  }

  return { front, back };
}

export const tsvImporter: DeckImporter = {
  canHandle(filename) {
    return /\.(txt|tsv)$/i.test(filename);
  },

  parse(fileContents) {
    const lines = fileContents.split('\n');
    const { directives, dataStartIndex } = parseDirectives(lines);
    const dataText = lines.slice(dataStartIndex).join('\n');
    const rows = tokenizeRows(dataText, directives.separator);

    const cards: ParsedDeck['cards'] = rows.map((row) => mapRowToCard(row, directives.excludedColumns));

    // Deck name isn't in the file (§5.2.5) — it's derived from the picked
    // file's name at the import-preview wiring layer (build step 5), which
    // this frozen `parse(fileContents)` signature has no access to.
    return { name: '', cards };
  },
};
