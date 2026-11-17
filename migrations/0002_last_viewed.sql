ALTER TABLE notes ADD COLUMN last_viewed_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX notes_last_viewed ON notes(last_viewed_at);
