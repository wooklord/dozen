// Dead-declaration detector for app.css.
//
// WHY THIS EXISTS
// Three rules in this stylesheet have been entirely inert -- every declaration
// in them overridden, on every element that could ever carry them, by a later
// rule at equal specificity:
//
//   .btn-small           beaten by .btn
//   .sortbar-secondary   beaten by .sortbar   (position, top, padding, margin)
//   .chip-quiet          beaten by .chip      (font-weight)
//
// None of them looked wrong. A dead rule reads exactly like a live one, the
// screen renders something plausible, and the reasoning built on top of it
// keeps being cited: `.chip-quiet`'s dead 500 was quoted as measured evidence
// in a design decision recorded in docs/design.md. Three instances of one
// mistake is a missing check, not bad luck.
//
// WHAT IT CHECKS
// For every set of classes that actually appear together on an element, and
// for every CSS property, it resolves the cascade the way a browser would --
// specificity first, then source order -- and reports any declaration that
// LOSES for every element it could ever apply to. That is the definition of
// dead: not "unused selector", but "declaration that can never take effect".
//
// WHAT ELSE COULD SATISFY THIS? A rule could be flagged because the co-occurring
// class sets are read from the source rather than from a browser. So the sets
// come from the ONE convention this codebase uses for class lists -- the
// `el('tag.a.b')` spec string in src/ui/dom.js -- plus explicit `class:` props,
// and a class list that cannot be read is not silently dropped: readClassSets()
// is asserted non-trivial by the test, because an empty set list would make
// every rule "live" and the check would pass by finding nothing.
//
// SCOPE, deliberately narrow: only rules whose selector is a plain chain of
// class selectors (`.a`, `.a.b`). Anything with a pseudo-class, pseudo-element,
// attribute, tag or descendant combinator is skipped on both sides -- those
// are state- or context-scoped and "overridden in the base state" is not the
// same as dead. Narrow and correct beats broad and noisy: a checker that cries
// wolf gets an allowlist, and then it gets ignored.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Longhands each shorthand resets. Enough to cover what this stylesheet uses. */
const SHORTHANDS = {
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  border: ['border-width', 'border-style', 'border-color'],
  background: ['background-color', 'background-image', 'background-position', 'background-size'],
  font: ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height'],
  inset: ['top', 'right', 'bottom', 'left'],
  'border-radius': [],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
  gap: ['row-gap', 'column-gap'],
  overflow: ['overflow-x', 'overflow-y'],
};

/** Every property name a declaration of `prop` sets, itself included. */
export function expand(prop) {
  return [prop, ...(SHORTHANDS[prop] || [])];
}

/**
 * Top-level rules, in source order.
 *
 * At-rule bodies (@media, @supports) are SKIPPED rather than flattened: a
 * declaration inside one is conditional, and calling it dead because an
 * unconditional rule beats it would be wrong in exactly the cases that matter.
 */
export function parseRules(css) {
  const rules = [];
  let i = 0;
  let order = 0;
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));

  while (i < stripped.length) {
    const open = stripped.indexOf('{', i);
    if (open === -1) break;
    const prelude = stripped.slice(i, open).trim();

    // Find the matching close brace, counting nesting.
    let depth = 1;
    let j = open + 1;
    while (j < stripped.length && depth > 0) {
      if (stripped[j] === '{') depth++;
      else if (stripped[j] === '}') depth--;
      j++;
    }
    const body = stripped.slice(open + 1, j - 1);

    if (!prelude.startsWith('@')) {
      const decls = new Map();
      for (const part of body.split(';')) {
        const c = part.indexOf(':');
        if (c === -1) continue;
        const prop = part.slice(0, c).trim().toLowerCase();
        const value = part.slice(c + 1).trim();
        if (!prop || prop.startsWith('--') || !value) continue;
        decls.set(prop, value);
      }
      for (const sel of prelude.split(',')) {
        const s = sel.trim();
        if (s) rules.push({ selector: s, decls, order: order++ });
      }
    }
    i = j;
  }
  return rules;
}

/** `.a.b` -> ['a','b']; anything else (pseudo, attr, tag, descendant) -> null. */
export function pureClassChain(selector) {
  if (!/^(\.[A-Za-z0-9_-]+)+$/.test(selector)) return null;
  return selector.slice(1).split('.');
}

/** Class-selector count is the whole specificity here, by construction. */
const specificityOf = (classes) => classes.length;

/**
 * Class combinations that actually occur on one element, read from the source.
 *
 * `el('button.chip.chip-quiet')` is the convention (see src/ui/dom.js), and a
 * `class:` prop merges further classes onto the same node, so both are read.
 */
