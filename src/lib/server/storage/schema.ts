export const schemaSql = `
CREATE TABLE IF NOT EXISTS reviews (
	id TEXT PRIMARY KEY,
	title TEXT NOT NULL,
	repo_root TEXT NOT NULL,
	source_kind TEXT NOT NULL,
	source_ref TEXT,
	status TEXT NOT NULL,
	created_by TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_versions (
	id TEXT PRIMARY KEY,
	review_id TEXT NOT NULL REFERENCES reviews(id),
	version INTEGER NOT NULL,
	base_commit TEXT,
	head_commit TEXT,
	diff_path TEXT NOT NULL,
	files_path TEXT NOT NULL,
	created_at TEXT NOT NULL,
	UNIQUE(review_id, version)
);

CREATE TABLE IF NOT EXISTS comments (
	id TEXT PRIMARY KEY,
	review_id TEXT NOT NULL REFERENCES reviews(id),
	version INTEGER NOT NULL,
	file_path TEXT,
	side TEXT NOT NULL,
	line_start INTEGER,
	line_end INTEGER,
	body TEXT NOT NULL,
	author TEXT NOT NULL,
	status TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
	id TEXT PRIMARY KEY,
	review_id TEXT NOT NULL REFERENCES reviews(id),
	kind TEXT NOT NULL,
	payload_json TEXT NOT NULL,
	created_at TEXT NOT NULL
);
`;
