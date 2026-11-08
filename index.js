#!/usr/bin/env node
// Point d'entrée : relance Node avec --experimental-vm-modules si nécessaire
// (le chargeur de plugins utilise vm.SourceTextModule).

import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (typeof vm.SourceTextModule !== 'function') {
  const child = spawn(process.execPath, ['--experimental-vm-modules', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.on('SIGINT', () => {}); // l'enfant reçoit lui-même Ctrl+C et s'arrête proprement
  child.on('exit', (code) => process.exit(code ?? 0));
} else {
  const { main } = await import('./src/cli.js');
  await main(process.argv.slice(2));
}
