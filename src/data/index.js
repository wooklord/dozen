// Derived index: everything the app displays that Carton does not hand us
// directly. Built once per load from the complete setlists pull.
//
// SCOPE: this file counts, groups, joins and sorts. It does not model, score,
// or predict. Gap, times played, first/last played and position breakdowns are
// facts Carton shows on its own pages; producing them here is repackaging.
// If a function here ever starts estimating what WILL happen, it is out of
// scope -- see docs/phase3_ideas.md.
//
// Field derivation is specified in docs/plan.md and must not be guessed:
//   set identity  = (show_id, settype, setnumber)
//   set ordering  = explicit rank map (setnumber is a STRING; "e" follows "3")
//   slot          = min/max `position` within a set, NOT transition_id
//   show ordering = showdate asc, tie-broken by showorder asc

import { cleanDisplayText, normalizeSongName, sortKeyForName } from './normalize.js';
import { localToday } from '../util/dates.js';

/**
 * THE alphabetical comparator. Every list of songs in the app orders through
 * this one function -- Songs, Jams, and the canonical index order -- so two
 * screens showing the same set can never disagree about its order.
 *
 * Same reasoning as gapAtShow(): one implementation, not two that drift.
 *
 * Leading articles are ignored (see sortKeyForName). Ties fall back to the
 * full normalized name and then song_id, so the order is total and stable
 * rather than dependent on input order.
 */
export function compareSongsByName(a, b) {
  const ak = a.sortkey ?? sortKeyForName(a.name);
  const bk = b.sortkey ?? sortKeyForName(b.name);
  if (ak !== bk) return ak.localeCompare(bk);

  const an = a.songkey ?? normalizeSongName(a.name);
  const bn = b.songkey ?? normalizeSongName(b.name);
  if (an !== bn) return an.localeCompare(bn);

  return (Number(a.song_id) || 0) - (Number(b.song_id) || 0);
}

/**
 * The same ordering rules applied to bare name strings, so venues sort by the
 * identical logic songs do (articles ignored, normalized comparison).
 */
export function compareNames(aName, bName) {
  const ak = sortKeyForName(aName);
  const bk = sortKeyForName(bName);
  if (ak !== bk) return ak.localeCompare(bk);
  return normalizeSongName(aName).localeCompare(normalizeSongName(bName));
}

/**
 * Venue ordering. Ties break on venue_id, never on name: 9 venue names in this
 * archive exist in more than one city (Brooklyn Bowl is in three), so name is
 * not an identity.
 */
export function compareVenuesByName(a, b) {
  const c = compareNames(a.venuename, b.venuename);
  if (c !== 0) return c;
  return (Number(a.venue_id) || 0) - (Number(b.venue_id) || 0);
}

/**
 * Explicit rank for `setnumber`. It is a string in the API ("1","2","3","e",
 * "e2"), so plain string sort would place "e" before "3". Never sort it
 * numerically or lexically -- use this map.
 */
const SET_RANK = { 1: 1, 2: 2, 3: 3, e: 90, e2: 91 };

export function setRank(setnumber) {
  return SET_RANK[String(setnumber).toLowerCase()] ?? 50;
}

/**
 * Join key between a `setlists` row and a `jamcharts` row.
 *
 * `settype` is deliberately NOT part of the key: `jamcharts` has no settype
 * field, and it is not needed. Measured against live data, the tuple below is
 * unique across all 6361 setlist rows (zero collisions) and no show mixes
 * "One Set" with "Set", so settype carries no disambiguating information here.
 *
 * `position` IS part of the key. Thirteen songs are jam-charted twice in one
 * night; keying on song alone would collapse those pairs into one entry.
 *
 * Note the field-name trap: jamcharts uses `showid` (no underscore) while
 * setlists uses `show_id`. Callers pass the value, not the row, so the
 * mismatch cannot leak in here.
 */
export function jamKey(showId, songId, setnumber, position) {
  return `${Number(showId)}|${Number(songId)}|${String(setnumber).toLowerCase()}|${Number(position)}`;
}

