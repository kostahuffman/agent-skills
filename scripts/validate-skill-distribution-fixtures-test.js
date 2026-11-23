#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const {
  normalizeContent,
  parseToml,
  resolveSelection,
} = require('./validate-skill-distribution-fixtures.js');

const SCRIPT = path.join(__dirname, 'validate-skill-distribution-fixtures.js');
const ROOT = path.resolve(__dirname, '..');

test('parses tables, array tables, comments, and multiline arrays', () => {
  const document = parseToml(
    [
      '# fixture',
      'schema = 1',
      '',
      '[source]',
      'repository = "owner/name"',
      'ref = "0123456789abcdef0123456789abcdef01234567"',
      '',
      '[selection]',
      'profile = "minimal"',
      'include = [',
      '  "using-agent-skills",',
      '  "code-review-and-quality",',
      ']',
      '',
      '[[shared]]',
      'id = "references"',
      'files = ["definition-of-done.md", "security-checklist.md"]',
    ].join('\n'),
    'fixture.toml',
  );

  assert.equal(document.schema, 1);
  assert.equal(document.source.repository, 'owner/name');
  assert.deepEqual(document.selection.include, ['using-agent-skills', 'code-review-and-quality']);
  assert.deepEqual(document.shared, [
    { id: 'references', files: ['definition-of-done.md', 'security-checklist.md'] },
  ]);
});

test('rejects duplicate keys', () => {
  assert.throws(
    () => parseToml('schema = 1\nschema = 2\n', 'fixture.toml'),
    /duplicate key schema/,
  );
});

test('normalizes CRLF and lone CR to LF without altering other bytes', () => {
  const input = Buffer.from([0x61, 0x0d, 0x0a, 0x62, 0x0d, 0x63, 0x00, 0xff]);
  assert.deepEqual([...normalizeContent(input)], [0x61, 0x0a, 0x62, 0x0a, 0x63, 0x00, 0xff]);
});

test('resolves profile includes, top-level includes, and excludes', () => {
  const catalogue = {
    skill: [
      { id: 'using-agent-skills' },
      { id: 'code-review-and-quality' },
      { id: 'git-workflow-and-versioning' },
    ],
  };
  const manifest = {
    schema: 1,
    source: { repository: 'owner/name', ref: '0123456789abcdef0123456789abcdef01234567' },
    selection: { profile: 'minimal', include: ['git-workflow-and-versioning'] },
    profiles: { minimal: { include: ['using-agent-skills', 'code-review-and-quality'] } },
  };

  assert.deepEqual(resolveSelection(manifest, catalogue), [
    'code-review-and-quality',
    'git-workflow-and-versioning',
    'using-agent-skills',
  ]);
});

test('checked-in fixtures resolve against the pinned commit', () => {
  const result = spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASSED/);
});
