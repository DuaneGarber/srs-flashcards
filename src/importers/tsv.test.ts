import { tsvImporter } from './tsv';

describe('tsvImporter.canHandle', () => {
  it('handles .txt and .tsv, case-insensitively', () => {
    expect(tsvImporter.canHandle('Core2k.txt')).toBe(true);
    expect(tsvImporter.canHandle('deck.TSV')).toBe(true);
  });

  it('rejects other extensions', () => {
    expect(tsvImporter.canHandle('deck.json')).toBe(false);
    expect(tsvImporter.canHandle('deck.apkg')).toBe(false);
  });
});

describe('tsvImporter.parse — column resolution (§5.2, required test a)', () => {
  it('resolves front/back to columns 3-4 when notetype/deck occupy columns 1-2', () => {
    const file = [
      '#separator:tab',
      '#notetype column:1',
      '#deck column:2',
      'Basic\tCore 2k/6k\tfront text\tback text',
    ].join('\n');

    const deck = tsvImporter.parse(file);
    expect(deck.cards).toEqual([{ front: 'front text', back: 'back text' }]);
  });

  it('excludes tags column too, and further columns beyond front/back are ignored', () => {
    const file = [
      '#separator:tab',
      '#notetype column:1',
      '#deck column:2',
      '#tags column:5',
      'Basic\tCore 2k/6k\tfront\tback\tsome-tag\textra-ignored-column',
    ].join('\n');

    const deck = tsvImporter.parse(file);
    expect(deck.cards).toEqual([{ front: 'front', back: 'back' }]);
  });

  it('defaults to the first two columns when no notetype/deck/tags directives are present', () => {
    const file = 'front\tback';
    expect(tsvImporter.parse(file).cards).toEqual([{ front: 'front', back: 'back' }]);
  });
});

describe('tsvImporter.parse — quoted fields (§5.2.4, required test b)', () => {
  it('handles a quoted field containing the separator and a "" escape', () => {
    const file = '"Hello\tWorld"\t"She said ""hi"""';
    const deck = tsvImporter.parse(file);
    expect(deck.cards).toEqual([{ front: 'Hello\tWorld', back: 'She said "hi"' }]);
  });

  it('handles a quoted field containing a literal newline', () => {
    const file = '"Line one\nLine two"\tback';
    const deck = tsvImporter.parse(file);
    expect(deck.cards).toEqual([{ front: 'Line one\nLine two', back: 'back' }]);
  });

  it('does not treat a mid-field quote as toggling quote mode', () => {
    const file = 'front with "quote" mid-field\tback';
    const deck = tsvImporter.parse(file);
    expect(deck.cards[0].front).toBe('front with "quote" mid-field');
  });
});

describe('tsvImporter.parse — parse-then-sanitize ordering (§5.2.4, required test c)', () => {
  it('leaves a <br> in a field untouched — sanitization is a separate, later step', () => {
    const file = 'Question one<br>continued\tAnswer text';
    const deck = tsvImporter.parse(file);
    expect(deck.cards[0].front).toBe('Question one<br>continued');
  });
});

describe('tsvImporter.parse — directives', () => {
  it('resolves comma and semicolon separator keywords', () => {
    expect(tsvImporter.parse('#separator:comma\nfront,back').cards).toEqual([
      { front: 'front', back: 'back' },
    ]);
    expect(tsvImporter.parse('#separator:semicolon\nfront;back').cards).toEqual([
      { front: 'front', back: 'back' },
    ]);
  });

  it('resolves a literal-character separator', () => {
    expect(tsvImporter.parse('#separator:|\nfront|back').cards).toEqual([
      { front: 'front', back: 'back' },
    ]);
  });

  it('recognizes #html: without it affecting column mapping', () => {
    const file = ['#separator:tab', '#html:true', 'front\tback'].join('\n');
    expect(tsvImporter.parse(file).cards).toEqual([{ front: 'front', back: 'back' }]);
  });

  it('only consumes leading # lines — a bare "#" appearing later is data, not a directive', () => {
    const file = ['#separator:tab', 'front #1\tback'].join('\n');
    expect(tsvImporter.parse(file).cards).toEqual([{ front: 'front #1', back: 'back' }]);
  });
});

describe('tsvImporter.parse — multiple rows and blank lines', () => {
  it('parses every row and skips blank lines', () => {
    const file = ['front1\tback1', '', 'front2\tback2', ''].join('\n');
    expect(tsvImporter.parse(file).cards).toEqual([
      { front: 'front1', back: 'back1' },
      { front: 'front2', back: 'back2' },
    ]);
  });
});

describe('tsvImporter.parse — deck name', () => {
  it('does not derive a name from file contents — that is the wiring layer\'s job (§5.2.5)', () => {
    expect(tsvImporter.parse('front\tback').name).toBe('');
  });
});
