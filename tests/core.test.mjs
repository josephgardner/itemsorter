import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const core = require("../core.js");

const EXPORT_VERSION = "ITEMSORTER v1";
const STATUSES = ["ready to use", "good", "unused", "clogged", "down"];
const DEFAULT_STATUS = "ready to use";
const FIXED_TIME = () => 1700000000000;

const sourceState = {
  printers: [
    { id: "printer_1", name: "Printer A", status: "ready to use" },
    { id: "printer_2", name: "Printer B", status: "good" },
  ],
  active: [
    { id: "request_1", title: "Benchy", printerId: "printer_1", createdAt: 1 },
    { id: "request_2", title: "Calibration Cube", printerId: "printer_2", createdAt: 2 },
  ],
  unassigned: [{ id: "request_3", title: "Spare Part", printerId: null, createdAt: 3 }],
  printed: [{ id: "request_4", title: "Old Print", printerId: "printer_2", createdAt: 4, printedAt: 5 }],
};

function printerById(id) {
  return sourceState.printers.find((printer) => printer.id === id) || null;
}

function summarizeState(state) {
  const printerNameById = new Map(state.printers.map((printer) => [printer.id, printer.name]));

  return {
    printers: state.printers.map((printer) => [printer.name, printer.status]),
    active: state.active.map((request) => [request.title, printerNameById.get(request.printerId) || null]),
    unassigned: state.unassigned.map((request) => request.title),
    printed: state.printed.map((request) => [request.title, printerNameById.get(request.printerId) || null]),
  };
}

test("cleanText normalizes pipes and newlines", () => {
  assert.equal(core.cleanText("  hello | world\nnext  "), "hello / world next");
});

test("text export and import round-trip", () => {
  const text = core.serializeTextState(sourceState, printerById, EXPORT_VERSION);
  const parsed = core.parseTextState(text, {
    exportVersion: EXPORT_VERSION,
    statuses: STATUSES,
    defaultStatus: DEFAULT_STATUS,
    now: FIXED_TIME,
  });

  assert.equal(text.endsWith("\n"), true);
  assert.deepEqual(summarizeState(parsed), summarizeState(sourceState));
  assert.equal(parsed.internalId > 0, true);
});

test("text import skips duplicate printer names", () => {
  const parsed = core.parseTextState(
    [
      EXPORT_VERSION,
      "",
      "PRINTERS",
      "Printer A | ready to use",
      "printer a | good",
      "Printer B | unused",
      "",
      "ACTIVE",
      "Widget | Printer A",
    ].join("\n"),
    {
      exportVersion: EXPORT_VERSION,
      statuses: STATUSES,
      defaultStatus: DEFAULT_STATUS,
      now: FIXED_TIME,
    }
  );

  assert.deepEqual(
    parsed.printers.map((printer) => [printer.name, printer.status]),
    [
      ["Printer A", "ready to use"],
      ["Printer B", "unused"],
    ]
  );
  assert.equal(parsed.active[0].printerId, parsed.printers[0].id);
});

test("compressed share payload round-trips", async () => {
  const shareState = core.buildShareState(sourceState, printerById, 42);
  const encoded = await core.compressText(JSON.stringify(shareState));
  const decoded = await core.decompressText(encoded);
  const parsed = core.parseShareState(JSON.parse(decoded), {
    statuses: STATUSES,
    defaultStatus: DEFAULT_STATUS,
    now: FIXED_TIME,
  });

  assert.equal(typeof encoded, "string");
  assert.equal(encoded.includes("."), true);
  assert.deepEqual(summarizeState(parsed), summarizeState(sourceState));
  assert.equal(parsed.internalId >= 42, true);
});

test("share import skips duplicate printer names", () => {
  const parsed = core.parseShareState(
    {
      v: 1,
      i: 99,
      p: [
        ["Printer A", "ready to use"],
        ["printer a", "good"],
        ["Printer B", "unused"],
      ],
      a: [["Widget", "Printer A"]],
      u: [],
      d: [],
    },
    {
      statuses: STATUSES,
      defaultStatus: DEFAULT_STATUS,
      now: FIXED_TIME,
    }
  );

  assert.deepEqual(
    parsed.printers.map((printer) => [printer.name, printer.status]),
    [
      ["Printer A", "ready to use"],
      ["Printer B", "unused"],
    ]
  );
  assert.equal(parsed.active[0].printerId, parsed.printers[0].id);
  assert.equal(parsed.internalId, 99);
});
