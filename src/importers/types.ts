export interface ParsedDeck {
  name: string;
  cards: { front: string; back: string }[];
}

export interface DeckImporter {
  canHandle(filename: string): boolean;
  parse(fileContents: string): ParsedDeck;
}
