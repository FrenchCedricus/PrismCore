// Implémentations des modules hôte importés par les plugins ("@SignalRGB/<nom>").
// Interfaces déduites des appels observés dans les plugins (voir docs/API_HOTE.md).

import { execFileSync } from 'node:child_process';

let wmiCache = null;

function wmi() {
  if (wmiCache) return wmiCache;
  const ps = [
    '$b=Get-CimInstance Win32_BaseBoard; $i=Get-CimInstance Win32_BIOS; $r=Get-CimInstance Win32_PhysicalMemory;',
    '@{board=@{manufacturer=$b.Manufacturer; model=$b.Product; version=$b.Version};',
    'bios=@{version=$i.SMBIOSBIOSVersion; manufacturer=$i.Manufacturer; date="$($i.ReleaseDate)"};',
    'ram=@($r | % { @{manufacturer=$_.Manufacturer; partNumber="$($_.PartNumber)".Trim(); capacity=$_.Capacity; speed=$_.Speed; slot=$_.DeviceLocator} })} | ConvertTo-Json -Depth 4 -Compress',
  ].join(' ');
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 15000 });
    wmiCache = JSON.parse(out);
  } catch {
    wmiCache = { board: null, bios: null, ram: [] };
  }
  return wmiCache;
}

function lenientObject(label, base, log) {
  const warned = new Set();
  return new Proxy(base, {
    get(target, prop) {
      if (prop in target || typeof prop === 'symbol') return target[prop];
      return (...args) => {
        if (!warned.has(prop)) { warned.add(prop); log(`[sdk] ${label}.${String(prop)}() non implémenté`); }
        return undefined;
      };
    },
  });
}

class AssertionError extends Error {}

/**
 * Retourne { nomDeModule: { default, ...exportsNommés } }.
 * `ctx` : { log, pluginName }
 */
export function createSdk(ctx) {
  const { log } = ctx;

  // Les variantes "soft*" (softIsDefined, softIsOk…) avertissent sans interrompre le plugin.
  const softAssert = (name) => (cond, msg) => { if (!cond) log(`[assert] ${msg ?? name}`); return !!cond; };
  const Assert = new Proxy({
    fail(msg) { throw new AssertionError(msg ?? 'Assert.fail'); },
    isOk(cond, msg) { if (!cond) throw new AssertionError(msg ?? 'Assert.isOk'); },
    isTrue(cond, msg) { if (cond !== true) throw new AssertionError(msg ?? 'Assert.isTrue'); },
    isFalse(cond, msg) { if (cond !== false) throw new AssertionError(msg ?? 'Assert.isFalse'); },
    isEqual(a, b, msg) { if (a !== b) throw new AssertionError(msg ?? `Assert.isEqual ${a} !== ${b}`); },
    isNotNull(v, msg) { if (v == null) throw new AssertionError(msg ?? 'Assert.isNotNull'); },
    isDefined(v, msg) { if (v === undefined) throw new AssertionError(msg ?? 'Assert.isDefined'); },
  }, {
    get(target, prop) {
      if (prop in target || typeof prop === 'symbol') return target[prop];
      if (String(prop).startsWith('soft')) return softAssert(String(prop));
      return (cond, msg) => { if (!cond) throw new AssertionError(msg ?? `Assert.${String(prop)}`); };
    },
  });
  class ContextError extends Error {}
  const globalContext = lenientObject('globalContext', {}, log);

  const systeminfo = lenientObject('systeminfo', {
    GetMotherboardInfo: () => wmi().board,
    GetBiosInfo: () => wmi().bios,
    GetRamInfo: () => wmi().ram,
  }, log);

  let permCallback = null;
  const granted = { lighting: true, fans: false, lcd: false };
  const permissions = lenientObject('permissions', {
    // Les plugins lisent permissions()[<partenaire>][<permission>] (ex. data["MSI"].lighting).
    permissions: () => new Proxy({}, { get: (_, k) => (typeof k === 'string' ? { ...granted } : undefined) }),
    setCallback: (cb) => { permCallback = cb; },
  }, log);

  const seenVirtual = new Set();
  const DeviceDiscovery = lenientObject('DeviceDiscovery', {
    foundVirtualDevice: (info) => {
      const key = JSON.stringify(info ?? {});
      if (seenVirtual.has(key)) return;
      seenVirtual.add(key);
      log(`appareil sans fil détecté derrière le récepteur : ${info?.name ?? '?'} (pilotage des sous-appareils virtuels non géré)`);
    },
  }, log);

  const LCD = lenientObject('LCD', {
    initialize: () => false,
    getFrame: () => [],
  }, log);

  const serial = lenientObject('serial', {
    availablePorts: () => [],
    isConnected: () => false,
    connect: () => false,
    disconnect: () => {},
    write: () => 0,
    getDeviceInfo: () => ({}),
  }, log);

  const errors = { default: { Assert, ContextError, globalContext }, Assert, ContextError, globalContext };

  return {
    Errors: errors,
    systeminfo: { default: systeminfo },
    permissions: { default: permissions },
    DeviceDiscovery: { default: DeviceDiscovery },
    lcd: { default: LCD },
    serial: { default: serial },
    __unknown: (name) => ({ default: lenientObject(name, {}, log) }),
  };
}
