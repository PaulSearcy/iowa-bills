#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const HEADER_ALIASES = {
  date: "date",
  chamber: "chamber",
  legislation: "legislation",
  "legislation title": "legislationTitle",
  ayes: "ayes",
  nays: "nays",
  "absent or not voting": "absentOrNotVoting",
};

const DEFAULT_INPUTS = ["2025session.xlsx", "2026sessions.xlsx"];

function parseArgs(argv) {
  const inputs = [];
  let outDir = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out" || arg === "-o") {
      outDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    inputs.push(arg);
  }

  return {
    inputs: inputs.length > 0 ? inputs : DEFAULT_INPUTS,
    outDir,
  };
}

function cellText(cell) {
  if (!cell) return "";
  if (cell.w != null && String(cell.w).trim() !== "") return String(cell.w).trim();
  if (cell.v == null) return "";
  return String(cell.v).trim();
}

function parseLabeledValue(text, label) {
  const prefix = `${label}:`;
  if (!text.toLowerCase().startsWith(label.toLowerCase() + ":")) return null;
  return text.slice(prefix.length).trim();
}

function toInteger(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function normalizeHeader(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function findHeaderRow(sheet, range) {
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const first = cellText(sheet[XLSX.utils.encode_cell({ r, c: range.s.c })]);
    if (normalizeHeader(first) === "date") return r;
  }
  throw new Error("Could not find a header row starting with Date");
}

function mapHeaders(sheet, range, headerRow) {
  const headers = [];
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const raw = cellText(sheet[XLSX.utils.encode_cell({ r: headerRow, c })]);
    const key = HEADER_ALIASES[normalizeHeader(raw)];
    headers.push(key ?? null);
  }
  if (!headers.includes("date") || !headers.includes("legislation")) {
    throw new Error("Header row is missing required Date or Legislation columns");
  }
  return headers;
}

function extractMetadata(sheet, range, headerRow) {
  const metadata = {
    title: null,
    chamber: null,
    beginDate: null,
    endDate: null,
    voteCount: null,
  };

  for (let r = range.s.r; r < headerRow; r += 1) {
    const text = cellText(sheet[XLSX.utils.encode_cell({ r, c: range.s.c })]);
    if (!text) continue;

    const chamber = parseLabeledValue(text, "Chamber");
    const beginDate = parseLabeledValue(text, "Begin Date");
    const endDate = parseLabeledValue(text, "End Date");
    const voteCount = parseLabeledValue(text, "Vote Count");

    if (chamber != null) metadata.chamber = chamber;
    else if (beginDate != null) metadata.beginDate = beginDate;
    else if (endDate != null) metadata.endDate = endDate;
    else if (voteCount != null) metadata.voteCount = toInteger(voteCount);
    else if (!metadata.title) metadata.title = text;
  }

  return metadata;
}

function decodeHtmlEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function cellHyperlink(cell) {
  const target = cell?.l?.Target;
  if (typeof target !== "string" || !target.trim()) return null;
  return decodeHtmlEntities(target.trim());
}

function convertWorkbook(filePath) {
  const workbook = XLSX.read(readFileSync(filePath), {
    type: "buffer",
    cellDates: false,
    cellNF: false,
    cellText: true,
  });

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`No worksheets found in ${filePath}`);
  }

  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const headerRow = findHeaderRow(sheet, range);
  const headers = mapHeaders(sheet, range, headerRow);
  const metadata = extractMetadata(sheet, range, headerRow);
  const votes = [];

  for (let r = headerRow + 1; r <= range.e.r; r += 1) {
    const row = {};
    let hasValue = false;

    headers.forEach((key, index) => {
      if (!key) return;
      const cell = sheet[XLSX.utils.encode_cell({ r, c: range.s.c + index })];
      const text = cellText(cell);
      if (text) hasValue = true;

      if (key === "ayes" || key === "nays" || key === "absentOrNotVoting") {
        row[key] = toInteger(cell?.v ?? text);
      } else {
        row[key] = text || null;
      }

      if (key === "legislation") {
        row.floorVoteUrl = cellHyperlink(cell);
      }
    });

    if (hasValue) votes.push(row);
  }

  return {
    sourceFile: basename(filePath),
    sheetName,
    ...metadata,
    votes,
  };
}

function outputPathFor(filePath, outDir) {
  const jsonName = basename(filePath).replace(/\.xlsx$/i, ".json");
  return join(outDir, jsonName);
}

function main() {
  const { inputs, outDir: requestedOutDir } = parseArgs(process.argv.slice(2));
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const outDir = resolve(requestedOutDir ?? scriptDir);

  mkdirSync(outDir, { recursive: true });

  for (const input of inputs) {
    const filePath = resolve(scriptDir, input);
    const result = convertWorkbook(filePath);
    const dest = outputPathFor(filePath, outDir);
    writeFileSync(dest, `${JSON.stringify(result, null, 2)}\n`);
    console.log(
      `Wrote ${dest} (${result.votes.length} votes from ${result.sourceFile})`,
    );
  }
}

main();
