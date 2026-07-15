import type { SQLiteDatabase } from 'expo-sqlite';

import { createTestDb } from './sqliteTestAdapter';
import { migrateDbIfNeeded } from './schema';
import {
  getDecks,
  insertDeck,
  deleteDeck,
  getDueCards,
  getNewCards,
  updateCard,
  insertReviewLog,
} from './repository';

let db: SQLiteDatabase;

beforeEach(async () => {
  db = createTestDb();
  await migrateDbIfNeeded(db);
});

describe('migrateDbIfNeeded', () => {
  it('creates all three tables', async () => {
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table'"
    );
    const names = tables.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['decks', 'cards', 'review_log']));
  });

  it('enables foreign_keys on every connection', async () => {
    const row = await db.getFirstAsync<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(row?.foreign_keys).toBe(1);
  });

  it('is idempotent — a second call does not throw or duplicate tables', async () => {
    await expect(migrateDbIfNeeded(db)).resolves.not.toThrow();
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='cards'"
    );
    expect(tables).toHaveLength(1);
  });
});

describe('deck + card queries', () => {
  const now = Date.parse('2026-07-15T21:00:00');

  async function seedDeckWithCards() {
    const deckId = await insertDeck(db, 'Test Deck', now);
    const insert = (front: string, position: number, repetitions: number, dueDate: number) =>
      db.runAsync(
        `INSERT INTO cards (deck_id, front, back, position, ease_factor, interval, repetitions, due_date, created_at)
         VALUES (?, ?, ?, ?, 2.5, 6, ?, ?, ?)`,
        [deckId, front, `back-${front}`, position, repetitions, dueDate, now]
      );

    await insert('new1', 0, 0, now); // new
    await insert('new2', 1, 0, now); // new
    await insert('new3', 2, 0, now); // new
    const dueResult = await insert('due1', 3, 1, now - 1000); // studied, due
    await insert('future1', 4, 1, now + 1000 * 60 * 60 * 24 * 30); // studied, not due

    return { deckId, dueCardId: dueResult.lastInsertRowId };
  }

  it('getDecks reports dueCount as due_date <= now, regardless of repetitions', async () => {
    const { deckId } = await seedDeckWithCards();
    const decks = await getDecks(db, now);
    expect(decks).toHaveLength(1);
    expect(decks[0]).toMatchObject({ id: deckId, name: 'Test Deck', dueCount: 4 });
  });

  it('getDecks reports dueCount 0 for a deck with no cards', async () => {
    await insertDeck(db, 'Empty Deck', now);
    const decks = await getDecks(db, now);
    expect(decks[0].dueCount).toBe(0);
  });

  it('getNewCards returns only repetitions=0 cards, in position order, respecting the limit', async () => {
    const { deckId } = await seedDeckWithCards();
    const newCards = await getNewCards(db, deckId, 2);
    expect(newCards.map((c) => c.front)).toEqual(['new1', 'new2']);
  });

  it('getDueCards excludes new cards (repetitions=0) and not-yet-due cards', async () => {
    const { deckId } = await seedDeckWithCards();
    const dueCards = await getDueCards(db, deckId, now);
    expect(dueCards.map((c) => c.front)).toEqual(['due1']);
  });

  it('updateCard + insertReviewLog: last write wins on the card row, log keeps every attempt (§4.2)', async () => {
    const { dueCardId } = await seedDeckWithCards();

    // Again -> requeue -> Good: two scheduler runs, two card-row writes.
    await updateCard(db, { id: dueCardId, easeFactor: 2.36, interval: 1, repetitions: 0, dueDate: now });
    await insertReviewLog(db, { cardId: dueCardId, rating: 0, reviewedAt: now, prevInterval: 6, newInterval: 1 });
    await updateCard(db, { id: dueCardId, easeFactor: 2.36, interval: 6, repetitions: 1, dueDate: now + 1000 });
    await insertReviewLog(db, {
      cardId: dueCardId,
      rating: 2,
      reviewedAt: now + 1,
      prevInterval: 1,
      newInterval: 6,
    });

    const [card] = await getDueCards(db, (await getDecks(db, now))[0].id, now + 1000);
    expect(card).toMatchObject({ repetitions: 1, interval: 6 });

    const logs = await db.getAllAsync<{ c: number }>(
      'SELECT COUNT(*) AS c FROM review_log WHERE card_id = ?',
      [dueCardId]
    );
    expect(logs[0].c).toBe(2);
  });

  it('deleteDeck cascades to cards and review_log', async () => {
    const { deckId, dueCardId } = await seedDeckWithCards();
    await insertReviewLog(db, { cardId: dueCardId, rating: 2, reviewedAt: now, prevInterval: 1, newInterval: 6 });

    await deleteDeck(db, deckId);

    const remainingCards = await db.getAllAsync('SELECT id FROM cards WHERE deck_id = ?', [deckId]);
    const remainingLogs = await db.getAllAsync('SELECT id FROM review_log WHERE card_id = ?', [dueCardId]);
    expect(remainingCards).toHaveLength(0);
    expect(remainingLogs).toHaveLength(0);
  });
});
