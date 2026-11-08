// Fenêtre de capture invisible. Tout est calculé localement, rien ne quitte la machine :
//  - audio : son système en loopback (WASAPI) → FFT → 16 bandes log, niveaux grave/médium/aigu, temps forts
//  - écran : image réduite à 64 × 36 pixels pour les effets d'ambiance

const q = new URLSearchParams(location.search);
const WANT_AUDIO = q.get('audio') === '1';
const WANT_SCREEN = q.get('screen') === '1';
const BANDS = 16;
const status = { audio: WANT_AUDIO ? 'starting' : 'off', screen: WANT_SCREEN ? 'starting' : 'off' };
const report = (patch) => { Object.assign(status, patch); window.capture.status({ ...status }); };

async function start() {
  let stream;
  try {
    // Le processus principal fournit l'écran choisi + l'audio "loopback" sans afficher de sélecteur.
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 20 }, audio: true });
  } catch (e) {
    report({ audio: WANT_AUDIO ? 'error' : 'off', screen: WANT_SCREEN ? 'error' : 'off', error: `accès refusé à la capture (${e.message})` });
    return;
  }
  if (WANT_AUDIO) startAudio(stream); else stream.getAudioTracks().forEach((t) => t.stop());
  if (WANT_SCREEN) startScreen(stream);
}

// ------------------------------------------------------------------ audio

function startAudio(stream) {
  const tracks = stream.getAudioTracks();
  if (tracks.length === 0) { report({ audio: 'error', error: 'aucune piste audio système disponible' }); return; }

  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(new MediaStream(tracks));
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.55;
  source.connect(analyser); // pas de connexion à la sortie : on analyse sans rejouer le son
  ctx.resume();

  const freq = new Float32Array(analyser.frequencyBinCount);
  const time = new Float32Array(analyser.fftSize);
  const binHz = ctx.sampleRate / analyser.fftSize;
  // Bornes des bandes, réparties logarithmiquement de 40 Hz à 16 kHz.
  const edges = Array.from({ length: BANDS + 1 }, (_, i) => 40 * Math.pow(16000 / 40, i / BANDS));
  const peaks = new Float32Array(BANDS).fill(0.2);
  let bassAvg = 0, lastBeat = 0;

  report({ audio: 'running' });
  setInterval(() => {
    analyser.getFloatFrequencyData(freq);
    analyser.getFloatTimeDomainData(time);
    const bands = new Array(BANDS);
    for (let b = 0; b < BANDS; b++) {
      const lo = Math.max(1, Math.floor(edges[b] / binHz));
      const hi = Math.max(lo + 1, Math.ceil(edges[b + 1] / binHz));
      let sum = 0;
      for (let i = lo; i < hi && i < freq.length; i++) sum += Math.pow(10, freq[i] / 20);
      const mag = sum / (hi - lo);
      // Contrôle automatique de gain par bande : la valeur reste lisible quel que soit le volume.
      peaks[b] = Math.max(mag, peaks[b] * 0.995, 1e-4);
      bands[b] = Math.min(1, mag / peaks[b]);
    }
    let rms = 0;
    for (let i = 0; i < time.length; i++) rms += time[i] * time[i];
    rms = Math.sqrt(rms / time.length);

    const avg = (a, b) => bands.slice(a, b).reduce((s, x) => s + x, 0) / (b - a);
    const bass = avg(0, 3), mid = avg(3, 10), treble = avg(10, 16);
    const now = performance.now();
    const beat = bass > 0.35 && bass > bassAvg * 1.35 && now - lastBeat > 180 && rms > 0.005;
    if (beat) lastBeat = now;
    bassAvg = bassAvg * 0.92 + bass * 0.08;
    const silent = rms < 0.0005;

    window.capture.audio({
      bands: silent ? bands.map(() => 0) : bands,
      level: Math.min(1, rms * 4),
      bass: silent ? 0 : bass, mid: silent ? 0 : mid, treble: silent ? 0 : treble,
      beat: !silent && beat,
    });
  }, 33);
}

// ------------------------------------------------------------------ écran

function startScreen(stream) {
  const video = document.getElementById('video');
  const canvas = document.getElementById('grab');
  const g = canvas.getContext('2d', { willReadFrequently: true });
  video.srcObject = new MediaStream(stream.getVideoTracks());
  video.play().then(() => {
    report({ screen: 'running' });
    setInterval(() => {
      g.drawImage(video, 0, 0, canvas.width, canvas.height); // réduction faite par le GPU
      const rgba = g.getImageData(0, 0, canvas.width, canvas.height).data;
      const rgb = new Uint8Array(canvas.width * canvas.height * 3);
      for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) { rgb[j] = rgba[i]; rgb[j + 1] = rgba[i + 1]; rgb[j + 2] = rgba[i + 2]; }
      window.capture.screen({ w: canvas.width, h: canvas.height, data: rgb });
    }, 50);
  }).catch((e) => report({ screen: 'error', error: `lecture vidéo impossible (${e.message})` }));
}

start();
