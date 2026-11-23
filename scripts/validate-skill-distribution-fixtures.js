#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = 'docs/fixtures/skill-distribution';
const VALID_MANIFEST = `${FIXTURES}/valid/skills.toml`;
const VALID_LOCK = `${FIXTURES}/valid/skills.lock.toml`;
const INVALID = `${FIXTURES}/invalid`;
const ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SHARED_LINK_RE = /(?:\.\.\/)+(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.[A-Za-z0-9]+(?:#[A-Za-z0-9._-]+)?/g;

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function parseToml(text, file) {
  let i = 0;
  const root = {};
  let current = root;

  function lineAt(position) {
    return text.slice(0, position).split('\n').length;
  }

  function error(message) {
    fail(`${file}:${lineAt(i)}: ${message}`);
  }

  function skipWsAndComments() {
    for (;;) {
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text[i] === '#') {
        while (i < text.length && text[i] !== '\n') i++;
        continue;
      }
      break;
    }
  }

  function skipInlineWs() {
    while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\r')) i++;
  }

  function parseString() {
    const quote = text[i++];
    let out = '';
    while (i < text.length) {
      const ch = text[i++];
      if (ch === quote) return out;
      if (quote === '"' && ch === '\\') {
        const esc = text[i++];
        const map = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' };
        if (esc === 'u') {
          const hex = text.slice(i, i + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) error('invalid unicode escape');
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else if (map[esc] !== undefined) {
          out += map[esc];
        } else {
          error(`invalid escape \\${esc}`);
        }
      } else {
        out += ch;
      }
    }
    error('unterminated string');
  }

  function parseKeySegment() {
    if (text[i] === '"' || text[i] === "'") return parseString();
    const start = i;
    while (i < text.length && /[A-Za-z0-9_-]/.test(text[i])) i++;
    if (i === start) error('expected key');
    return text.slice(start, i);
  }

  function parseDottedKey() {
    const segments = [parseKeySegment()];
    skipInlineWs();
    while (text[i] === '.') {
      i++;
      skipInlineWs();
      segments.push(parseKeySegment());
      skipInlineWs();
    }
    return segments;
  }

  function parseValue() {
    skipWsAndComments();
    const ch = text[i];
    if (ch === '"' || ch === "'") return parseString();
    if (ch === '[') {
      i++;
      const array = [];
      for (;;) {
        skipWsAndComments();
        if (text[i] === ']') {
          i++;
          return array;
        }
        array.push(parseValue());
        skipWsAndComments();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === ']') {
          i++;
          return array;
        }
        error('expected , or ]');
      }
    }
    if (ch === '-' || /[0-9]/.test(ch)) {
      const start = i;
      if (text[i] === '-') i++;
      while (/[0-9]/.test(text[i])) i++;
      return Number(text.slice(start, i));
    }
    if (text.startsWith('true', i)) {
      i += 4;
      return true;
    }
    if (text.startsWith('false', i)) {
      i += 5;
      return false;
    }
    error('unsupported value');
  }

  function tableAt(segments, base = root) {
    let target = base;
    for (const segment of segments) {
      if (target[segment] === undefined) target[segment] = {};
      if (target[segment] === null || typeof target[segment] !== 'object' || Array.isArray(target[segment])) {
        error(`table ${segments.join('.')} conflicts with a value`);
      }
      target = target[segment];
    }
    return target;
  }

  function arrayTableAt(segments, base = root) {
    const parent = tableAt(segments.slice(0, -1), base);
    const key = segments[segments.length - 1];
    if (parent[key] === undefined) parent[key] = [];
    if (!Array.isArray(parent[key])) error(`array table ${segments.join('.')} conflicts with a value`);
    const entry = {};
    parent[key].push(entry);
    return entry;
  }

  function assign(target, segments, value) {
    const owner = tableAt(segments.slice(0, -1), target);
    const key = segments[segments.length - 1];
    if (Object.prototype.hasOwnProperty.call(owner, key)) error(`duplicate key ${segments.join('.')}`);
    owner[key] = value;
  }

  for (;;) {
    skipWsAndComments();
    if (i >= text.length) break;
    if (text[i] === '[') {
      const isArrayTable = text[i + 1] === '[';
      i += isArrayTable ? 2 : 1;
      skipInlineWs();
      const segments = parseDottedKey();
      skipInlineWs();
      if (isArrayTable) {
        if (text[i] !== ']' || text[i + 1] !== ']') error('expected ]]');
        i += 2;
        current = arrayTableAt(segments);
      } else {
        if (text[i] !== ']') error('expected ]');
        i++;
        current = tableAt(segments);
      }
    } else {
      const segments = parseDottedKey();
      skipInlineWs();
      if (text[i] !== '=') error('expected =');
      i++;
      assign(current, segments, parseValue());
    }
    skipInlineWs();
    if (text[i] === '#') {
      while (i < text.length && text[i] !== '\n') i++;
    }
    if (i < text.length && text[i] !== '\n' && text[i] !== '\r') error('expected newline');
  }

  return root;
}

function normalizeContent(buffer) {
  const out = Buffer.alloc(buffer.length);
  let offset = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0x0d) {
      if (buffer[i + 1] === 0x0a) i++;
      out[offset++] = 0x0a;
    } else {
      out[offset++] = buffer[i];
    }
  }
  return out.subarray(0, offset);
}

