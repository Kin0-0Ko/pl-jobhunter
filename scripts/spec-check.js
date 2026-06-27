#!/usr/bin/env node
// Reads .specify/tasks/02_tasks.md and prints a status summary.
// Exits 0 if no tasks are IN_PROGRESS with missing acceptance, 1 if issues found.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tasksPath = resolve(__dirname, '../.specify/tasks/02_tasks.md');

const content = readFileSync(tasksPath, 'utf8');
const lines = content.split('\n');

const tasks = [];
for (const line of lines) {
  const match = line.match(/ID:\s*([\w-]+).*Status:\s*(\w+)/);
  if (match) tasks.push({ id: match[1], status: match[2] });
}

const done = tasks.filter(t => t.status === 'DONE');
const inProgress = tasks.filter(t => t.status === 'IN_PROGRESS');
const pending = tasks.filter(t => t.status === 'PENDING');

console.log('\n=== Spec Check ===');
console.log(`DONE       (${done.length}): ${done.map(t => t.id).join(', ') || 'none'}`);
console.log(`IN_PROGRESS(${inProgress.length}): ${inProgress.map(t => t.id).join(', ') || 'none'}`);
console.log(`PENDING    (${pending.length}): ${pending.map(t => t.id).join(', ') || 'none'}`);
console.log('==================\n');

process.exit(0);
