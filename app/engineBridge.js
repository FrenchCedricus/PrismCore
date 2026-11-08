// Pont entre le processus principal Electron et le processus moteur (src/daemon.js).
// Le moteur tourne dans un processus Node séparé : les plugins font des pauses synchrones
// qui bloqueraient l'interface s'ils s'exécutaient dans le processus principal.

import { fork } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAEMON = path.join(ROOT, 'src', 'daemon.js').replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked');

export class EngineBridge extends EventEmitter {
  constructor() {
    super();
    this.child = null;
    this.seq = 0;
    this.pending = new Map();
    this.stopping = false;
    this.restarts = 0;
  }

  start() {
    this.stopping = false;
    this.child = fork(DAEMON, [], {
      execPath: process.execPath, // Electron lui-même, en mode Node
      execArgv: ['--experimental-vm-modules', '--no-warnings'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      serialization: 'advanced', // permet d'envoyer des Uint8Array (aperçu, capture d'écran)
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const onReady = new Promise((resolve) => {
      const handler = (msg) => { if (msg?.event === 'ready') { this.child?.off('message', handler); resolve(); } };
      this.child.on('message', handler);
    });

    this.child.on('message', (msg) => {
      if (msg?.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(msg.result);
      } else if (msg?.event) {
        this.emit('event', msg.event, msg.data);
      }
    });
    this.child.stdout.on('data', (d) => this.emit('event', 'log', { level: 'debug', msg: String(d).trim(), time: Date.now() }));
    this.child.stderr.on('data', (d) => this.emit('event', 'log', { level: 'error', msg: String(d).trim(), time: Date.now() }));
    this.child.on('exit', (code) => {
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Moteur arrêté')); }
      this.pending.clear();
      this.child = null;
      if (!this.stopping) {
        this.restarts++;
        this.emit('event', 'log', { level: 'error', msg: `Le moteur s'est arrêté (code ${code}). Redémarrage…`, time: Date.now() });
        setTimeout(() => this.emit('crashed'), Math.min(10000, 1000 * this.restarts));
      }
    });
    return onReady;
  }

  /** Appel avec réponse. */
  call(method, params, timeoutMs = 20000) {
    if (!this.child) return Promise.reject(new Error('Moteur non démarré'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Délai dépassé : ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.send({ id, method, params });
    });
  }

  /** Notification sans réponse (flux audio / écran). */
  notify(method, params) {
    if (this.child?.connected) this.child.send({ method, params });
  }

  async stop() {
    this.stopping = true;
    if (!this.child) return;
    const child = this.child;
    try { await this.call('shutdown', null, 4000); } catch { /* on force ci-dessous */ }
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      const t = setTimeout(() => { child.kill(); resolve(); }, 1500);
      child.once('exit', () => { clearTimeout(t); resolve(); });
    });
  }
}
