# Item Sorter

Static GitHub Pages app for managing printers, requests, and printed history.

## Storage

- Saves locally in the browser with `localStorage`
- Export/import uses a plain text format, not JSON
- Export file name: `itemsorter-backup.txt`

## Text format

```text
ITEMSORTER v1

PRINTERS
Alex | ready to use
Sam | good

ACTIVE
Benchy | Alex

UNASSIGNED
Spare Part

PRINTED
Old Cube | Sam
```

## GitHub Pages

The custom domain is set in [`CNAME`](./CNAME) to:

```text
itemsorter.algoplay.com
```
