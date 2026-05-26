#!/usr/bin/env node
// Usage: node add_bias_theme.js "Theme Name" "Issue label (e.g. Vol. 12)"
// Adds a used theme to bias_history.json so future digests can flag repeats.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_FILE = join(__dirname, 'data', 'bias_history.json');

const [theme, issue] = process.argv.slice(2);
if (!theme) {
  console.error('Usage: node add_bias_theme.js "Theme Name" "Issue label"');
  process.exit(1);
}

const history = existsSync(HISTORY_FILE)
  ? JSON.parse(readFileSync(HISTORY_FILE, 'utf8'))
  : [];

history.unshift({
  theme,
  issue: issue || 'unlabeled',
  date: new Date().toISOString().split('T')[0],
});

writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
console.log(`Added: "${theme}" (${issue || 'unlabeled'}) to bias_history.json`);
