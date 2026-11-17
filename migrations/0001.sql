CREATE TABLE notes (
 id TEXT PRIMARY KEY,
 slug TEXT NOT NULL UNIQUE,
 title TEXT NOT NULL,
 content TEXT NOT NULL,
 edit_hash TEXT NOT NULL,
 password_hash TEXT,
 version INTEGER NOT NULL DEFAULT 1,
 views INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX notes_expiry ON notes(expires_at);
CREATE INDEX notes_updated ON notes(updated_at DESC, id);
CREATE TABLE note_aliases (
 slug TEXT PRIMARY KEY,
 note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE
);

CREATE TRIGGER notes_insert_alias AFTER INSERT ON notes
BEGIN
 INSERT INTO note_aliases(slug, note_id) VALUES (NEW.slug, NEW.id);
END;
CREATE TRIGGER notes_update_alias BEFORE UPDATE OF slug ON notes WHEN NEW.slug != OLD.slug
BEGIN
 SELECT RAISE(ABORT, 'slug already in use') WHERE EXISTS (
   SELECT 1 FROM note_aliases WHERE slug = NEW.slug AND note_id != NEW.id
 );
 INSERT OR IGNORE INTO note_aliases(slug, note_id) VALUES (NEW.slug, NEW.id);
END;
