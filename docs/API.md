# Keim File-Based API

Keim stores everything as plain Markdown files, making it trivially scriptable from any language. This document is the complete reference.

---

## Note Format

Every note is a `.md` file. Notes with Smart Fields have a YAML frontmatter block:

```markdown
---
Status: In Progress
Due: 2026-04-01
Priority: High
Done: false
---

Your regular markdown body goes here.
```

- The frontmatter block is delimited by `---` on its own line.
- Every field is a simple `key: value` pair (one per line).
- The body is everything after the closing `---`.
- Notes without any Smart Fields have no frontmatter block.

---

## Field Types

| Type       | YAML Example                | Notes                                              |
|------------|-----------------------------|----------------------------------------------------|
| `text`     | `Author: Jane Doe`          | Free-form string. URLs are auto-linked in the UI.  |
| `number`   | `Pages: 320`                | Stored as a string; parsed as float when sorting.  |
| `date`     | `Due: 2026-04-01`           | ISO 8601 format (`YYYY-MM-DD`). Used by Calendar view. |
| `checkbox` | `Done: true`                | `true` or `false` (lowercase).                     |
| `select`   | `Status: In Progress`       | Value must match one of the options in the schema. |
| `relation` | `Project: Website Redesign` | Value is the exact title of the referenced note.   |

---

## Folder & Schema Structure

```
My Vault/
├── Projects/                    ← Smart Folder
│   ├── .keim-schema.json        ← Schema sidecar (auto-managed by Keim)
│   ├── Website Redesign.md
│   └── Mobile App.md
├── Journal/
│   └── 2026-03-15.md
└── README.md
```

### `.keim-schema.json` Format

```json
{
  "version": 1,
  "fields": [
    { "name": "Status",   "type": "select",   "options": ["Todo", "In Progress", "Done"] },
    { "name": "Due",      "type": "date" },
    { "name": "Priority", "type": "select",   "options": ["Low", "Medium", "High"] },
    { "name": "Done",     "type": "checkbox" },
    { "name": "Notes",    "type": "text" },
    { "name": "Budget",   "type": "number" },
    { "name": "Client",   "type": "relation" }
  ]
}
```

> **Note:** You should not edit `.keim-schema.json` manually while Keim is running. Use the Smart Folder editor inside the app. External edits are picked up on the next vault sync.

---

## External Integration Examples

### Python — Bulk Update a Field

```python
from pathlib import Path
import re

vault = Path("/path/to/My Vault/Projects")

for note in vault.glob("*.md"):
    text = note.read_text()
    # Add or update a "Reviewed" checkbox field
    if text.startswith("---"):
        if "Reviewed:" not in text:
            text = text.replace("---\n", "---\nReviewed: false\n", 1)
    else:
        text = "---\nReviewed: false\n---\n" + text
    note.write_text(text)

print("Done.")
```

### Python — Export All Notes to CSV

```python
from pathlib import Path
import csv, re

vault = Path("/path/to/My Vault/Projects")
rows = []

for note in vault.glob("*.md"):
    text = note.read_text()
    meta = {}
    m = re.match(r"^---\n([\s\S]*?)\n---", text)
    if m:
        for line in m.group(1).splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip()
    meta["__title__"] = note.stem
    rows.append(meta)

with open("export.csv", "w", newline="") as f:
    keys = sorted({k for r in rows for k in r})
    w = csv.DictWriter(f, fieldnames=keys)
    w.writeheader()
    w.writerows(rows)
```

### Raycast Script Hint

Create a Raycast script that opens a specific note by title:

```bash
#!/bin/bash
# @raycast.title Open Keim Note
# @raycast.argument1 { "type": "text", "placeholder": "Note title" }
open "https://cubeseven.github.io/keim/#search=$1"
```

---

## Conventions

- **File names** map directly to note titles. Renaming a file in Finder renames the note.
- **Folder names** map to folder titles. Nesting is supported to any depth.
- **Icons** are stored as YAML fields internally but are NOT in the `.md` file — they live only in Keim's IndexedDB. External tools cannot set icons.
- **Tags** are also stored in IndexedDB only and are not written to frontmatter.
- **Schema changes** (adding/removing fields) only affect what Keim displays — they do not rewrite existing note files.
