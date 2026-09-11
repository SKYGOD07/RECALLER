"""RECALLER — SQLite repository.

One file, WAL mode, foreign keys on. Records are stored whole as JSON because
the pipeline is deterministic and a record is an immutable fact once written;
the columns beside it exist only for listing and filtering. Uploaded file bytes
live on disk under ``uploads/``; their extracted text lives in ``document_text``.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS applications (
  id          TEXT PRIMARY KEY,
  header      TEXT NOT NULL,
  status      TEXT NOT NULL,
  decision    TEXT,
  custom      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  id           TEXT PRIMARY KEY,
  app_id       TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  filename     TEXT NOT NULL,
  source       TEXT NOT NULL,            -- synthetic | upload
  media_type   TEXT,
  size_bytes   INTEGER,
  page_count   INTEGER,
  sha256       TEXT,
  storage_path TEXT,
  text_chars   INTEGER NOT NULL DEFAULT 0,
  scanned      INTEGER NOT NULL DEFAULT 0,
  meta         TEXT NOT NULL DEFAULT '{}',
  uploaded_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_app ON documents(app_id);
CREATE TABLE IF NOT EXISTS document_text (
  doc_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  pages  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
  app_id     TEXT PRIMARY KEY REFERENCES applications(id) ON DELETE CASCADE,
  record     TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS replays (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  result  TEXT NOT NULL,
  ran_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_runs (
  id          TEXT PRIMARY KEY,
  app_id      TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  status      TEXT NOT NULL,
  provider    TEXT,
  model       TEXT,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  output      TEXT,
  error       TEXT
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str, separators=(",", ":"))


class Database:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA foreign_keys=ON")
            self._conn.executescript(SCHEMA)

    # -- primitives ---------------------------------------------------------

    def _exec(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Cursor:
        with self._lock:
            return self._conn.execute(sql, tuple(params))

    def _all(self, sql: str, params: Iterable[Any] = ()) -> List[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(sql, tuple(params)).fetchall()

    def _one(self, sql: str, params: Iterable[Any] = ()) -> Optional[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(sql, tuple(params)).fetchone()

    def transaction(self):
        return _Tx(self)

    # -- meta ---------------------------------------------------------------

    def get_meta(self, key: str, default: Optional[str] = None) -> Optional[str]:
        row = self._one("SELECT value FROM meta WHERE key=?", (key,))
        return row["value"] if row else default

    def set_meta(self, key: str, value: str) -> None:
        self._exec("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))

    def next_sequence(self, start: int = 500) -> int:
        with self._lock:
            n = int(self.get_meta("app_sequence", str(start)) or start) + 1
            self.set_meta("app_sequence", str(n))
            return n

    # -- applications -------------------------------------------------------

    def save_application(self, header: Dict[str, Any]) -> None:
        self._exec(
            """INSERT INTO applications(id,header,status,decision,custom,created_at,updated_at)
               VALUES(?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET header=excluded.header, status=excluded.status,
                 decision=excluded.decision, updated_at=excluded.updated_at""",
            (
                header["id"],
                _dumps(header),
                header.get("status", "DRAFT"),
                header.get("decision"),
                1 if header.get("custom") else 0,
                header.get("created_at") or now_iso(),
                header.get("updated_at") or now_iso(),
            ),
        )

    def get_application(self, app_id: str) -> Optional[Dict[str, Any]]:
        row = self._one("SELECT header FROM applications WHERE id=?", (app_id,))
        return json.loads(row["header"]) if row else None

    def list_applications(self) -> List[Dict[str, Any]]:
        return [json.loads(r["header"]) for r in self._all("SELECT header FROM applications ORDER BY created_at DESC, id DESC")]

    def delete_application(self, app_id: str) -> bool:
        return self._exec("DELETE FROM applications WHERE id=?", (app_id,)).rowcount > 0

    # -- documents ----------------------------------------------------------

    def add_document(self, doc: Dict[str, Any], pages: Optional[List[str]] = None) -> None:
        with self._lock:
            self._exec(
                """INSERT INTO documents(id,app_id,type,filename,source,media_type,size_bytes,page_count,sha256,
                   storage_path,text_chars,scanned,meta,uploaded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    doc["id"], doc["app_id"], doc["type"], doc["filename"], doc["source"], doc.get("media_type"),
                    doc.get("size_bytes"), doc.get("page_count"), doc.get("sha256"), doc.get("storage_path"),
                    doc.get("text_chars", 0), 1 if doc.get("scanned") else 0, _dumps(doc.get("meta") or {}),
                    doc.get("uploaded_at") or now_iso(),
                ),
            )
            if pages is not None:
                self._exec("INSERT INTO document_text(doc_id,pages) VALUES(?,?)", (doc["id"], _dumps(pages)))

    def list_documents(self, app_id: str) -> List[Dict[str, Any]]:
        return [self._doc(r) for r in self._all("SELECT * FROM documents WHERE app_id=? ORDER BY uploaded_at, id", (app_id,))]

    def get_document(self, doc_id: str) -> Optional[Dict[str, Any]]:
        row = self._one("SELECT * FROM documents WHERE id=?", (doc_id,))
        return self._doc(row) if row else None

    def get_document_text(self, doc_id: str) -> Optional[List[str]]:
        row = self._one("SELECT pages FROM document_text WHERE doc_id=?", (doc_id,))
        return json.loads(row["pages"]) if row else None

    def delete_document(self, doc_id: str) -> bool:
        return self._exec("DELETE FROM documents WHERE id=?", (doc_id,)).rowcount > 0

    @staticmethod
    def _doc(row: sqlite3.Row) -> Dict[str, Any]:
        d = dict(row)
        d["meta"] = json.loads(d.get("meta") or "{}")
        d["scanned"] = bool(d.get("scanned"))
        return d

    # -- records, replays, agent runs --------------------------------------

    def save_record(self, app_id: str, record: Dict[str, Any]) -> None:
        self._exec(
            "INSERT INTO records(app_id,record,updated_at) VALUES(?,?,?) "
            "ON CONFLICT(app_id) DO UPDATE SET record=excluded.record, updated_at=excluded.updated_at",
            (app_id, _dumps(record), now_iso()),
        )

    def get_record(self, app_id: str) -> Optional[Dict[str, Any]]:
        row = self._one("SELECT record FROM records WHERE app_id=?", (app_id,))
        return json.loads(row["record"]) if row else None

    def delete_record(self, app_id: str) -> None:
        self._exec("DELETE FROM records WHERE app_id=?", (app_id,))

    def add_replay(self, app_id: str, result: Dict[str, Any]) -> None:
        self._exec("INSERT INTO replays(app_id,result,ran_at) VALUES(?,?,?)", (app_id, _dumps(result), now_iso()))

    def list_replays(self, app_id: str, limit: int = 12) -> List[Dict[str, Any]]:
        rows = self._all("SELECT result FROM replays WHERE app_id=? ORDER BY id DESC LIMIT ?", (app_id, limit))
        return [json.loads(r["result"]) for r in rows]

    def save_agent_run(self, run: Dict[str, Any]) -> None:
        self._exec(
            """INSERT INTO agent_runs(id,app_id,kind,status,provider,model,started_at,finished_at,output,error)
               VALUES(?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET status=excluded.status, finished_at=excluded.finished_at,
                 output=excluded.output, error=excluded.error""",
            (
                run["id"], run["app_id"], run["kind"], run["status"], run.get("provider"), run.get("model"),
                run.get("started_at") or now_iso(), run.get("finished_at"),
                _dumps(run["output"]) if run.get("output") is not None else None, run.get("error"),
            ),
        )

    def list_agent_runs(self, app_id: str) -> List[Dict[str, Any]]:
        out = []
        for r in self._all("SELECT * FROM agent_runs WHERE app_id=? ORDER BY started_at DESC", (app_id,)):
            d = dict(r)
            d["output"] = json.loads(d["output"]) if d.get("output") else None
            out.append(d)
        return out

    # -- housekeeping -------------------------------------------------------

    def counts(self) -> Dict[str, int]:
        return {
            t: self._one(f"SELECT COUNT(*) AS n FROM {t}")["n"]
            for t in ("applications", "documents", "records", "replays", "agent_runs")
        }

    def wipe(self) -> None:
        with self._lock:
            for t in ("agent_runs", "replays", "records", "document_text", "documents", "applications"):
                self._exec(f"DELETE FROM {t}")

    def close(self) -> None:
        with self._lock:
            self._conn.close()


class _Tx:
    def __init__(self, db: Database) -> None:
        self.db = db

    def __enter__(self) -> Database:
        self.db._lock.acquire()
        self.db._conn.execute("BEGIN")
        return self.db

    def __exit__(self, exc_type, exc, tb) -> None:
        try:
            self.db._conn.execute("ROLLBACK" if exc_type else "COMMIT")
        finally:
            self.db._lock.release()