function assertSafePath(value, label) {
  assert(typeof value === 'string' && value.length > 0, `${label} must be a non-empty string`);
  assert(!value.includes('\\') && !value.includes('\0'), `${label} must not contain backslashes or NUL`);
  assert(!value.startsWith('/') && !/^[A-Za-z]:/.test(value), `${label} must be relative`);
  const parts = value.split('/');
  assert(
    parts.every(
      (part) =>
        part &&
        part !== '.' &&
        part !== '..' &&
        !/[. ]$/.test(part) &&
        !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i.test(part),
    ),
    `${label} has an unsafe segment: ${value}`,
  );
}

function git(args, options = {}) {
  return execFileSync('git', ['-C', ROOT, ...args], {
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
}

function gitText(args) {
  return git(args, { encoding: 'utf8' });
}

function treeFiles(commit, treePath) {
  const output = gitText(['ls-tree', '-r', '--name-only', commit, '--', treePath]).trim();
  return output ? output.split('\n') : [];
}

function treeExists(commit, filePath) {
  try {
    git(['cat-file', '-e', `${commit}:${filePath}`]);
    return true;
  } catch {
    return false;
  }
}

function treeType(commit, filePath) {
  try {
    return gitText(['cat-file', '-t', `${commit}:${filePath}`]).trim();
  } catch {
    return null;
  }
}

function treeContent(commit, filePath) {
  return git(['show', `${commit}:${filePath}`]);
}

function contentHash(rootPath, files, commit) {
  const entries = files
    .map((file) => ({ file, relative: path.posix.relative(rootPath, file) }))
    .sort((a, b) => Buffer.compare(Buffer.from(a.relative), Buffer.from(b.relative)));
  const digest = crypto.createHash('sha256');
  for (const entry of entries) {
    digest.update(Buffer.from(entry.relative, 'utf8'));
    digest.update(Buffer.from([0]));
    digest.update(normalizeContent(treeContent(commit, entry.file)));
  }
  return `sha256:${digest.digest('hex')}`;
}

function fileHash(relativePath) {
  const content = fs.readFileSync(path.join(ROOT, relativePath));
  return `sha256:${crypto.createHash('sha256').update(normalizeContent(content)).digest('hex')}`;
}

function frontmatterName(text) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!frontmatter) return null;
  const name = /^name:\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))/m.exec(frontmatter[1]);
  return name ? name[1] || name[2] || name[3] : null;
}

