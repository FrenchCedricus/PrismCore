// Chargeur de plugins : exécute chaque plugin (module ES) dans un contexte V8 isolé,
// avec ses propres globales (device, bus, propriétés utilisateur…).
// Nécessite node --experimental-vm-modules (géré par index.js).

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { createSdk } from './sdk.js';

/**
 * @param {string} file chemin absolu du plugin
 * @param {object} globals objets exposés en global (device, bus, console…)
 * @param {(msg:string)=>void} log
 * @returns {Promise<{ ns: Record<string, any>, context: object }>}
 */
export async function loadPlugin(file, globals, log) {
  const context = vm.createContext({ ...globals });
  const sdk = createSdk({ log });
  const modules = new Map();

  function sourceModule(p) {
    if (modules.has(p)) return modules.get(p);
    const code = fs.readFileSync(p, 'utf8');
    const m = new vm.SourceTextModule(code, { identifier: p, context });
    modules.set(p, m);
    return m;
  }

  function sdkModule(name) {
    const key = `@sdk/${name}`;
    if (modules.has(key)) return modules.get(key);
    const exportsObj = sdk[name] ?? sdk.__unknown(name);
    const names = Object.keys(exportsObj);
    const m = new vm.SyntheticModule(names, function () {
      for (const n of names) this.setExport(n, exportsObj[n]);
    }, { identifier: key, context });
    modules.set(key, m);
    return m;
  }

  async function linker(specifier, referencing) {
    if (specifier.startsWith('@SignalRGB/')) {
      return sdkModule(specifier.slice('@SignalRGB/'.length).replace(/\.js$/i, ''));
    }
    const target = path.resolve(path.dirname(referencing.identifier), specifier);
    return sourceModule(target);
  }

  const root = sourceModule(file);
  await root.link(linker);
  await root.evaluate();
  return { ns: root.namespace, context };
}

/** Appelle une fonction exportée si elle existe, sinon renvoie `fallback`. */
export function call(ns, name, fallback, ...args) {
  return typeof ns[name] === 'function' ? ns[name](...args) : fallback;
}
