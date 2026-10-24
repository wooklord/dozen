// Gap oracle: the app's gap figures against The Carton's own Show Gap column.
//
//   node scripts/gap-oracle.mjs            # exits 1 on any mismatch
//
// Gap in this app means what the Show Gap column on a thecarton.net/song/{slug}
// page means, and the current gap means that page's "which was N show(s) ago"
// (docs/plan.md, Scope rulings, 2026-10-24). This script is the proof of that
// claim: it does ONE fresh pull through the app's own data source, builds the
// app's own index, and compares every row of twenty song pages against
// gapAtShow() and showsSinceLastPlayed -- the same functions the screens call,
// not a reimplementation of the rule.
//
// Row by row:
//   - a row dated the same as the previous row is a second performance on one
//     date, which Carton prints as 0; asserted as 0, then skipped
//   - a debut row carries the POSITION of the debut date on Carton (how many
//     Eggy shows had happened by then); compared against index.showOrdinal
//   - every other row is a closed gap, compared against gapAtShow().gap
//   - the page's play count is compared against timesPlayed, and its "N show(s)
//     ago" against showsSinceLastPlayed
//
// The song is identified by the data-song-id on the page's upvote buttons, NOT
// by the URL slug. The list below holds the slugs from the songs table, and
// they are not always the name: Thorns is slug "t", and the guessable
// /song/thorns 302-redirects to the ALL-SONGS INDEX -- a page with a table and
// 360 rows that is not a song page. A fetch that followed that redirect and
// trusted the URL would compare against the wrong table; the id on the page
// cannot be fooled that way, and a page without one is a failure.
//
// Thorns is in the list on purpose: it was played at the one artist_id 2 show
// and Carton's Eggy page omits that row, so the play count goes red the moment
// the artist filter is lost.
//
// SKIP, NOT PASS, when Carton cannot be reached. An unreachable third party is
// not a defect here, and a skipped run says so rather than reporting health it
// never established. Exit code is 0 on skip; the summary line says SKIPPED.
//
// Twenty HTML pages at 1.2 s apart plus the six-request cold pull. /song/ is
// allowed by robots.txt; the pull is the same one the app makes.

import { pathToFileURL } from 'node:url';
import { fetchFullArchive } from '../src/data/source.js';
import { buildIndex, gapAtShow } from '../src/data/index.js';

export const SLUGS = [
  'feel-like-a-stranger', 'the-harder-they-come', 'franklins-tower', 'helpless',
  'shadow', 'burritos-el-chavo-2', 'one-stop-shop', '12-pounds-of-pain', 'wayless',
  'a-moments-notice-2', 'yuck', 'tom-sawyer', 'high-noon', 'gretchen', 'fay',
  'carry-on', 'time-loves-a-hero', 'interior-people', 'birdland', 't',
];

/**
 * Parse a Carton song page: per-row {date, gap, showId}, the song's id, the
 * current gap, the last-played date and the play count. The count reads
 * "3 time(s)" on a short page and "169 times, across 141 show(s)" on a long one.
 */
export function parseSongPage(html) {
  const flat = html.replace(/\r?\n/g, '');
  const body = flat.match(/<tbody>(.*?)<\/tbody>/);
  if (!body) return null;
  const rows = [];
  for (const tr of body[1].split('<tr>').slice(1)) {
    const tds = tr.split(/<td[^>]*>/).slice(1).map((t) => t.replace(/<[^>]*>/g, '').trim());
    // Columns: Upvote, Date Played, Venue, Show Gap, Set, Song Before, Song After, Footnote
    const showId = Number((tr.match(/data-show-id='(\d+)'/) || [])[1]);
    rows.push({ date: tds[1], gap: Number(tds[3]), showId });
  }
  const songId = Number((body[1].match(/data-song-id='(\d+)'/) || [])[1]) || null;
  const cur = flat.match(/played (\d{4}-\d{2}-\d{2}), which was (\d+) show\(s\) ago/);
  const plays = flat.match(/has been played by Eggy (\d+) time/);
  return {
    rows,
    songId,
    current: cur ? Number(cur[2]) : null,
    lastPlayed: cur ? cur[1] : null,
    plays: plays ? Number(plays[1]) : null,
  };
}

