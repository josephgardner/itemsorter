(function (root, factory) {
  const api = factory();
  root.ItemSorterCore = api;
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function cleanText(value) {
    return String(value ?? "")
      .replaceAll("|", "/")
      .replaceAll(/\r?\n/g, " ")
      .trim();
  }

  function bytesToBase64Url(bytes) {
    let binary = "";

    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }

    const base64 =
      typeof btoa === "function"
        ? btoa(binary)
        : Buffer.from(binary, "binary").toString("base64");

    return base64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  }

  function base64UrlToBytes(value) {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/");
    const base64 = padded + "=".repeat((4 - (padded.length % 4)) % 4);
    const binary =
      typeof atob === "function"
        ? atob(base64)
        : Buffer.from(base64, "base64").toString("binary");
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }

  async function compressText(text) {
    const rawBytes = new TextEncoder().encode(text);
    const rawEncoded = bytesToBase64Url(rawBytes);

    if (typeof CompressionStream === "undefined") {
      return `plain.${rawEncoded}`;
    }

    const compressedStream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
    const compressedBytes = new Uint8Array(await new Response(compressedStream).arrayBuffer());
    const compressedEncoded = bytesToBase64Url(compressedBytes);

    if (compressedEncoded.length >= rawEncoded.length) {
      return `plain.${rawEncoded}`;
    }

    return `gzip.${compressedEncoded}`;
  }

  async function decompressText(value) {
    const dotIndex = value.indexOf(".");
    if (dotIndex === -1) {
      throw new Error("Invalid share payload");
    }

    const codec = value.slice(0, dotIndex);
    const payload = value.slice(dotIndex + 1);
    const bytes = base64UrlToBytes(payload);

    if (codec === "plain") {
      return new TextDecoder().decode(bytes);
    }

    if (codec === "gzip") {
      if (typeof DecompressionStream === "undefined") {
        throw new Error("Compression unsupported");
      }

      const decompressedStream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      return await new Response(decompressedStream).text();
    }

    throw new Error("Unknown share codec");
  }

  function serializeTextState(state, getPrinterById, exportVersion) {
    const lines = [exportVersion, ""];

    lines.push("PRINTERS");
    for (const printer of state.printers) {
      lines.push(`${printer.name} | ${printer.status}`);
    }

    lines.push("");
    lines.push("ACTIVE");
    for (const request of state.active) {
      const printer = getPrinterById(request.printerId);
      lines.push(printer ? `${request.title} | ${printer.name}` : request.title);
    }

    lines.push("");
    lines.push("UNASSIGNED");
    for (const request of state.unassigned) {
      lines.push(request.title);
    }

    lines.push("");
    lines.push("PRINTED");
    for (const request of state.printed) {
      const printer = getPrinterById(request.printerId);
      lines.push(printer ? `${request.title} | ${printer.name}` : request.title);
    }

    return lines.join("\n").trimEnd() + "\n";
  }

  function parseTextState(text, options) {
    const {
      exportVersion,
      statuses,
      defaultStatus,
      now = () => Date.now(),
    } = options;

    const parsed = {
      printers: [],
      active: [],
      unassigned: [],
      printed: [],
      internalId: 1,
    };

    let section = "";
    const printerByName = new Map();
    let nextId = 1;

    const genId = (prefix) => `${prefix}_${nextId++}`;
    const validStatuses = new Set(statuses);

    const lines = String(text)
      .replaceAll("\r\n", "\n")
      .split("\n");

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      const normalized = line.toUpperCase();
      if (normalized === exportVersion) {
        continue;
      }

      if (normalized === "PRINTERS" || normalized === "ACTIVE" || normalized === "UNASSIGNED" || normalized === "PRINTED") {
        section = normalized;
        continue;
      }

      const cleaned = line.startsWith("-") ? line.slice(1).trim() : line;
      const parts = cleaned
        .split("|")
        .map((part) => part.trim())
        .filter(Boolean);

      if (section === "PRINTERS") {
        const name = cleanText(parts[0] || cleaned);
        const status = validStatuses.has((parts[1] || defaultStatus).toLowerCase())
          ? (parts[1] || defaultStatus).toLowerCase()
          : defaultStatus;
        if (!name) {
          continue;
        }
        const printer = {
          id: genId("printer"),
          name,
          status,
        };
        parsed.printers.push(printer);
        printerByName.set(name.toLowerCase(), printer);
        continue;
      }

      if (section === "ACTIVE" || section === "PRINTED") {
        const title = cleanText(parts[0] || cleaned);
        const printerName = cleanText(parts[1] || "");
        if (!title) {
          continue;
        }
        const timestamp = now();
        const printer = printerName ? printerByName.get(printerName.toLowerCase()) || null : null;
        const request = {
          id: genId("request"),
          title,
          printerId: printer ? printer.id : null,
          createdAt: timestamp,
        };
        if (section === "ACTIVE") {
          parsed.active.push(request);
        } else {
          parsed.printed.push({
            ...request,
            printedAt: timestamp,
          });
        }
        continue;
      }

      if (section === "UNASSIGNED") {
        const title = cleanText(parts[0] || cleaned);
        if (!title) {
          continue;
        }
        parsed.unassigned.push({
          id: genId("request"),
          title,
          printerId: null,
          createdAt: now(),
        });
      }
    }

    parsed.internalId = nextId;
    return parsed;
  }

  function buildShareState(state, getPrinterById, internalId) {
    return {
      v: 1,
      i: internalId,
      p: state.printers.map((printer) => [printer.name, printer.status]),
      a: state.active.map((request) => [request.title, getPrinterById(request.printerId)?.name || ""]),
      u: state.unassigned.map((request) => request.title),
      d: state.printed.map((request) => [request.title, getPrinterById(request.printerId)?.name || ""]),
    };
  }

  function parseShareState(data, options) {
    const {
      statuses,
      defaultStatus,
      now = () => Date.now(),
    } = options;

    if (!data || typeof data !== "object" || data.v !== 1) {
      return null;
    }

    const parsed = {
      printers: [],
      active: [],
      unassigned: [],
      printed: [],
      internalId: 1,
    };

    const printerByName = new Map();
    let nextId = 1;
    const genId = (prefix) => `${prefix}_${nextId++}`;
    const validStatuses = new Set(statuses);

    for (const entry of Array.isArray(data.p) ? data.p : []) {
      const name = cleanText(entry?.[0]);
      const status = cleanText(entry?.[1]).toLowerCase();
      if (!name) {
        continue;
      }

      const printer = {
        id: genId("printer"),
        name,
        status: validStatuses.has(status) ? status : defaultStatus,
      };
      parsed.printers.push(printer);
      printerByName.set(name.toLowerCase(), printer);
    }

    for (const entry of Array.isArray(data.a) ? data.a : []) {
      const title = cleanText(entry?.[0]);
      const printerName = cleanText(entry?.[1]).toLowerCase();
      if (!title) {
        continue;
      }

      const timestamp = now();
      parsed.active.push({
        id: genId("request"),
        title,
        printerId: printerByName.get(printerName)?.id || null,
        createdAt: timestamp,
      });
    }

    for (const entry of Array.isArray(data.u) ? data.u : []) {
      const title = cleanText(entry);
      if (!title) {
        continue;
      }

      parsed.unassigned.push({
        id: genId("request"),
        title,
        printerId: null,
        createdAt: now(),
      });
    }

    for (const entry of Array.isArray(data.d) ? data.d : []) {
      const title = cleanText(entry?.[0]);
      const printerName = cleanText(entry?.[1]).toLowerCase();
      if (!title) {
        continue;
      }

      const timestamp = now();
      parsed.printed.push({
        id: genId("request"),
        title,
        printerId: printerByName.get(printerName)?.id || null,
        createdAt: timestamp,
        printedAt: timestamp,
      });
    }

    const savedInternalId = Number(data.i);
    parsed.internalId = Math.max(Number.isFinite(savedInternalId) ? savedInternalId : 1, nextId);
    return parsed;
  }

  return {
    cleanText,
    bytesToBase64Url,
    base64UrlToBytes,
    compressText,
    decompressText,
    serializeTextState,
    parseTextState,
    buildShareState,
    parseShareState,
  };
});