/**
 * Is this setlist row a free-text entry rather than a song?
 *
 * The Carton records banter, announcements and other non-song items as setlist
 * rows carrying `slug === '_custom_'`. Measured 2026-08-27, there are three in
 * the whole 6361-row archive:
 *
 *   2022-03-17  Mercury Lounge  "Why Should I Worry"
 *   2022-11-05  The Foundry     "NYE Announcement"
 *   2023-12-07  Rockefellers    "Hanukkah Banter"
 *
 * ALL THREE SHARE `song_id = 1`, WHICH DOES NOT EXIST IN THE `songs` TABLE --
 * they are the only rows in the archive pointing at an absent song id. Keyed
 * on song_id, as this index is, the three collapsed into one browsable "song"
 * called "Why Should I Worry" with three performances that have nothing to do
 * with each other, and it was the 367th entry in a catalogue of 366.
 *
 * MATCHED ON THE SLUG, NOT THE ID. The slug is the part that says what the row
 * IS; `song_id = 1` is just where those rows happen to point. Verified against
 * live data that the two predicates select exactly the same three rows -- no
 * `_custom_` row carries a different song_id, and no row with song_id 1
 * carries a different slug -- so this is a choice about which fact to depend
 * on, and the semantic one survives Carton renumbering something.
 *
 * THE ROWS ARE NOT DROPPED FROM THE SETLIST. They are excluded from SONG
 * IDENTITY -- the catalogue, gap, and everything keyed on a song -- while
 * still rendering in the setlist where The Carton renders them. Dropping them
 * outright was measured and would not have changed any show's structure (each
 * sits in a set with other entries), but it would have made this app's setlist
 * for those three shows disagree with the page it links to, which is a worse
 * failure than a count being one too high.
 */
export function isCustomEntry(row) {
  return String(row?.slug) === '_custom_';
}

/** Human label for a set. */
export function setLabel(settype, setnumber) {
  const n = String(setnumber).toLowerCase();
  if (settype === 'One Set') return n === 'e' || n === 'e2' ? 'Encore' : 'One Set';
  if (n === 'e') return 'Encore';
  if (n === 'e2') return 'Encore 2';
  return `Set ${setnumber}`;
}

export const SLOTS = [
  'set1-opener',
  'set1-closer',
  'set2-opener',
  'set2-closer',
  'set3-opener',
  'set3-closer',
  'oneset-opener',
  'oneset-closer',
  'encore',
  'mid-set',
];

export const SLOT_LABELS = {
  'set1-opener': 'Set 1 opener',
  'set1-closer': 'Set 1 closer',
  'set2-opener': 'Set 2 opener',
  'set2-closer': 'Set 2 closer',
  'set3-opener': 'Set 3 opener',
  'set3-closer': 'Set 3 closer',
  'oneset-opener': 'One-set opener',
  'oneset-closer': 'One-set closer',
  encore: 'Encore',
  'mid-set': 'Mid-set',
};

/**
 * Ingest: decode entities and attach normalized keys ONCE, as rows enter the
 * index. No view or component ever calls a decode function, so two views can
 * never disagree about a venue's name.
 */
function ingestSetlistRow(r) {
  return {
    ...r,
    songname: cleanDisplayText(r.songname),
    venuename: cleanDisplayText(r.venuename),
    city: cleanDisplayText(r.city),
    state: cleanDisplayText(r.state),
    country: cleanDisplayText(r.country),
    shownotes: cleanDisplayText(r.shownotes),
    footnote: cleanDisplayText(r.footnote),
    songkey: normalizeSongName(r.songname),
  };
}

function ingestShowRow(r) {
  return {
    ...r,
    venuename: cleanDisplayText(r.venuename),
    location: cleanDisplayText(r.location),
    city: cleanDisplayText(r.city),
    state: cleanDisplayText(r.state),
    country: cleanDisplayText(r.country),
    showtitle: cleanDisplayText(r.showtitle),
  };
}

