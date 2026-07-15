import type { SQLiteDatabase } from 'expo-sqlite';

export const DATABASE_NAME = 'srs-flashcards.db';

const SCHEMA_VERSION = 1;

/**
 * `PRAGMA foreign_keys` is per-connection, not persisted in the database
 * file, so it must be set every time the db is opened, not only on first
 * install. Runs unconditionally before the version check below.
 */
export async function migrateDbIfNeeded(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA foreign_keys = ON;');

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const currentVersion = row?.user_version ?? 0;
  if (currentVersion >= SCHEMA_VERSION) {
    return;
  }

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS decks (
      id INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY NOT NULL,
      deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      front TEXT NOT NULL,
      back TEXT NOT NULL,
      position INTEGER NOT NULL,
      ease_factor REAL NOT NULL,
      interval INTEGER NOT NULL,
      repetitions INTEGER NOT NULL,
      due_date INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cards_deck_id ON cards(deck_id);
    CREATE INDEX IF NOT EXISTS idx_cards_deck_due ON cards(deck_id, due_date);
    CREATE INDEX IF NOT EXISTS idx_cards_deck_new ON cards(deck_id, repetitions, position);

    CREATE TABLE IF NOT EXISTS review_log (
      id INTEGER PRIMARY KEY NOT NULL,
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL,
      reviewed_at INTEGER NOT NULL,
      prev_interval INTEGER NOT NULL,
      new_interval INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_review_log_card_id ON review_log(card_id);
  `);

  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}
