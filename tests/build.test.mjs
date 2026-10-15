import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from '../scripts/build.mjs';

test('the build inlines every illustration and versions every CSS/JS reference', async () => {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minmin-build-'));
  try {
    const { artwork } = await build({ outDir });
    const html = await fs.readFile(path.join(outDir, 'index.html'), 'utf8');
    assert.equal(artwork, 30);
    assert.equal((html.match(/<svg data-artwork=/g) || []).length, artwork);
    assert.doesNotMatch(html, /<svg data-artwork="[^"]+"[^>]*><\/svg>/, 'no empty placeholders remain');
    assert.match(html, /href="styles\.css\?v=[0-9a-f]{10}"/);
    assert.match(html, /src="app\.js\?v=[0-9a-f]{10}"/);
    const app = await fs.readFile(path.join(outDir, 'app.js'), 'utf8');
    for (const dependency of ['data.js', 'artwork.js', 'lead.js']) {
      const versioned = app.match(new RegExp(`from '[.]/${dependency.replace('.', '[.]')}[?]v=([0-9a-f]{10})'`));
      assert.ok(versioned, `app.js imports a versioned ${dependency}`);
    }
    const { programArt } = await import(pathToFileURL(path.join(outDir, 'artwork.js')).href);
    assert.deepEqual(Object.keys(programArt), ['children', 'adults', 'exams', 'business']);
    await fs.access(path.join(outDir, 'assets/teachers/margarita.jpg'));
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
});
