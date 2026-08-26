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
        // el('tag.a.b', ...) and el(`tag.a.b`, ...)
        for (const m of src.matchAll(/\bel\(\s*['"`]([^'"`]+)['"`]/g)) {
          const spec = m[1];
          const [, ...classes] = spec.split('.');
          const clean = classes.map((c) => c.split('#')[0]).filter(Boolean);
          if (clean.length) sets.push({ classes: clean, file: path.relative(ROOT, p) });
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

// Runnable on its own, the way scripts/contrast.mjs is. pathToFileURL, not a
// hand-built file:// string -- on Windows that produces `file://C:/...` with a
// slash missing, never matches, and the script exits 0 having printed nothing.
// Which is indistinguishable from a clean run.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sets = readClassSets();
  const dead = findDead(undefined, sets);
  console.log(`read ${sets.length} class combinations from src/`);
  if (!dead.length) console.log('no dead declarations in src/styles/app.css');
  for (const d of dead) {
    console.log(
      `DEAD  ${d.selector} { ${d.prop}: ${d.value} }\n      beaten by ${d.beatenBy.join(', ')} on .${d.on[0]}`,
    );
  }
  process.exit(dead.length ? 1 : 0);
}
