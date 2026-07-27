# Create `user_tu` Upsert SQL From `tu_user.csv`

This guide explains how to generate a PostgreSQL upsert SQL file from `tu_user.csv`.

## Input

Use a CSV file named `tu_user.csv` with these headers:

```csv
tu_id,telegram_chat_id,telegram_username,telegram_user_id,tu_name,path
```

## Output

Generate this SQL file:

```text
tu_user_upsert.sql
```

The output inserts rows into the PostgreSQL table `user_tu` and updates existing rows when the same `tu_id` already exists.

## Rules

- Target table: `user_tu`
- Conflict key: `tu_id`
- Default status: `active`
- `telegram_username` must be lowercased.
- `telegram_username` must not include the leading `@`.
- Empty `telegram_username` values become `NULL`.
- Empty numeric values become `NULL`.
- Text values must escape single quotes for SQL.

Example username transformations:

```text
@Esther3418 -> esther3418
@Qwnsberry  -> qwnsberry
             -> NULL
```

## Generate The SQL

Run this from the project root:

```bash
python3 - <<'PY'
import csv
from pathlib import Path

csv_path = Path('tu_user.csv')
out_path = Path('tu_user_upsert.sql')

with csv_path.open(newline='', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    rows = list(reader)

def sql_text(value):
    if value is None or value == '':
        return 'NULL'
    return "'" + value.replace("'", "''") + "'"

def sql_int(value):
    if value is None or value == '':
        return 'NULL'
    return value

def normalize_username(value):
    value = (value or '').strip()
    if not value:
        return None
    return value.lstrip('@').lower()

columns = [
    'tu_id',
    'tu_name',
    'path',
    'telegram_user_id',
    'telegram_chat_id',
    'telegram_username',
    'status',
]

value_lines = []
for row in rows:
    username = normalize_username(row.get('telegram_username'))
    values = [
        sql_text(row['tu_id']),
        sql_text(row['tu_name']),
        sql_text(row['path']),
        sql_int(row['telegram_user_id']),
        sql_int(row['telegram_chat_id']),
        sql_text(username),
        sql_text('active'),
    ]
    value_lines.append('  (' + ', '.join(values) + ')')

quoted_columns = ', '.join(f'"{column}"' for column in columns)
update_columns = [
    'tu_name',
    'path',
    'telegram_user_id',
    'telegram_chat_id',
    'telegram_username',
    'status',
]
update_lines = [f'  "{column}" = EXCLUDED."{column}"' for column in update_columns]
update_lines.append('  "updated_at" = CURRENT_TIMESTAMP')

sql = '\n'.join([
    f'INSERT INTO "user_tu" ({quoted_columns}) VALUES',
    ',\n'.join(value_lines),
    'ON CONFLICT ("tu_id") DO UPDATE SET',
    ',\n'.join(update_lines) + ';',
    '',
])

out_path.write_text(sql, encoding='utf-8')
print(f'wrote {out_path} with {len(rows)} rows')
PY
```

## Validate The SQL

Run a quick local syntax and normalization check:

```bash
python3 - <<'PY'
import sqlite3
from pathlib import Path

sql = Path('tu_user_upsert.sql').read_text(encoding='utf-8')

con = sqlite3.connect(':memory:')
con.execute('''
CREATE TABLE "user_tu" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "tu_id" TEXT NOT NULL UNIQUE,
  "tu_name" TEXT NOT NULL,
  "path" TEXT,
  "telegram_user_id" INTEGER NOT NULL,
  "telegram_chat_id" INTEGER NOT NULL,
  "telegram_username" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  UNIQUE ("telegram_user_id", "telegram_chat_id")
)
''')

con.executescript(sql)
count = con.execute('SELECT COUNT(*) FROM "user_tu"').fetchone()[0]
bad = con.execute(
    'SELECT COUNT(*) FROM "user_tu" '
    'WHERE "telegram_username" LIKE ? '
    'OR "telegram_username" != lower("telegram_username")',
    ('%@%',),
).fetchone()[0]

print(f'syntax ok; inserted/upserted {count} rows; bad usernames {bad}')
PY
```

The expected result is:

```text
bad usernames 0
```

## Apply To PostgreSQL

After reviewing `tu_user_upsert.sql`, apply it to the configured database:

```bash
psql "$DATABASE_URL" -f tu_user_upsert.sql
```

## Upsert Shape

The generated SQL uses this structure:

```sql
INSERT INTO "user_tu" (
  "tu_id",
  "tu_name",
  "path",
  "telegram_user_id",
  "telegram_chat_id",
  "telegram_username",
  "status"
) VALUES
  (...)
ON CONFLICT ("tu_id") DO UPDATE SET
  "tu_name" = EXCLUDED."tu_name",
  "path" = EXCLUDED."path",
  "telegram_user_id" = EXCLUDED."telegram_user_id",
  "telegram_chat_id" = EXCLUDED."telegram_chat_id",
  "telegram_username" = EXCLUDED."telegram_username",
  "status" = EXCLUDED."status",
  "updated_at" = CURRENT_TIMESTAMP;
```