function unique(values, label) {
  const seen = new Set();
  for (const value of values) {
    assert(!seen.has(value), `${label} contains duplicate ${value}`);
    seen.add(value);
  }
}

function validateCatalogue(catalogue, commit, sourcePath) {
  assert(catalogue.schema === 1, 'catalogue schema must be 1');
  assert(catalogue.upstream && typeof catalogue.upstream.repository === 'string', 'catalogue upstream.repository is required');
  assert(Array.isArray(catalogue.skill) && catalogue.skill.length > 0, 'catalogue skill entries are required');

  const ids = new Map();
  const skillPaths = new Set();
  for (const skill of catalogue.skill) {
    assert(typeof skill.id === 'string' && ID_RE.test(skill.id), `invalid skill id: ${skill.id}`);
    const lower = skill.id.toLowerCase();
    assert(!ids.has(lower), `config.duplicate_id: ${skill.id}`);
    ids.set(lower, skill);
    assert(skill.ownership === 'upstream' || skill.ownership === 'custom', `invalid ownership for ${skill.id}`);

    const skillPath = skill.path || `${sourcePath}/${skill.id}`;
    assertSafePath(skillPath, `skill path ${skill.id}`);
    assert(skillPath.startsWith(`${sourcePath}/`) && skillPath.endsWith(`/${skill.id}`), `skill path must be under ${sourcePath} and end with /${skill.id}: ${skillPath}`);
    assert(!skillPaths.has(skillPath), `duplicate skill path: ${skillPath}`);
    skillPaths.add(skillPath);
    assert(treeType(commit, skillPath) === 'tree', `skill path missing at pinned commit: ${skillPath}`);

    const skillFile = `${skillPath}/SKILL.md`;
    assert(treeExists(commit, skillFile), `missing ${skillFile} at pinned commit`);
    assert(frontmatterName(treeContent(commit, skillFile).toString('utf8')) === skill.id, `frontmatter name mismatch for ${skill.id}`);

    if (skill.ownership === 'upstream') assert(skill.diverged_from === undefined, `upstream skill ${skill.id} must not declare diverged_from`);
    if (skill.diverged_from !== undefined) assert(typeof skill.diverged_from === 'string' && skill.diverged_from.length > 0, `invalid diverged_from for ${skill.id}`);
  }

  const directories = new Set();
  for (const file of treeFiles(commit, sourcePath)) {
    const parts = file.split('/');
    if (parts.length >= 2) directories.add(parts[1]);
  }
  const lowerDirectories = new Set([...directories].map((directory) => directory.toLowerCase()));
  for (const directory of directories) assert(ids.has(directory.toLowerCase()), `config.invalid_id: ${sourcePath}/${directory} is missing from the catalogue`);
  for (const id of ids.keys()) assert(lowerDirectories.has(id), `catalogue skill ${id} has no directory under ${sourcePath}`);

  const sharedIds = new Set();
  const sharedPaths = [];
  const shared = catalogue.shared || [];
  for (const resource of shared) {
    assert(typeof resource.id === 'string' && ID_RE.test(resource.id), `invalid shared id: ${resource.id}`);
    const lower = resource.id.toLowerCase();
    assert(!sharedIds.has(lower), `config.duplicate_id: ${resource.id}`);
    sharedIds.add(lower);
    assert(resource.ownership === 'upstream' || resource.ownership === 'custom', `invalid ownership for shared ${resource.id}`);
    assertSafePath(resource.path, `shared path ${resource.id}`);
    assert(!resource.path.startsWith(`${sourcePath}/`), `shared path must not be under ${sourcePath}: ${resource.path}`);
    assert(!sharedPaths.includes(resource.path), `duplicate shared path: ${resource.path}`);
    for (const other of sharedPaths) {
      assert(!resource.path.startsWith(`${other}/`) && !other.startsWith(`${resource.path}/`), `shared paths overlap: ${other} and ${resource.path}`);
    }
    sharedPaths.push(resource.path);
    assert(treeType(commit, resource.path) === 'tree', `shared path missing at pinned commit: ${resource.path}`);
    if (resource.ownership === 'upstream') assert(resource.diverged_from === undefined, `upstream shared ${resource.id} must not declare diverged_from`);
  }

  return { shared };
}