/** Compare one parsed page against the index. Returns {checked, problems[]}. */
export function compareSong(index, song, page) {
  const problems = [];
  let checked = 0;
  let prevDate = null;
  for (const row of page.rows) {
    if (!row.showId) { problems.push(`${row.date}: no data-show-id on the row`); continue; }
    if (row.date === prevDate) {
      checked++;
      if (row.gap !== 0) problems.push(`${row.date}: a second performance on one date should read 0 on Carton, reads ${row.gap}`);
      continue;
    }
    prevDate = row.date;
    const g = gapAtShow(index, song.song_id, row.showId);
    checked++;
    if (g.isDebut) {
      const pos = index.showOrdinal.get(row.showId);
      if (pos !== row.gap) problems.push(`${row.date} (debut): Carton position ${row.gap}, app position ${pos}`);
    } else if (g.gap !== row.gap) {
      problems.push(`${row.date}: Carton gap ${row.gap}, app gap ${g.gap}`);
    }
  }
  if (page.current !== null) {
    checked++;
    if (song.showsSinceLastPlayed !== page.current) problems.push(`current: Carton ${page.current} show(s) ago, app ${song.showsSinceLastPlayed}`);
  }
  if (page.plays !== null) {
    checked++;
    if (song.timesPlayed !== page.plays) problems.push(`plays: Carton ${page.plays}, app ${song.timesPlayed}`);
  }
  return { checked, problems };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let raw;
  try {
    raw = await fetchFullArchive({ verify: false });
  } catch (err) {
    console.log(`  SKIP  could not pull the archive (${err.message}); nothing was checked`);
    console.log('\nSKIPPED — Carton unreachable, 0 checks made');
    return 0;
  }
  const index = buildIndex(raw);
  console.log(`archive: ${index.counts.setlistRows} rows, ${index.counts.countedShows} shows counted, newest ${index.newestShowdate}\n`);

  let failures = 0, checks = 0, skips = 0;
  for (const slug of SLUGS) {
    let html;
    try {
      const res = await fetch(`https://thecarton.net/song/${slug}`);
      if (!res.ok) throw new Error(`http ${res.status}`);
      html = await res.text();
    } catch (err) {
      skips++;
      console.log(`  SKIP  ${slug}: page not fetched (${err.message})`);
      await sleep(1200);
      continue;
    }
    const page = parseSongPage(html);
    if (!page) { failures++; console.log(`  FAIL  ${slug}: no performance table on the page`); continue; }
    if (!page.songId) { failures++; console.log(`  FAIL  ${slug}: no data-song-id on the page -- not a song page (a redirect to the index?)`); continue; }
    const song = index.songsById.get(page.songId);
    if (!song) { failures++; console.log(`  FAIL  ${slug}: page says song_id ${page.songId}, which is not in the index`); continue; }
    const { checked, problems } = compareSong(index, song, page);
    checks += checked;
    if (problems.length) {
      failures += problems.length;
      console.log(`  FAIL  ${slug}: ${problems.length} of ${checked} checks`);
      for (const p of problems.slice(0, 6)) console.log(`          ${p}`);
      if (problems.length > 6) console.log(`          … ${problems.length - 6} more`);
    } else {
      console.log(`  ok    ${slug}: ${checked} checks (${page.rows.length} rows, current ${page.current}, ${page.plays} plays)`);
    }
    await sleep(1200);
  }

  const skipNote = skips ? ` (${skips} page${skips === 1 ? '' : 's'} SKIPPED, not verified)` : '';
  if (failures) console.log(`\nFAILED — ${failures} mismatch${failures === 1 ? '' : 'es'} across ${checks} checks${skipNote}`);
  else if (checks === 0) console.log('\nSKIPPED — no page could be fetched, 0 checks made');
  else console.log(`\nPASSED — ${checks} checks across ${SLUGS.length - skips} song pages agree with Carton${skipNote}`);
  return failures ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
