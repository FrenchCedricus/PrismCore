// Interface en ligne de commande de PrismCore (sans interface graphique).

import { parseArgs } from 'node:util';
import { loadConfig } from './config.js';
import { getIndex, buildIndex, isHidTransport } from './pluginIndex.js';
import { EFFECT_NAMES } from './effects.js';
import { Engine, enumerateHid, matchPlugins } from './engine.js';
import { toEndpoint } from './device.js';

const HELP = `PrismCore — moteur RGB local (interface graphique : npm start)

Usage : node index.js <commande> [options]

Commandes :
  scan                 Liste les appareils HID branchés et le plugin qui les prend en charge
  test                 Exécution à sec : montre les paquets générés sans rien envoyer
  run                  Démarre le pilotage RGB (Ctrl+C pour arrêter proprement)
  plugins [filtre]     Liste les plugins de l'index
  index                Reconstruit l'index des plugins

Options :
  --effect <id>        ${EFFECT_NAMES.join(' | ')}
  --color <#rrggbb>    Couleur principale de l'effet
  --speed <n>          Vitesse de l'effet
  --brightness <0..1>  Luminosité globale
  --fps <n>            Images par seconde (défaut 30)
  --only <texte>       Ne pilote que les plugins dont le nom contient ce texte
  --duration <s>       S'arrête automatiquement après s secondes
  --verbose            Affiche les logs détaillés des plugins
`;

const ALIASES = { static: 'solid' };
const hex4 = (n) => '0x' + (n ?? 0).toString(16).toUpperCase().padStart(4, '0');

/** Construit un profil moteur à partir de config.json + options de ligne de commande. */
function profileFromConfig(cfg) {
  const id = ALIASES[cfg.effect.name] ?? cfg.effect.name;
  const params = {};
  if (cfg.effect.color) params.color = cfg.effect.color;
  if (cfg.effect.speed !== undefined) params.speed = cfg.effect.speed;
  return { effect: { id, params }, brightness: cfg.effect.brightness ?? 1, properties: cfg.properties, channels: cfg.channels, layout: cfg.layout ?? {} };
}

export async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      effect: { type: 'string' }, color: { type: 'string' }, speed: { type: 'string' },
      brightness: { type: 'string' }, fps: { type: 'string' }, only: { type: 'string' },
      duration: { type: 'string' },
      verbose: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h' },
    },
  });
  const [cmd = 'help', arg] = positionals;
  if (values.help || cmd === 'help') { console.log(HELP); return; }

  const cfg = loadConfig({
    fps: values.fps ? Number(values.fps) : undefined,
    effect: Object.fromEntries(Object.entries({
      name: values.effect, color: values.color,
      speed: values.speed ? Number(values.speed) : undefined,
      brightness: values.brightness ? Number(values.brightness) : undefined,
    }).filter(([, v]) => v !== undefined)),
  });
  const progress = (i, n) => { if (i % 50 === 0 || i === n) process.stdout.write(`\rIndexation des plugins… ${i}/${n}`); };

  if (cmd === 'index') {
    const idx = await buildIndex(cfg.pluginDirs, { onProgress: progress });
    console.log(`\n${idx.entries.length} plugins indexés, ${idx.failures.length} échecs de chargement.`);
    for (const f of idx.failures) console.log(`  ✗ ${f.file} : ${f.error}`);
    return;
  }

  const index = await getIndex(cfg.pluginDirs, { onProgress: progress });

  if (cmd === 'plugins') {
    const f = (arg ?? '').toLowerCase();
    const list = index.entries.filter((e) => !f || e.name.toLowerCase().includes(f) || e.file.toLowerCase().includes(f));
    for (const e of list) {
      const support = isHidTransport(e.transport) ? '' : `  (transport ${e.transport} non géré)`;
      const src = e.source === 'builtin' ? '[intégré] ' : '';
      console.log(`${e.name.padEnd(42)} VID ${hex4(e.vendorId)}  ${e.productIds.length} PID  ${e.deviceType.padEnd(18)} ${src}${e.file}${support}`);
    }
    console.log(`\n${list.length} plugin(s).`);
    return;
  }

  if (cmd === 'scan') {
    console.log(`Dossiers de pilotes :\n${cfg.pluginDirs.map((d) => `  ${d}`).join('\n')}\n`);
    for (const g of enumerateHid()) {
      const matches = matchPlugins(index, g, cfg.disabled);
      const label = `${g.key}  ${g.manufacturer ?? ''} ${g.product ?? ''}`.trim();
      console.log(matches.length ? `● ${label}` : `○ ${label}`);
      for (const m of matches) console.log(`    → ${m.name}  (${m.source === 'builtin' ? 'intégré : ' : ''}${m.file})`);
      if (values.verbose) {
        for (const info of g.infos) {
          const e = toEndpoint(info);
          console.log(`      if=${e.interface} usage=${hex4(e.usage)} page=${hex4(e.usage_page)} col=${e.collection}`);
        }
      }
    }
    return;
  }

  if (cmd === 'run' || cmd === 'test') {
    const dryRun = cmd === 'test';
    const engine = new Engine({ pluginDirs: cfg.pluginDirs, fps: cfg.fps, dryRun, readTimeoutMs: cfg.readTimeoutMs, disabledPlugins: cfg.disabled });
    engine.on('log', ({ level, msg }) => { if (level !== 'debug' || values.verbose) console.log(level === 'debug' ? '  · ' + msg : msg); });
    engine.index = index;
    engine.applyProfile(profileFromConfig(cfg));
    if (!dryRun) engine.start();
    await engine.scan({ only: values.only });
    if (engine.handles.size === 0) {
      console.log('Aucun appareil pris en charge détecté. Lance "node index.js scan" pour diagnostiquer.');
      await engine.stop();
      return;
    }

    if (dryRun) {
      await new Promise((r) => setTimeout(r, 300)); // laisse les workers publier leur état
      const frames = 3;
      for (const { name, status, packets: pk } of await engine.testFrames(frames)) {
        const bytes = pk.reduce((s, p) => s + p.data.length, 0);
        console.log(`\n${name} — ${status === 'error' ? 'INACTIF' : 'OK'} — ${(pk.length / frames).toFixed(1)} paquet(s)/frame, ${Math.round(bytes / frames)} octets/frame`);
        for (const p of pk.slice(0, Math.min(4, Math.ceil(pk.length / frames) || 1))) {
          const head = p.data.slice(0, 24).map((b) => b.toString(16).padStart(2, '0')).join(' ');
          console.log(`   ${p.kind.padEnd(11)} ${String(p.data.length).padStart(4)} o  ${head}${p.data.length > 24 ? ' …' : ''}`);
        }
      }
      await engine.stop();
      return;
    }

    engine.startHotplug(5000);
    console.log(`\nEffet "${engine.canvas.effectId}" à ${cfg.fps} FPS sur ${engine.handles.size} appareil(s). Ctrl+C pour arrêter.`);
    const shutdown = async () => { console.log('\nArrêt…'); await engine.stop(); process.exit(0); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    if (values.duration) setTimeout(shutdown, Number(values.duration) * 1000);
    return;
  }

  console.log(HELP);
  process.exitCode = 1;
}