function resolveSelection(manifest, catalogue) {
  assert(manifest.schema === 1, 'manifest schema must be 1');
  assert(manifest.source && typeof manifest.source.repository === 'string', 'manifest source.repository is required');
  assert(typeof manifest.source.ref === 'string' && /^[0-9a-f]{40}$/.test(manifest.source.ref), 'manifest source.ref must be a full 40-hex SHA');

  const byId = new Map(catalogue.skill.map((skill) => [skill.id, skill]));
  const selected = new Set();
  const profileName = manifest.selection && manifest.selection.profile;
  const profile = profileName ? manifest.profiles && manifest.profiles[profileName] : undefined;
  assert(!profileName || profile, `unknown profile: ${profileName}`);

  const includes = [...((profile && profile.include) || []), ...((manifest.selection && manifest.selection.include) || [])];
  unique(includes, 'manifest include');
  for (const id of includes) {
    assert(byId.has(id), `selection.unknown_skill: ${id}`);
    selected.add(id);
  }

  const excludes = [...((profile && profile.exclude) || []), ...((manifest.selection && manifest.selection.exclude) || [])];
  unique(excludes, 'manifest exclude');
  for (const id of excludes) selected.delete(id);

  assert(selected.size > 0, 'selection.empty');
  return [...selected].sort();
}

