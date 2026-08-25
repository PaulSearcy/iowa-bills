import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

export function compactVoteData(data) {
  const rosters = { House: [], Senate: [] };
  const indexOf = { House: new Map(), Senate: new Map() };

  function addMember(chamber, member) {
    const map = indexOf[chamber];
    if (!map) return -1;
    if (!map.has(member.name)) {
      map.set(member.name, rosters[chamber].length);
      const rec = { name: member.name };
      if (member.partyAbbr) rec.partyAbbr = member.partyAbbr;
      if (member.party) rec.party = member.party;
      rosters[chamber].push(rec);
    } else if (member.partyAbbr) {
      const rec = rosters[chamber][map.get(member.name)];
      if (!rec.partyAbbr) {
        rec.partyAbbr = member.partyAbbr;
        if (member.party) rec.party = member.party;
      }
    }
    return map.get(member.name);
  }

  function idxList(chamber, list) {
    if (!list?.length) return undefined;
    return list.map((member) => addMember(chamber, member));
  }

  const votes = (data.votes || []).map((vote) => {
    const details = vote.voteDetails || {};
    const out = {
      date: vote.date,
      chamber: vote.chamber,
      legislation: vote.legislation,
      ayes: vote.ayes,
      nays: vote.nays,
      absentOrNotVoting: vote.absentOrNotVoting,
    };
    if (vote.floorVoteUrl) out.floorVoteUrl = vote.floorVoteUrl;
    if (vote.legislationTitle) out.legislationTitle = vote.legislationTitle;

    const yeas = idxList(vote.chamber, details.yeas);
    const nays = idxList(vote.chamber, details.nays);
    const absent = idxList(vote.chamber, [
      ...(details.absentOrNotVoting || []),
      ...(details.excused || []),
    ]);
    if (yeas) out.yeas = yeas;
    if (nays) out.nayIdx = nays;
    if (absent) out.absent = absent;
    return out;
  });

  return {
    sourceFile: data.sourceFile,
    title: data.title,
    beginDate: data.beginDate,
    endDate: data.endDate,
    voteCount: data.voteCount,
    rosters,
    votes,
  };
}

export function writeVoteDataJs(jsOutputPath, data) {
  fs.writeFileSync(jsOutputPath, `var voteData = ${JSON.stringify(compactVoteData(data))};\n`);
}

function loadVoteDataJs(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const json = src.replace(/^(?:var|const) voteData =\s*/, '').replace(/;\s*$/, '');
  return JSON.parse(json);
}

function expandVoteData(data) {
  if (!data?.rosters || data.votes?.[0]?.voteDetails) return data;
  const votes = data.votes.map((vote) => {
    const roster = data.rosters[vote.chamber] || [];
    const names = (idxs) => (idxs || []).map((i) => roster[i]).filter(Boolean);
    return {
      ...vote,
      voteDetails: {
        yeas: names(vote.yeas),
        nays: names(vote.nayIdx || (Array.isArray(vote.nays) ? vote.nays : null)),
        absentOrNotVoting: names(vote.absent),
      },
    };
  });
  return { ...data, votes };
}

function verifyRoundtrip(original, compact) {
  const expanded = expandVoteData(compact);
  if (expanded.votes.length !== original.votes.length) {
    throw new Error(`Vote count mismatch: ${expanded.votes.length} vs ${original.votes.length}`);
  }
  for (let i = 0; i < original.votes.length; i += 1) {
    const before = original.votes[i];
    const after = expanded.votes[i];
    const beforeYeas = before.voteDetails?.yeas?.length || 0;
    const afterYeas = after.voteDetails?.yeas?.length || 0;
    const beforeNays = before.voteDetails?.nays?.length || 0;
    const afterNays = after.voteDetails?.nays?.length || 0;
    if (beforeYeas !== afterYeas || beforeNays !== afterNays) {
      throw new Error(
        `Voter mismatch on ${before.legislation} (${before.chamber}): yeas ${beforeYeas}->${afterYeas}, nays ${beforeNays}->${afterNays}`
      );
    }
    if (Number(before.nays) !== Number(after.nays)) {
      throw new Error(
        `Nay count overwritten on ${before.legislation} (${before.chamber}): ${before.nays} -> ${after.nays}`
      );
    }
  }
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error(`Usage: node ${path.relative(process.cwd(), fileURLToPath(import.meta.url))} <vote-data-*.js>`);
    process.exit(1);
  }
  for (const file of files) {
    const original = loadVoteDataJs(file);
    const compact = original.rosters ? original : compactVoteData(original);
    if (!original.rosters) verifyRoundtrip(original, compact);
    fs.writeFileSync(file, `var voteData = ${JSON.stringify(compact)};\n`);
    const bytes = fs.statSync(file).size;
    console.log(`${file}: ${(bytes / 1024).toFixed(0)} KB, ${compact.votes.length} votes, House ${compact.rosters.House.length}, Senate ${compact.rosters.Senate.length}`);
  }
}
