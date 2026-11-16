import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type Visitor = {
  userId: number;
  topicId: number | null;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  banned: boolean;
  createdAt: number;
  updatedAt: number;
};

type VisitorRow = {
  user_id: number;
  topic_id: number | null;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  banned: number;
  created_at: number;
  updated_at: number;
};

export type TelegramUserProfile = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
};

function mapRow(row: VisitorRow): Visitor {
  return {
    userId: row.user_id,
    topicId: row.topic_id,
    firstName: row.first_name,
    lastName: row.last_name,
    username: row.username,
    banned: row.banned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class Store {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS visitors (
        user_id INTEGER PRIMARY KEY,
        topic_id INTEGER UNIQUE,
        first_name TEXT,
        last_name TEXT,
        username TEXT,
        banned INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_visitors_banned ON visitors(banned);
    `);
  }

  getByUserId(userId: number): Visitor | undefined {
    const row = this.db
      .prepare("SELECT * FROM visitors WHERE user_id = ?")
      .get(userId) as VisitorRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  getByTopicId(topicId: number): Visitor | undefined {
    const row = this.db
      .prepare("SELECT * FROM visitors WHERE topic_id = ?")
      .get(topicId) as VisitorRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  isBanned(userId: number): boolean {
    return this.getByUserId(userId)?.banned === true;
  }

  upsertProfile(user: TelegramUserProfile): Visitor {
    const now = Date.now();
    this.db
      .prepare(
        `
        INSERT INTO visitors (
          user_id, topic_id, first_name, last_name, username, banned, created_at, updated_at
        ) VALUES (
          @user_id, NULL, @first_name, @last_name, @username, 0, @now, @now
        )
        ON CONFLICT(user_id) DO UPDATE SET
          first_name = excluded.first_name,
          last_name = excluded.last_name,
          username = excluded.username,
          updated_at = excluded.updated_at
        `,
      )
      .run({
        user_id: user.id,
        first_name: user.first_name,
        last_name: user.last_name ?? null,
        username: user.username ?? null,
        now,
      });
    return this.getByUserId(user.id)!;
  }

  setTopicId(userId: number, topicId: number): void {
    this.db
      .prepare(
        "UPDATE visitors SET topic_id = ?, updated_at = ? WHERE user_id = ?",
      )
      .run(topicId, Date.now(), userId);
  }

  clearTopicId(userId: number): void {
    this.db
      .prepare(
        "UPDATE visitors SET topic_id = NULL, updated_at = ? WHERE user_id = ?",
      )
      .run(Date.now(), userId);
  }

  ban(userId: number): void {
    this.db
      .prepare("UPDATE visitors SET banned = 1, updated_at = ? WHERE user_id = ?")
      .run(Date.now(), userId);
  }

  unban(userId: number): void {
    this.db
      .prepare("UPDATE visitors SET banned = 0, updated_at = ? WHERE user_id = ?")
      .run(Date.now(), userId);
  }

  close(): void {
    this.db.close();
  }
}