function stripFences(text) {
  let fence = null;
  return text
    .split('\n')
    .map((line) => {
      const match = /^\s*(`{3,}|~{3,})/.exec(line);
      if (fence) {
        if (match && match[1][0] === fence[0] && match[1].length >= fence.length) fence = null;
        return '';
      }
      if (match) {
        fence = match[1];
        return '';
      }
      return line;
    })
    .join('\n');
}

function discoverShared(selected, sharedRoots, commit, sourcePath) {
  const required = new Map();
  for (const id of selected) {
    const skillPath = `${sourcePath}/${id}`;
    for (const file of treeFiles(commit, skillPath)) {
      if (!file.endsWith('.md')) continue;
      const text = stripFences(treeContent(commit, file).toString('utf8'));
      for (const match of text.matchAll(SHARED_LINK_RE)) {
        const raw = match[0];
        const token = raw.split('#')[0];
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), token));
        if (resolved === '..' || resolved.startsWith('../')) fail(`shared.outside_root: ${file} -> ${raw}`);
        const root = sharedRoots.find((resource) => resolved === resource.path || resolved.startsWith(`${resource.path}/`));
        if (!root) fail(`shared.outside_root: ${file} -> ${raw}`);
        if (!treeExists(commit, resolved)) fail(`shared.missing: ${file} -> ${raw}`);
        if (treeType(commit, resolved) !== 'blob') fail(`shared.outside_root: ${file} -> ${raw} is not a regular file`);
        if (!required.has(root.id)) required.set(root.id, new Set());
        required.get(root.id).add(path.posix.relative(root.path, resolved));
      }
    }
  }

  const result = new Map();
  for (const [id, files] of required) {
    const root = sharedRoots.find((resource) => resource.id === id);
    const sorted = [...files].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    result.set(id, {
      id,
      source: 'canonical',
      path: root.path,
      files: sorted,
      hash: contentHash(root.path, sorted.map((file) => `${root.path}/${file}`), commit),
    });
  }
  return result;
}

function validateValidFixture(manifest, lock, catalogue, manifestPath) {
  const commit = manifest.source.ref;
  const sourcePath = manifest.source.path || 'skills';
  const cataloguePath = manifest.source.catalogue_path || 'catalogue.toml';
  assert(treeExists(commit, cataloguePath), `pinned commit ${commit} lacks ${cataloguePath}`);

  const { shared: sharedRoots } = validateCatalogue(catalogue, commit, sourcePath);
  const selected = resolveSelection(manifest, catalogue);
  const expectedShared = discoverShared(selected, sharedRoots, commit, sourcePath);

  assert(lock.schema === 1, 'lock schema must be 1');
  assert(lock.manifest && lock.manifest.sha256 === fileHash(manifestPath), 'lock.stale_manifest');

  const sources = lock.source || [];
  const canonical = sources.find((source) => source.id === 'canonical');
  assert(canonical, 'lock canonical source is required');
  assert(canonical.kind === 'git', 'lock canonical source must be git');
  assert(canonical.repository === manifest.source.repository, 'lock.source_drift: repository');
  assert(canonical.requested_ref === commit, 'lock.ref_drift: requested_ref');
  assert(canonical.commit === commit, 'lock.source_drift: commit');
  assert((canonical.path || 'skills') === sourcePath, 'lock.source_drift: path');
  assert((canonical.catalogue_path || 'catalogue.toml') === cataloguePath, 'lock.source_drift: catalogue_path');

  const lockedSelection = (lock.selection && lock.selection.skills) || [];
  assert(Array.isArray(lockedSelection), 'lock selection.skills must be an array');
  assert(lockedSelection.join('\0') === selected.join('\0'), 'lock.selection_drift');

  const lockedSkills = lock.skill || [];
  assert(lockedSkills.length === selected.length, 'lock skill count mismatch');
  for (const id of selected) {
    const entry = lockedSkills.find((skill) => skill.id === id);
    assert(entry, `lock missing skill: ${id}`);
    assert(entry.source === 'canonical', `lock skill source mismatch: ${id}`);
    const skillPath = `${sourcePath}/${id}`;
    assert(entry.path === skillPath, `lock skill path mismatch: ${id}`);
    const expectedHash = contentHash(skillPath, treeFiles(commit, skillPath), commit);
    assert(entry.hash === expectedHash, `lock.hash_mismatch: ${id}`);
  }

  const lockedShared = lock.shared || [];
  assert(lockedShared.length === expectedShared.size, 'lock shared count mismatch');
  for (const [id, expected] of expectedShared) {
    const entry = lockedShared.find((resource) => resource.id === id);
    assert(entry, `lock missing shared resource: ${id}`);
    assert(entry.source === 'canonical', `lock shared source mismatch: ${id}`);
    assert(entry.path === expected.path, `lock shared path mismatch: ${id}`);
    assert(Array.isArray(entry.files) && entry.files.join('\0') === expected.files.join('\0'), `lock.shared_drift: ${id} files`);
    assert(entry.hash === expected.hash, `lock.shared_drift: ${id} hash`);
  }
  for (const entry of lockedShared) assert(expectedShared.has(entry.id), `unexpected lock shared resource: ${entry.id}`);

  return { selected, shared: expectedShared };
}

function validateInvalidFixtures(catalogue, validManifest, validLock, manifestPath) {
  const missing = parseToml(fs.readFileSync(path.join(ROOT, `${INVALID}/missing-skill.toml`), 'utf8'), `${INVALID}/missing-skill.toml`);
  assert(/^[0-9a-f]{40}$/.test(missing.source && missing.source.ref), 'missing-skill fixture must pin a full SHA');
  const byId = new Set(catalogue.skill.map((skill) => skill.id));
  const profile = missing.profiles && missing.profiles[missing.selection && missing.selection.profile];
  const includes = [...((profile && profile.include) || []), ...((missing.selection && missing.selection.include) || [])];
  assert(includes.some((id) => !byId.has(id)), 'missing-skill fixture must name an unknown skill');

  const duplicate = parseToml(
    fs.readFileSync(path.join(ROOT, `${INVALID}/duplicate-name-catalogue.toml`), 'utf8'),
    `${INVALID}/duplicate-name-catalogue.toml`,
  );
  const duplicateIds = duplicate.skill.map((skill) => skill.id.toLowerCase());
  assert(new Set(duplicateIds).size !== duplicateIds.length, 'duplicate-name fixture must contain a duplicate id');

  const drift = parseToml(fs.readFileSync(path.join(ROOT, `${INVALID}/ref-drift.lock.toml`), 'utf8'), `${INVALID}/ref-drift.lock.toml`);
  assert(drift.manifest && drift.manifest.sha256 === fileHash(manifestPath), 'ref-drift fixture manifest hash must match the valid manifest');
  const driftSource = (drift.source || []).find((source) => source.id === 'canonical');
  assert(driftSource, 'ref-drift fixture must declare a canonical source');
  assert(driftSource.requested_ref !== validManifest.source.ref, 'ref-drift fixture must request a different ref');
  assert(driftSource.commit === validManifest.source.ref, 'ref-drift fixture commit must match the valid manifest');
  assert(JSON.stringify(drift.shared) === JSON.stringify(validLock.shared), 'ref-drift fixture must differ only by requested_ref');
}

function collectTomlFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(path.join(ROOT, directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...collectTomlFiles(relative));
    else if (entry.name.endsWith('.toml')) files.push(relative);
  }
  return files;
}

function main() {
  const fixtureFiles = collectTomlFiles(FIXTURES);
  for (const file of fixtureFiles) {
    parseToml(fs.readFileSync(path.join(ROOT, file), 'utf8'), file);
  }

  const workingCatalogue = parseToml(fs.readFileSync(path.join(ROOT, 'catalogue.toml'), 'utf8'), 'catalogue.toml');
  const manifest = parseToml(fs.readFileSync(path.join(ROOT, VALID_MANIFEST), 'utf8'), VALID_MANIFEST);
  const commit = manifest.source && manifest.source.ref;
  assert(/^[0-9a-f]{40}$/.test(commit), 'valid fixture must pin a full SHA');
  const sourcePath = manifest.source.path || 'skills';
  const cataloguePath = manifest.source.catalogue_path || 'catalogue.toml';
  assert(treeExists(commit, cataloguePath), `pinned commit ${commit} lacks ${cataloguePath}`);
  const pinnedCatalogue = parseToml(treeContent(commit, cataloguePath).toString('utf8'), `${commit}:${cataloguePath}`);
  assert(JSON.stringify(pinnedCatalogue) === JSON.stringify(workingCatalogue), 'pinned catalogue differs from the working tree catalogue');

  validateCatalogue(pinnedCatalogue, commit, sourcePath);
  const lock = parseToml(fs.readFileSync(path.join(ROOT, VALID_LOCK), 'utf8'), VALID_LOCK);
  const { selected, shared } = validateValidFixture(manifest, lock, pinnedCatalogue, VALID_MANIFEST);
  validateInvalidFixtures(pinnedCatalogue, manifest, lock, VALID_MANIFEST);
  const sharedFileCount = [...shared.values()].reduce((total, resource) => total + resource.files.length, 0);

  console.log('Skill distribution fixtures');
  console.log(`  ✓ catalogue.toml (${pinnedCatalogue.skill.length} skills, ${(pinnedCatalogue.shared || []).length} shared roots)`);
  console.log(`  ✓ ${VALID_MANIFEST} (${selected.length} selected skills)`);
  console.log(`  ✓ ${VALID_LOCK} (${shared.size} shared roots, ${sharedFileCount} shared files)`);
  console.log(`  ✓ ${INVALID}/missing-skill.toml (selection.unknown_skill)`);
  console.log(`  ✓ ${INVALID}/duplicate-name-catalogue.toml (config.duplicate_id)`);
  console.log(`  ✓ ${INVALID}/ref-drift.lock.toml (lock.ref_drift)`);
  console.log(`PASSED — ${fixtureFiles.length} fixture files checked`);
}

module.exports = {
  parseToml,
  normalizeContent,
  contentHash,
  discoverShared,
  resolveSelection,
  validateCatalogue,
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
