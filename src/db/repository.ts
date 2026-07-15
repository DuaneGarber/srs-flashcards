import type { SQLiteDatabase } from 'expo-sqlite';

export interface Deck {
  id: number;
  name: string;
  createdAt: number;
  dueCount: number;
}

export interface Card {
  id: number;
  deckId: number;
  front: string;
  back: string;
  position: number;
  easeFactor: number;
  interval: number;
  repetitions: number;
  dueDate: number;
  createdAt: number;
}

export interface ReviewLogEntry {
  cardId: number;
  rating: number;
  reviewedAt: number;
  prevInterval: number;
  newInterval: number;
}

const CARD_COLUMNS = `
  id, deck_id AS deckId, front, back, position,
  ease_factor AS easeFactor, interval, repetitions,
  due_date AS dueDate, created_at AS createdAt
`;

/** Decks with a due count each (cards where due_date <= now) — §6.A. */
export function getDecks(db: SQLiteDatabase, now: number): Promise<Deck[]> {
  return db.getAllAsync<Deck>(
    `SELECT
       decks.id AS id,
       decks.name AS name,
       decks.created_at AS createdAt,
       COUNT(CASE WHEN cards.due_date <= ? THEN 1 END) AS dueCount
     FROM decks
     LEFT JOIN cards ON cards.deck_id = decks.id
     GROUP BY decks.id
     ORDER BY decks.created_at ASC`,
    [now]
  );
}

export async function insertDeck(db: SQLiteDatabase, name: string, createdAt: number): Promise<number> {
  const result = await db.runAsync('INSERT INTO decks (name, created_at) VALUES (?, ?)', [name, createdAt]);
  return result.lastInsertRowId;
}

/** Cascades to cards + review_log via ON DELETE CASCADE (requires PRAGMA foreign_keys = ON, set in schema.ts). */
export async function deleteDeck(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM decks WHERE id = ?', [id]);
}

/**
 * Previously-studied cards (repetitions > 0) due again — no cap, per §6.C.
 * New cards are a separate pool (see getNewCards): a fresh import's
 * due_date is already "today", so folding them into this query would
 * defeat NEW_PER_DAY.
 */
export function getDueCards(db: SQLiteDatabase, deckId: number, now: number): Promise<Card[]> {
  return db.getAllAsync<Card>(
    `SELECT ${CARD_COLUMNS} FROM cards
     WHERE deck_id = ? AND repetitions > 0 AND due_date <= ?
     ORDER BY due_date ASC`,
    [deckId, now]
  );
}

/** Never-studied cards, capped and in import order (position) — §6.C, §8#2. */
export function getNewCards(db: SQLiteDatabase, deckId: number, limit: number): Promise<Card[]> {
  return db.getAllAsync<Card>(
    `SELECT ${CARD_COLUMNS} FROM cards
     WHERE deck_id = ? AND repetitions = 0
     ORDER BY position ASC
     LIMIT ?`,
    [deckId, limit]
  );
}

/** Last-write-wins on the card row by design — see §4.2 persistence semantics. */
export async function updateCard(
  db: SQLiteDatabase,
  card: Pick<Card, 'id' | 'easeFactor' | 'interval' | 'repetitions' | 'dueDate'>
): Promise<void> {
  await db.runAsync(
    'UPDATE cards SET ease_factor = ?, interval = ?, repetitions = ?, due_date = ? WHERE id = ?',
    [card.easeFactor, card.interval, card.repetitions, card.dueDate, card.id]
  );
}

export async function insertReviewLog(db: SQLiteDatabase, entry: ReviewLogEntry): Promise<void> {
  await db.runAsync(
    'INSERT INTO review_log (card_id, rating, reviewed_at, prev_interval, new_interval) VALUES (?, ?, ?, ?, ?)',
    [entry.cardId, entry.rating, entry.reviewedAt, entry.prevInterval, entry.newInterval]
  );
}