export function readClassSets(dir = path.join(ROOT, 'src')) {
  const sets = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.js')) {
        const src = fs.readFileSync(p, 'utf8');
        // el('tag.a.b', ...) and el(`tag.a.b${cond ? '' : '.c'}.d`, ...)
        //
        // Template specs are real and there are four of them. Splitting the
        // raw spec on '.' turns `div.gap-num${accent ? '' : '.plain'}.num`
        // into the class name "gap-num${accent ? " -- a name that matches no
        // rule, which made those four elements invisible to both checks below
        // AND showed up as four phantom unstyled classes. Classes are pulled
        // out by pattern instead, including the ones inside a conditional,
        // since either branch can reach the DOM.
        //
        // `${...}` blocks are handled explicitly rather than by one clever
        // pattern: pull the class names out of any string literal inside the
        // block, then delete the block and split what remains on '.' as
        // before. A single regex over the whole spec cannot tell the '.' in
        // `div.row-shell` (tag to class) from the one in `${x.length}`
        // (property access) -- the first attempt used a lookbehind and
        // silently rejected EVERY first class in the app, reporting zero
        // combinations. Which the caller would have read as "nothing to
        // check" rather than "the reader is broken", so readClassSets is
        // asserted non-trivial in tests/deadcss.test.mjs.
        //
        // Two patterns, not one with a backreference: a template spec contains
        // SINGLE QUOTES inside its `${...}` block, so a character class that
        // excludes all three quote characters stops matching at the first one
        // and the four template specs were never read at all.
        const specs = [
          ...[...src.matchAll(/\bel\(\s*(['"])([^'"]*)\1/g)].map((m) => m[2]),
          ...[...src.matchAll(/\bel\(\s*`([^`]*)`/g)].map((m) => m[1]),
        ];
        for (const spec of specs) {
          const conditional = [];
          const flat = spec.replace(/\$\{[^}]*\}/g, (block) => {
            for (const lit of block.matchAll(/['"]([^'"]*)['"]/g)) {
              for (const c of lit[1].split('.')) if (c) conditional.push(c);
            }
            return '';
          });
          const [, ...classes] = flat.split('.');
          const base = classes.map((c) => c.split('#')[0]).filter(Boolean);
          const rel = path.relative(ROOT, p);

          // BOTH BRANCHES, as two separate elements. A conditional class is
          // present on some elements and absent on others, and recording it as
          // always-present is wrong in the direction that matters: it made
          // `.setlist-song { color }` look dead because `.setlist-song.jam`
          // overrides colour, when the class it is "beaten by" is exactly the
          // one that is missing from every non-jam song. Two entries, so a
          // declaration only counts as dead if it loses on BOTH.
          if (base.length) sets.push({ classes: base, file: rel });
          if (conditional.length) {
            sets.push({ classes: [...base, ...conditional], file: rel });
          }
        }
        // A `class:` prop adds to whatever the spec already set. Only literal
        // values are read; a computed one is unknowable from the source and is
        // better skipped than guessed at.
        for (const m of src.matchAll(/\bel\(\s*['"`]([^'"`]+)['"`][\s\S]{0,200}?\bclass:\s*['"`]([^'"`]+)['"`]/g)) {
          const [, ...base] = m[1].split('.');
          const extra = m[2].trim().split(/\s+/);
          const clean = [...base.map((c) => c.split('#')[0]), ...extra].filter(Boolean);
          if (clean.length) sets.push({ classes: clean, file: path.relative(ROOT, p) });
        }
      }
    }
  };
  walk(dir);
  return sets;
}

/**
 * Declarations that lose the cascade for every element they can apply to.
 *
 * A rule is only reported when it has at least one co-occurring class set to
 * be judged against. A rule nothing can match is a different problem (an
 * unused selector) and is not what this claims to find -- reporting it here
 * would blur what a failure means.
 */
export function findDead(cssPath = path.join(ROOT, 'src/styles/app.css'), sets = readClassSets()) {
  const rules = parseRules(fs.readFileSync(cssPath, 'utf8'));
  const chained = rules
    .map((r) => ({ ...r, classes: pureClassChain(r.selector) }))
    .filter((r) => r.classes);

  const dead = [];
  for (const rule of chained) {
    // Which real elements can carry every class this selector needs?
    const applicable = sets.filter((s) => rule.classes.every((c) => s.classes.includes(c)));
    if (!applicable.length) continue;

    for (const [prop, value] of rule.decls) {
      const props = expand(prop);
      let winsSomewhere = false;

      for (const set of applicable) {
        // Every rule that also applies to this element and touches any of the
        // property names this declaration sets.
        const rivals = chained.filter(
          (o) =>
            o !== rule &&
            o.classes.every((c) => set.classes.includes(c)) &&
            [...o.decls.keys()].some((k) => expand(k).some((e) => props.includes(e))),
        );
        const beaten = rivals.some((o) => {
          const so = specificityOf(o.classes);
          const sr = specificityOf(rule.classes);
          return so > sr || (so === sr && o.order > rule.order);
        });
        if (!beaten) { winsSomewhere = true; break; }
      }

      if (!winsSomewhere) {
        const beatenBy = applicable
          .flatMap((set) =>
            chained.filter(
              (o) =>
                o !== rule &&
                o.classes.every((c) => set.classes.includes(c)) &&
                [...o.decls.keys()].some((k) => expand(k).some((e) => props.includes(e))) &&
                (specificityOf(o.classes) > specificityOf(rule.classes) ||
                  (specificityOf(o.classes) === specificityOf(rule.classes) && o.order > rule.order)),
            ),
          )
          .map((o) => o.selector);
        dead.push({
          selector: rule.selector,
          prop,
          value,
          beatenBy: [...new Set(beatenBy)],
          on: [...new Set(applicable.map((s) => s.classes.join('.')))],
        });
      }
    }
  }
  return dead;
}

/**
 * Classes the app emits that NO stylesheet rule mentions anywhere.
 *
 * A different failure from a dead declaration and it needed its own check:
 * `.jam-card` was emitted on every jam entry with no rule behind it, while its
 * three children `.jam-card-head`, `-song` and `-note` all had one, and the
 * spacing it should have carried sat in a hardcoded inline `marginBottom:
 * '8px'` at the call site. findDead() cannot see that -- there is no
 * declaration to be beaten. `.gap-num.plain` was the same shape in 0.1.58.
 *
 * The damage is that the class LOOKS like a styling hook. The next person to
 * restyle these edits `.jam-card`, sees nothing change, and goes looking for a
 * specificity problem that does not exist.
 *
 * ALLOWED lists the classes that are deliberately not styled, each with a
 * reason. An allowlist is a liability -- it is where a check goes to die -- so
 * it names exact classes, never patterns, and every entry has to say why.
 */
export const UNSTYLED_ALLOWED = {
  // Structural hooks the checks and the router query, never painted.
  screen: 'route marker: every view is a .screen, and the boot checks wait on it',
  section: 'grouping wrapper; every visual rule is on its children',
  'row-main': 'flex child of .row; sized by .row, targeted by .row-main > .venue-line',
};

export function findUnstyled(cssPaths, sets = readClassSets()) {
  const paths = cssPaths || [
    path.join(ROOT, 'src/styles/app.css'),
    path.join(ROOT, 'src/styles/tokens.css'),
  ];
  // SELECTORS ONLY, never the raw file.
  //
  // The first version tested the class name against the whole stylesheet text
  // and could not be made to fail on the bug it was written for: the comment
  // explaining why `.jam-card` needed a rule itself contains the string
  // `.jam-card`, so deleting the rule left the check green. Prose about a class
  // is not a rule for it. Parsing to selectors also stops a class name inside a
  // property value or a token comment from counting.
  const selectors = paths.flatMap((p) => parseRules(fs.readFileSync(p, 'utf8')).map((r) => r.selector));
  const used = new Map();
  for (const s of sets) for (const c of s.classes) if (!used.has(c)) used.set(c, s.file);

  const out = [];
  for (const [cls, file] of used) {
    if (UNSTYLED_ALLOWED[cls]) continue;
    // Word-boundary on the class name so `.jam-card` is not considered styled
    // by `.jam-card-head`, which is the precise mistake that hid it.
    const re = new RegExp(`\\.${cls}(?![\\w-])`);
    if (!selectors.some((sel) => re.test(sel))) out.push({ cls, file });
  }
  return out;
}

// Runnable on its own, the way scripts/contrast.mjs is. pathToFileURL, not a
// hand-built file:// string -- on Windows that produces `file://C:/...` with a
// slash missing, never matches, and the script exits 0 having printed nothing.
// Which is indistinguishable from a clean run.
// argv[1] is guarded: it is undefined when this module is imported from a
// context without a script path (`node -e`, some runners), and pathToFileURL
// throws on undefined -- so an unguarded check crashes the IMPORT rather than
// skipping the CLI block.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sets = readClassSets();
  const dead = findDead(undefined, sets);
  const unstyled = findUnstyled(undefined, sets);
  console.log(`read ${sets.length} class combinations from src/`);
  if (!dead.length) console.log('no dead declarations in src/styles/app.css');
  for (const d of dead) {
    console.log(
      `DEAD  ${d.selector} { ${d.prop}: ${d.value} }\n      beaten by ${d.beatenBy.join(', ')} on .${d.on[0]}`,
    );
  }
  if (!unstyled.length) console.log('every emitted class matches a rule');
  for (const u of unstyled) {
    console.log(`UNSTYLED  .${u.cls} is emitted (${u.file}) but no rule mentions it`);
  }
  process.exit(dead.length + unstyled.length ? 1 : 0);
}