function ingestSongRow(r) {
  return {
    ...r,
    name: cleanDisplayText(r.name),
    original_artist: cleanDisplayText(r.original_artist),
    songkey: normalizeSongName(r.name),
    sortkey: sortKeyForName(r.name),
  };
}

function ingestVenueRow(r) {
  return {
    ...r,
    venuename: cleanDisplayText(r.venuename),
    city: cleanDisplayText(r.city),
    state: cleanDisplayText(r.state),
    country: cleanDisplayText(r.country),
  };
}

/**
 * Parse the `footnotes` field, which is a JSON-ENCODED STRING (not an array)
 * or null. Falls back to the legacy single `footnote`. No row in the archive
 * currently has more than one, but the array shape is handled anyway.
 */
export function parseFootnotes(row) {
  const out = [];
  if (typeof row.footnotes === 'string' && row.footnotes.trim().startsWith('[')) {
    try {
      const arr = JSON.parse(row.footnotes);
      if (Array.isArray(arr)) out.push(...arr.filter(Boolean).map((s) => cleanDisplayText(s)));
    } catch {
      /* fall through to the legacy field */
    }
  }
  if (!out.length && row.footnote) out.push(cleanDisplayText(row.footnote));
  return out;
}

/** Canonical show ordering: showdate asc, tie-broken by showorder asc. */
function compareShows(a, b) {
  if (a.showdate !== b.showdate) return a.showdate < b.showdate ? -1 : 1;
  return (Number(a.showorder) || 0) - (Number(b.showorder) || 0);
}

/**
 * Classify a row's slot from min/max `position` within its own set.
 *
 * Positional, NOT from transition_id: ids 4/5/6 look like end-of-set markers
 * but transition_id 1 also appears last-in-set 21 times, so it is not a
 * reliable signal.
 *
 * A single-song set makes that song BOTH opener and closer. It is counted in
 * both buckets deliberately, and raw counts are displayed so this is visible
 * rather than hidden.
 */
function classifySlots(row, minPos, maxPos) {
  const n = String(row.setnumber).toLowerCase();
  const slots = [];

  if (n === 'e' || n === 'e2') {
    slots.push('encore');
    return slots;
  }

  // "One Set" is tracked separately from "Set" and NEVER merged with Set 1 --
  // a festival one-set opener is a different pick from a two-set show's opener.
  const prefix = row.settype === 'One Set' ? 'oneset' : `set${n}`;
  const isOpener = row.position === minPos;
  const isCloser = row.position === maxPos;

  if (isOpener && SLOTS.includes(`${prefix}-opener`)) slots.push(`${prefix}-opener`);
  if (isCloser && SLOTS.includes(`${prefix}-closer`)) slots.push(`${prefix}-closer`);
  if (!slots.length) slots.push('mid-set');
  return slots;
}

function emptySlotCounts() {
  const o = {};
  for (const s of SLOTS) o[s] = 0;
  return o;
}

/**
 * Build the full derived index.
 * @param {{setlists:Array, shows:Array, songs:Array, venues:Array, jamcharts:Array}} raw
 */
/**
 * Album membership, keyed by song.
 *
 * `albums` carries no song_id -- the join key is the slug inside `song_url`
 * ("/song/in-it-for-the-ride"). Measured against live data: all 13 track rows
 * match by slug, none need name matching, and slug and name never disagree.
 *
 * The table is thin: 13 tracks across 5 albums, covering 13 of 366 songs. Song
 * detail therefore renders this section only when a song actually appears on
 * one, rather than showing an empty panel for the other 96%.
 */
