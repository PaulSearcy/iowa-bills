import fs from 'fs';
import path from 'path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { writeVoteDataJs } from './compact-vote-data.js';

const DEFAULT_DELAY_MS = 300;
const CHECKPOINT_EVERY = 10;

function parseArgs(argv) {
  const args = {
    input: null,
    output: null,
    jsOutput: null,
    delayMs: DEFAULT_DELAY_MS,
    limit: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--input' || arg === '-i') {
      args.input = next;
      i += 1;
    } else if (arg === '--output' || arg === '-o') {
      args.output = next;
      i += 1;
    } else if (arg === '--js-output') {
      args.jsOutput = next;
      i += 1;
    } else if (arg === '--delay') {
      args.delayMs = Number(next);
      i += 1;
    } else if (arg === '--limit') {
      args.limit = Number(next);
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!args.input) {
    throw new Error('Missing --input path to session JSON');
  }
  if (!args.output) {
    throw new Error('Missing --output path for voter-enriched JSON');
  }
  return args;
}

async function fetchPdfData(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    
    const loadingTask = getDocument({ data });
    const pdf = await loadingTask.promise;
    
    // Get all text items with positions from all pages
    const allItems = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      for (const item of textContent.items) {
        if (item.str.trim()) {
          allItems.push({
            text: item.str.trim(),
            x: item.transform[4],
            y: item.transform[5],
            page: i
          });
        }
      }
    }
    
    return allItems;
  } catch (error) {
    console.error(`  Error fetching ${url}: ${error.message}`);
    return null;
  }
}

