'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const file = path.join(os.tmpdir(), `sqlite-check-${process.pid}.db`);
const db = new DatabaseSync(file);

try {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL) STRICT');
    db.prepare('INSERT INTO t (v) VALUES (?)').run('ok');

    db.exec('BEGIN');
    db.prepare('INSERT INTO t (v) VALUES (?)').run('wird zurückgerollt');
    db.exec('ROLLBACK');

    const count = db.prepare('SELECT COUNT(*) AS n FROM t').get().n;
    const version = db.prepare('SELECT sqlite_version() AS v').get().v;
    const mode = db.prepare('PRAGMA journal_mode').get().journal_mode;

    console.log(
        `Node ${process.version} | SQLite ${version} | journal_mode=${mode} | Zeilen=${count} (erwartet: 1)`
    );

    if (count !== 1) throw new Error('Rollback hat nicht funktioniert.');
    console.log('OK: node:sqlite funktioniert (Datei, WAL, Transaktion).');
} finally {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
        fs.rmSync(file + suffix, { force: true });
    }
}