function buildAlbumIndex(albumRows, songsBySlug) {
  const bySong = new Map();
  for (const a of albumRows) {
    const slug = String(a.song_url || '').replace(/^\/song\//, '').replace(/\/$/, '');
    const song = songsBySlug.get(slug);
    if (!song) continue;
    const id = Number(song.id);
    if (!bySong.has(id)) bySong.set(id, []);
    bySong.get(id).push({
      title: cleanDisplayText(a.album_displayname || a.album_title),
      url: a.album_url || '',
      releasedate: a.releasedate || '',
      position: Number(a.position) || 0,
      isLive: Number(a.islive) === 1,
      discNumber: Number(a.disc_number) || 1,
    });
  }
  return bySong;
}

export function buildIndex(raw) {
  const setlists = raw.setlists.map(ingestSetlistRow);
  const shows = raw.shows.map(ingestShowRow);
  const songs = raw.songs.map(ingestSongRow);
  const venues = raw.venues.map(ingestVenueRow);
  const jamcharts = (raw.jamcharts || []).map((r) => ({
    ...r,
    songname: cleanDisplayText(r.songname),
    venuename: cleanDisplayText(r.venuename),
    jamchartnote: cleanDisplayText(r.jamchartnote),
  }));

  const today = localToday();

  // --- Shows -----------------------------------------------------------------
  const showsById = new Map(shows.map((s) => [Number(s.show_id), s]));
  const allShowsSorted = [...shows].sort(compareShows);
  const playedShows = allShowsSorted.filter((s) => s.showdate <= today);
  const futureShows = allShowsSorted.filter((s) => s.showdate > today);

  // --- Gap denominator -------------------------------------------------------
  // Only shows that HAVE setlist rows count toward a gap.
  //
  // 194 of 804 shows have no setlist data at all (mostly 2013-2015). A show
  // with no recorded setlist cannot tell us a song went unplayed -- we simply
  // don't know -- so counting it would inflate every gap that spans it. This
  // also excludes one corrupt-date row in the shows table ("0015-08-28").
  //
  // For modern songs the two denominators converge, since nearly every recent
  // show has a setlist; the choice only moves ancient bustout numbers.
  //
  // NOTE: Carton's own "(N show gap)" footnotes are static text written at
  // different times against a growing archive, and no single convention
  // reproduces them (58 footnotes, best rule matches 29). We therefore compute
  // our own number under ONE documented convention and always render Carton's
  // footnote text verbatim beside it rather than trying to match it.
  const showsWithSetlists = new Set(setlists.map((r) => Number(r.show_id)));
  const countedShows = playedShows.filter((s) => showsWithSetlists.has(Number(s.show_id)));

  const showOrdinal = new Map();
  countedShows.forEach((s, i) => showOrdinal.set(Number(s.show_id), i));
  const latestOrdinal = countedShows.length - 1;

  // --- Group setlist rows into sets, then classify slots ---------------------
  const setGroups = new Map(); // "show_id|settype|setnumber" -> rows
  for (const row of setlists) {
    const key = `${row.show_id}|${row.settype}|${row.setnumber}`;
    if (!setGroups.has(key)) setGroups.set(key, []);
    setGroups.get(key).push(row);
  }

  for (const rows of setGroups.values()) {
    let minPos = Infinity;
    let maxPos = -Infinity;
    for (const r of rows) {
      const p = Number(r.position);
      if (p < minPos) minPos = p;
      if (p > maxPos) maxPos = p;
    }
    for (const r of rows) {
      r.slots = classifySlots(r, minPos, maxPos);
      r.isSetOpener = Number(r.position) === minPos;
      r.isSetCloser = Number(r.position) === maxPos;
    }
  }

  // --- Per-song aggregation --------------------------------------------------
  const songMeta = new Map(songs.map((s) => [Number(s.id), s]));
  const jamBySong = new Map();
  for (const j of jamcharts) {
    const id = Number(j.song_id);
    if (!jamBySong.has(id)) jamBySong.set(id, []);
    jamBySong.get(id).push(j);
  }

  const bySong = new Map();
  for (const row of setlists) {
    // Free-text entries are not songs and do not enter the catalogue. See
    // isCustomEntry -- the row stays in setlistByShow and still renders.
    if (isCustomEntry(row)) continue;
    const id = Number(row.song_id);
    let entry = bySong.get(id);
    if (!entry) {
      entry = {
        song_id: id,
        name: row.songname,
        slug: row.slug,
        songkey: row.songkey,
        sortkey: sortKeyForName(row.songname),
        isOriginal: Number(row.isoriginal) === 1,
        originalArtist: row.original_artist || '',
        performances: [],
        positionCounts: emptySlotCounts(),
        timesPlayed: 0,
      };
      bySong.set(id, entry);
    }
    entry.performances.push(row);
    entry.timesPlayed += 1;
    for (const slot of row.slots || []) entry.positionCounts[slot] += 1;
    if (!entry.originalArtist && row.original_artist) entry.originalArtist = row.original_artist;
  }

  // Sort each song's history and compute gap facts.
  for (const entry of bySong.values()) {
    entry.performances.sort((a, b) => {
      const sa = showsById.get(Number(a.show_id));
      const sb = showsById.get(Number(b.show_id));
      if (sa && sb) return compareShows(sa, sb);
      return a.showdate < b.showdate ? -1 : a.showdate > b.showdate ? 1 : 0;
    });

    const played = entry.performances.filter((p) => p.showdate <= today);
    const first = entry.performances[0];
    const last = played[played.length - 1] || null;

    entry.firstPlayed = first ? first.showdate : null;
    entry.lastPlayed = last ? last.showdate : null;
    entry.firstShowId = first ? Number(first.show_id) : null;
    entry.lastShowId = last ? Number(last.show_id) : null;

    // Gap = shows in the canonical ordering since the song last appeared.
    // 0 means it was played at the most recent show. Counting only.
    if (last && showOrdinal.has(Number(last.show_id))) {
      entry.showsSinceLastPlayed = latestOrdinal - showOrdinal.get(Number(last.show_id));
    } else {
      entry.showsSinceLastPlayed = null;
    }

    const meta = songMeta.get(entry.song_id);
    if (meta) {
      entry.name = meta.name || entry.name;
      entry.slug = meta.slug || entry.slug;
      // The canonical name may differ from the one on the setlist row, so the
      // derived keys have to follow it rather than keep the row's spelling.
      entry.songkey = meta.songkey || entry.songkey;
      entry.sortkey = meta.sortkey || entry.sortkey;
      entry.isOriginal = Number(meta.isoriginal) === 1;
      // `songs` reports "Eggy" as original_artist for originals while
      // `setlists` uses "". Trust isoriginal, not the string.
      if (!entry.isOriginal) entry.originalArtist = meta.original_artist || entry.originalArtist;
      else entry.originalArtist = '';
    }

    entry.jamcharts = jamBySong.get(entry.song_id) || [];
    entry.isJamChart = entry.jamcharts.length > 0;
  }

  // Songs in the catalog that have never been played.
  for (const s of songs) {
    const id = Number(s.id);
    if (bySong.has(id)) continue;
    bySong.set(id, {
      song_id: id,
      name: s.name,
      slug: s.slug,
      songkey: s.songkey,
      sortkey: s.sortkey,
      isOriginal: Number(s.isoriginal) === 1,
      originalArtist: Number(s.isoriginal) === 1 ? '' : s.original_artist || '',
      performances: [],
      positionCounts: emptySlotCounts(),
      timesPlayed: 0,
      firstPlayed: null,
      lastPlayed: null,
      showsSinceLastPlayed: null,
      jamcharts: jamBySong.get(id) || [],
      isJamChart: (jamBySong.get(id) || []).length > 0,
    });
  }

  // --- Per-show setlists -----------------------------------------------------
  const setlistByShow = new Map();
  for (const row of setlists) {
    const id = Number(row.show_id);
    if (!setlistByShow.has(id)) setlistByShow.set(id, []);
    setlistByShow.get(id).push(row);
  }
  for (const rows of setlistByShow.values()) {
    rows.sort((a, b) => {
      const r = setRank(a.setnumber) - setRank(b.setnumber);
      if (r !== 0) return r;
      if (a.settype !== b.settype) return a.settype === 'One Set' ? -1 : 1;
      return Number(a.position) - Number(b.position);
    });
  }

  // --- Jam chart entries, per show, IN SETLIST ORDER --------------------------
  //
  // Built by walking the show's ALREADY-SORTED setlist rows rather than by
  // sorting the jamcharts rows. Order is therefore correct by construction --
  // there is no second sort to drift out of step with the setlist rendered
  // directly above these entries on show detail.
  //
  // The join is show + song + settype-agnostic setnumber + position, which is
  // EXACT against live data: all 792 jamcharts rows match a setlist row, and
  // no setlist row flagged isjamchart lacks one. Verified both directions --
  // 779 unique (show, song) pairs from each source, zero disagreement. The 13
  // songs charted twice in one night are separated by position, which is why
  // the key includes it rather than stopping at song_id.
  const jamByKey = new Map();
  for (const j of jamcharts) {
    jamByKey.set(jamKey(j.showid, j.song_id, j.setnumber, j.position), j);
  }

  const jamByShow = new Map();
  for (const [showId, rows] of setlistByShow) {
    const entries = [];
    for (const r of rows) {
      if (Number(r.isjamchart) !== 1) continue;
      const j = jamByKey.get(jamKey(r.show_id, r.song_id, r.setnumber, r.position));
      // A flagged row with no jamcharts row does not occur in live data, but
      // if the two tables ever diverge the setlist row still carries the note,
      // so the entry is rendered from what IS present rather than dropped.
      entries.push({
        song_id: Number(r.song_id),
        songname: r.songname,
        settype: r.settype,
        setnumber: r.setnumber,
        position: Number(r.position),
        note: j ? j.jamchartnote : cleanDisplayText(r.jamchart_notes || ''),
      });
    }
    if (entries.length) jamByShow.set(showId, entries);
  }

  // --- Venues ----------------------------------------------------------------
  const venuesById = new Map(venues.map((v) => [Number(v.venue_id), v]));
  const showsByVenue = new Map();
  for (const s of allShowsSorted) {
    const id = Number(s.venue_id);
    if (!showsByVenue.has(id)) showsByVenue.set(id, []);
    showsByVenue.get(id).push(s);
  }

  // Album membership, joined on the slug inside albums.song_url.
  const songsBySlug = new Map(songs.map((s) => [s.slug, s]));
  const albumsBySong = buildAlbumIndex(raw.albums || [], songsBySlug);
  for (const entry of bySong.values()) {
    entry.albums = albumsBySong.get(entry.song_id) || [];
  }

  // Canonical order is alphabetical through the shared comparator, so any view
  // that does not re-sort already matches the A-Z sort exactly.
  const songList = [...bySong.values()].sort(compareSongsByName);
  const songsByKey = new Map(songList.map((s) => [s.songkey, s]));

  return {
    today,
    songs: songList,
    songsById: bySong,
    songsByKey,
    shows: allShowsSorted,
    showsById,
    playedShows,
    countedShows,
    futureShows,
    setlistByShow,
    jamByShow,
    showOrdinal,
    venues,
    venuesById,
    showsByVenue,
    jamcharts,
    counts: {
      setlistRows: setlists.length,
      shows: shows.length,
      playedShows: playedShows.length,
      countedShows: countedShows.length,
      songs: songList.length,
      venues: venues.length,
      jamcharts: jamcharts.length,

      // How far back jam chart coverage actually reaches, derived rather than
      // written into prose. The Carton adds entries, so a hardcoded year would
      // silently become a lie -- same reasoning as the gap denominator counts
      // being read from the live index instead of typed into the explainer.
      //
      // Measured 2026-08-21: earliest entry is 2024-01-05.
      jamchartsFrom: jamcharts.length
        ? jamcharts.reduce((min, j) => (j.showdate < min ? j.showdate : min), jamcharts[0].showdate)
        : null,

      // Full accounting for the gap denominator, so the Data panel can state
      // it from live values rather than hardcoded numbers. Excluding shows
      // with no setlist is a counting CONVENTION, not a cleanup detail: it
      // makes every gap smaller than a convention counting all shows.
      excludedNoSetlist: playedShows.filter((s) => !showsWithSetlists.has(Number(s.show_id))).length,
      excludedFuture: futureShows.length,
      excludedBadDate: shows.filter((s) => !/^(19|20)\d\d-/.test(String(s.showdate))).length,
    },
    newestShowdate: countedShows.length ? countedShows[countedShows.length - 1].showdate : null,
  };
}

/**
 * Gap for one song AS OF a given show.
 *
 * THE ONE FUNCTION both gap views call. "Current gap" is this same
 * computation evaluated at the newest counted show -- not a second code path.
 * That is deliberate: gap-at-the-time and current gap are different numbers,
 * and if they were computed separately they would eventually drift by a few
 * and both would look broken.
 *
 * Counted under the identical convention as everything else: only shows that
 * have setlist data are in the denominator.
 *
 * @returns {{gap: number|null, previous: object|null, isDebut: boolean}}
 *   `isDebut` means there was no prior performance at all. That is NOT gap 0 --
 *   gap 0 means "played at the immediately preceding counted show" -- and
 *   conflating the two would be wrong.
 */
export function gapAtShow(index, songId, showId) {
  const song = index.songsById.get(Number(songId));
  const thisOrdinal = index.showOrdinal.get(Number(showId));
  if (!song || thisOrdinal === undefined) {
    return { gap: null, previous: null, isDebut: false };
  }

  // Performances are already in canonical show order, so walk back to the last
  // one that happened strictly before this show and is in the counted universe.
  let previous = null;
  for (let i = song.performances.length - 1; i >= 0; i--) {
    const p = song.performances[i];
    const ord = index.showOrdinal.get(Number(p.show_id));
    if (ord === undefined) continue; // show has no setlist data -- not counted
    if (ord < thisOrdinal) {
      previous = p;
      break;
    }
  }

  if (!previous) return { gap: null, previous: null, isDebut: true };
  return {
    gap: thisOrdinal - index.showOrdinal.get(Number(previous.show_id)),
    previous,
    isDebut: false,
  };
}

/**
 * Every song played at a given show with its gap at that moment -- the
 * per-show gap chart. Distinct from archive-wide rotation.
 */
export function gapChartForShow(index, showId) {
  const rows = index.setlistByShow.get(Number(showId)) || [];

  // One entry per SONG, not per performance. 547 song/show pairs in the
  // archive involve a song played more than once in a night (reprises, jams
  // that return). Gap is a property of the song entering the show, so the
  // repeat would carry an identical number and read as a second fact. The
  // first occurrence sets the position; repeats are counted instead.
  const seen = new Map();
  for (const r of rows) {
    // A gap is a property of a song entering a show. A free-text entry has no
    // gap to report, and keyed on its shared song_id it would report one
    // computed across three unrelated announcements.
    if (isCustomEntry(r)) continue;
    const id = Number(r.song_id);
    const existing = seen.get(id);
    if (existing) {
      existing.occurrences += 1;
      if (!existing.alsoIn.includes(setLabel(r.settype, r.setnumber))) {
        existing.alsoIn.push(setLabel(r.settype, r.setnumber));
      }
      continue;
    }
    const { gap, previous, isDebut } = gapAtShow(index, id, showId);
    seen.set(id, {
      row: r,
      song: index.songsById.get(id) || null,
      songname: r.songname,
      song_id: id,
      setLabel: setLabel(r.settype, r.setnumber),
      alsoIn: [setLabel(r.settype, r.setnumber)],
      occurrences: 1,
      gap,
      previous,
      isDebut,
    });
  }
  return [...seen.values()];
}

/**
 * The longest gap a song has actually been through, as a max over its
 * per-performance gaps.
 *
 * Each individual figure is a fact Carton renders on its own gap charts; this
 * is the maximum of them. It describes something that HAPPENED -- it is
 * labelled "longest observed gap" with the date, never a "record" and never a
 * due-status, and it carries the same convention explanation as every other
 * gap figure.
 */
export function longestObservedGap(index, songId) {
  const song = index.songsById.get(Number(songId));
  if (!song || song.performances.length < 2) return null;

  let best = null;
  for (const p of song.performances) {
    const ord = index.showOrdinal.get(Number(p.show_id));
    if (ord === undefined) continue;
    const { gap, previous, isDebut } = gapAtShow(index, songId, p.show_id);
    if (isDebut || gap === null) continue;
    if (!best || gap > best.gap) best = { gap, at: p, previous };
  }
  return best;
}

/**
 * Set structure of a played show, e.g. "Set 1 + Set 2 + Encore" or "One Set".
 * Only ever derived from rows that EXIST -- never asserted for a future show.
 */
export function showStructure(index, showId) {
  const rows = index.setlistByShow.get(Number(showId));
  if (!rows || !rows.length) return null;
  const seen = [];
  for (const r of rows) {
    const label = setLabel(r.settype, r.setnumber);
    if (!seen.includes(label)) seen.push(label);
  }
  return seen.map(shortSetLabel).join('+');
}

/**
 * The compact form of one set label, for the structure badge.
 *
 * "Set 1 + Set 2 + Encore" ate most of a row's width and pushed venue names
 * into ellipsis, and the venue is the thing being scanned for. 22 characters
 * became 7.
 *
 * PER LABEL, NOT PER STRUCTURE. Mapping whole strings would cover the nine
 * combinations that exist today and produce nothing for the tenth. Composing
 * from labels means an unseen combination still renders correctly -- and there
 * ARE more combinations than the obvious five: measured against the live
 * archive on 2026-08-27, all 610 shows with setlists fall into nine shapes,
 * including "Set 1 + Set 2" with no encore (17 shows), "Set 1 + Set 2 + Set 3"
 * (4), "Set 1 + Set 2 + Set 3 + Encore" (1) and "Set 1 + Encore + Encore 2"
 * (1). Set 3 and Encore 2 both exist.
 *
 * "ONE SET" MUST NOT COLLAPSE INTO "SET 1", and it is spelled with a WORD
 * rather than a digit for exactly that reason. `S1` vs `1 set` would keep them
 * technically distinct while making the digit the salient character in both,
 * which is the thing the eye grabs in a dense list; `S1` vs `One set` shares no
 * character at all. It costs two characters on the 174 shows that are one-set
 * shows and buys an unmistakable difference.
 *
 * The distinction is real and not cosmetic: 1493 setlist rows are "One Set"
 * against 3031 "Set 1", and a festival one-set opener is a different pick from
 * a two-set show's opener.
 */
export function shortSetLabel(label) {
  if (label === 'One Set') return 'One set';
  const encore = label.match(/^Encore(?: (\d+))?$/);
  if (encore) return `E${encore[1] || ''}`;
  const set = label.match(/^Set (\w+)$/);
  if (set) return `S${set[1]}`;
  // Anything setLabel() starts producing that this does not know about is
  // passed through intact rather than mangled into something shorter and
  // wrong. A badge that is too long is a layout problem; a badge that is
  // confidently incorrect is a data problem.
  return label;
}

/** Shows on the same month/day in previous years. */
export function onThisDate(index, monthDay, excludeShowId) {
  return index.playedShows.filter(
    (s) => s.showdate.slice(5, 10) === monthDay && Number(s.show_id) !== Number(excludeShowId),
  );
}

/**
 * Shows forming a consecutive-date run around a given date (a tour run).
 * Used to show the observed formats of already-played shows in the same run.
 */
export function consecutiveRun(index, showdate, maxGapDays = 2) {
  const all = index.shows;
  const idx = all.findIndex((s) => s.showdate === showdate);
  if (idx === -1) return [];
  const run = [all[idx]];

  const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

  for (let i = idx - 1; i >= 0; i--) {
    if (Math.abs(dayDiff(all[i].showdate, run[0].showdate)) <= maxGapDays) run.unshift(all[i]);
    else break;
  }
  for (let i = idx + 1; i < all.length; i++) {
    if (Math.abs(dayDiff(run[run.length - 1].showdate, all[i].showdate)) <= maxGapDays) run.push(all[i]);
    else break;
  }
  return run;
}