function parseHouseVotes(items) {
  const result = {
    yeas: [],
    nays: [],
    absentOrNotVoting: [],
    present: [],
    rule76: [],
    presiding: null,
    speaker: null
  };

  if (!items || items.length === 0) return result;

  // Join all text for House parsing (uses party prefixes which makes it simpler)
  const text = items.map(item => item.text).join(' ').replace(/\s+/g, ' ');
  
  // Extract PRESIDING and SPEAKER
  const presidingMatch = text.match(/PRESIDING\s*[-–—]\s*([A-Za-z\s]+?)(?=\s*SPEAKER|\s*$)/i);
  if (presidingMatch) {
    result.presiding = presidingMatch[1].trim();
  }
  
  const speakerMatch = text.match(/SPEAKER\s*[-–—]\s*([A-Za-z\s]+?)(?=\s*$)/i);
  if (speakerMatch) {
    result.speaker = speakerMatch[1].trim();
  }

  // Define section patterns for House (uses AYES, has party prefixes)
  const sections = [
    { name: 'yeas', startPattern: /AYES\s*[-–—]\s*\d+/i, endPatterns: [/NAYS\s*[-–—]/i, /ABSENT OR NOT VOTING/i, /RULE 76/i, /PRESIDING/i] },
    { name: 'nays', startPattern: /NAYS\s*[-–—]\s*\d+/i, endPatterns: [/ABSENT OR NOT VOTING/i, /RULE 76/i, /PRESIDING/i] },
    { name: 'absentOrNotVoting', startPattern: /ABSENT OR NOT VOTING\s*[-–—]?\s*\d*/i, endPatterns: [/RULE 76/i, /PRESIDING/i] },
    { name: 'rule76', startPattern: /RULE 76\s*[-–—]?\s*\d*/i, endPatterns: [/PRESIDING/i, /SPEAKER/i] }
  ];

  for (const section of sections) {
    const startMatch = text.match(section.startPattern);
    if (!startMatch) continue;

    const startIdx = startMatch.index + startMatch[0].length;
    
    let endIdx = text.length;
    for (const endPattern of section.endPatterns) {
      const endMatch = text.slice(startIdx).match(endPattern);
      if (endMatch && (startIdx + endMatch.index) < endIdx) {
        endIdx = startIdx + endMatch.index;
      }
    }

    const sectionText = text.slice(startIdx, endIdx);
    
    // Parse voters with party prefix: (R) or (D) or (I)
    const voterPattern = /\(([RDI])\)\s+([A-Za-z][A-Za-z0-9\-'.,\s]*?)(?=\s*\([RDI]\)|$)/g;
    let match;
    
    while ((match = voterPattern.exec(sectionText)) !== null) {
      const party = match[1];
      let name = match[2].trim();
      name = name.replace(/\s+/g, ' ').trim();
      name = name.replace(/[,.\s]+$/, '').trim();
      
      if (name && name.length > 1) {
        const partyFull = party === 'R' ? 'Republican' : party === 'D' ? 'Democrat' : 'Independent';
        result[section.name].push({
          name: name,
          party: partyFull,
          partyAbbr: party
        });
      }
    }
  }

  return result;
}

function parseSenateVotes(items) {
  const result = {
    yeas: [],
    nays: [],
    absentOrNotVoting: [],
    present: [],
    excused: [],
    presiding: null,
    president: null
  };

  if (!items || items.length === 0) return result;

  // Sort items by Y position (descending - top of page has higher Y)
  const sortedItems = [...items].sort((a, b) => b.y - a.y);
  
  // Find section headers and their Y positions
  const sectionHeaders = [];
  const headerPatterns = [
    { pattern: /^YEAS\s*[-–—]\s*\d+$/i, name: 'yeas' },
    { pattern: /^NAYS\s*[-–—]\s*\d+$/i, name: 'nays' },
    { pattern: /^PRESENT\s*[-–—]\s*\d+$/i, name: 'present' },
    { pattern: /^ABSENT OR NOT VOTING\s*[-–—]?\s*\d*$/i, name: 'absentOrNotVoting' },
    { pattern: /^EXCUSED\s*[-–—]\s*\d+$/i, name: 'excused' }
  ];
  
  for (const item of sortedItems) {
    for (const header of headerPatterns) {
      if (header.pattern.test(item.text)) {
        sectionHeaders.push({
          name: header.name,
          y: item.y,
          text: item.text
        });
        break;
      }
    }
  }
  
  // Sort section headers by Y (descending)
  sectionHeaders.sort((a, b) => b.y - a.y);
  
  // Assign items to sections based on Y position
  for (const item of sortedItems) {
    // Skip items that are section headers
    const isHeader = headerPatterns.some(h => h.pattern.test(item.text));
    if (isHeader) continue;
    
    // Skip other non-name items (headers, dates, etc.)
    if (/^(IOWA|SENATE|HOUSE|GENERAL|SESSION|DATE|TIME|SEQUENCE|RECORD|ROLL|CALL|STANDINGS|amended|by\s)/i.test(item.text)) continue;
    if (/^\d/.test(item.text)) continue; // Skip numbers (dates, sequence numbers, etc.)
    if (/^[A-Z]{2}\s*\d+/.test(item.text)) continue; // Skip bill numbers like "SF 659"
    if (item.text.length < 2) continue;
    
    // Find which section this item belongs to
    let section = null;
    for (let i = 0; i < sectionHeaders.length; i++) {
      const header = sectionHeaders[i];
      const nextHeader = sectionHeaders[i + 1];
      
      // Item is below this header (lower Y) and above the next header
      if (item.y < header.y && (!nextHeader || item.y > nextHeader.y)) {
        section = header.name;
        break;
      }
    }
    
    if (section && result[section]) {
      result[section].push({
        name: item.text,
        party: null,
        partyAbbr: null
      });
    }
  }

  return result;
}

function parseVoteData(items, chamber) {
  if (!items || items.length === 0) return null;
  
  // Check if this looks like a House or Senate format
  const fullText = items.map(i => i.text).join(' ');
  const isHouseFormat = fullText.includes('(R)') || fullText.includes('(D)') || /AYES\s*[-–—]\s*\d+/i.test(fullText);
  const isSenateFormat = /YEAS\s*[-–—]\s*\d+/i.test(fullText);
  
  if (chamber === 'House' || isHouseFormat) {
    return parseHouseVotes(items);
  } else if (chamber === 'Senate' || isSenateFormat) {
    return parseSenateVotes(items);
  }
  
  // Default to House format
  return parseHouseVotes(items);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function voteKey(vote) {
  return vote.floorVoteUrl || `${vote.chamber}|${vote.legislation}|${vote.date}`;
}

function loadExistingDetails(outputPath) {
  if (!fs.existsSync(outputPath)) return new Map();
  try {
    const existing = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    const map = new Map();
    for (const vote of existing.votes || []) {
      if (vote.voteDetails !== undefined) {
        map.set(voteKey(vote), vote.voteDetails);
      }
    }
    return map;
  } catch (error) {
    console.warn(`Could not resume from ${outputPath}: ${error.message}`);
    return new Map();
  }
}

function writeJson(outputPath, data) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`);
}


async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(args.input);
  const outputPath = path.resolve(args.output);
  const jsOutputPath = args.jsOutput ? path.resolve(args.jsOutput) : null;

  console.log(`Reading ${inputPath}...`);
  const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const existingDetails = loadExistingDetails(outputPath);

  if (existingDetails.size > 0) {
    console.log(`Resuming: found ${existingDetails.size} votes with details in ${outputPath}`);
  }

  const totalVotes = data.votes.length;
  let fetched = 0;
  let resumed = 0;
  let errors = 0;
  let skipped = 0;
  let newlyProcessed = 0;

  console.log(`Processing ${totalVotes} votes...`);

  for (let i = 0; i < data.votes.length; i++) {
    const vote = data.votes[i];

    if (args.limit != null && newlyProcessed >= args.limit) {
      break;
    }

    const key = voteKey(vote);
    if (existingDetails.has(key)) {
      vote.voteDetails = existingDetails.get(key);
      resumed++;
      continue;
    }

    if (!vote.floorVoteUrl) {
      skipped++;
      vote.voteDetails = null;
      continue;
    }

    newlyProcessed++;
    console.log(`[${i + 1}/${totalVotes}] Fetching: ${vote.legislation} (${vote.chamber}) - ${vote.date}`);

    const items = await fetchPdfData(vote.floorVoteUrl);

    if (items) {
      const voteDetails = parseVoteData(items, vote.chamber);
      vote.voteDetails = voteDetails;
      existingDetails.set(key, voteDetails);
      fetched++;

      const yeasCount = voteDetails?.yeas?.length || 0;
      const naysCount = voteDetails?.nays?.length || 0;
      const absentCount = voteDetails?.absentOrNotVoting?.length || 0;
      const presentCount = voteDetails?.present?.length || 0;
      const excusedCount = voteDetails?.excused?.length || 0;
      const rule76Count = voteDetails?.rule76?.length || 0;
      const total = yeasCount + naysCount + absentCount + presentCount + excusedCount + rule76Count;

      console.log(`  Parsed: ${yeasCount} yeas, ${naysCount} nays, ${absentCount} absent, ${excusedCount} excused = ${total} total`);
    } else {
      errors++;
      vote.voteDetails = null;
      existingDetails.set(key, null);
    }

    if (newlyProcessed % CHECKPOINT_EVERY === 0) {
      writeJson(outputPath, data);
      console.log(`  Checkpointed ${outputPath}`);
    }

    await sleep(args.delayMs);
  }

  console.log('\n--- Summary ---');
  console.log(`Total votes: ${totalVotes}`);
  console.log(`Fetched this run: ${fetched}`);
  console.log(`Resumed from previous run: ${resumed}`);
  console.log(`Skipped (no URL): ${skipped}`);
  console.log(`Errors: ${errors}`);

  console.log(`\nWriting results to ${outputPath}...`);
  writeJson(outputPath, data);

  if (jsOutputPath) {
    console.log(`Writing browser data file to ${jsOutputPath}...`);
    writeVoteDataJs(jsOutputPath, data);
  }

  console.log('Done!');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
