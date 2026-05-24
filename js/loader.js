'use strict';

HME.detectPlatform = function() {
  const ua    = navigator.userAgent;
  const isMac = /Mac/.test(ua) || /Mac/.test(navigator.platform || '');
  const isWin = /Win/.test(ua);

  if (isMac)       HME._platform = 'mac';
  else if (isWin)  HME._platform = 'win';
  else             HME._platform = 'linux';
};

HME.setStatus = function(msg, cls) {
  const el    = document.getElementById('setup-status');
  el.textContent = msg;
  el.className   = cls || '';
};

HME.readText = function(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = e => res(e.target.result);
    r.onerror = rej;
    r.readAsText(file);
  });
};

HME.loadImage = function(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => {
      const img    = new Image();
      img.onload   = () => res(img);
      img.onerror  = rej;
      img.src      = e.target.result;
    };
    r.onerror = rej;
    r.readAsDataURL(file);
  });
};

HME.handleFiles = async function(fileList) {
  HME.setStatus('Scanning files…');
  const found = {};

  for (const file of fileList) {
    const name = file.name.toLowerCase();
    if (name === 'horsey.tmx')               found.tmx        = file;
    if (name === 'terrain.xml')               found.terrainXML = file;
    if (name === 'terrain.tsx')               found.terrainTSX = file;
    if (name === 'locs.xml')                  found.locsXML    = file;
    if (name === 'locs.tsx')                  found.locsTSX    = file;
    if (name === 'terrain.png')               found.terrainPNG = file;
    if (name === 'locs.png')                  found.locsPNG    = file;
  }

  if (!found.tmx) {
    HME.setStatus('❌ Could not find horsey.tmx — make sure you selected the correct game folder.', 'error');
    return;
  }

  const missing = [];
  if (!found.terrainXML && !found.terrainTSX) missing.push('terrain.xml');
  if (!found.locsXML    && !found.locsTSX)    missing.push('locs.xml');
  if (!found.terrainPNG)                       missing.push('terrain.png');
  if (!found.locsPNG)                          missing.push('locs.png');

  if (missing.length) {
    HME.setStatus(`⚠️ Found horsey.tmx — missing: ${missing.join(', ')}. Some features will be unavailable.`);
  } else {
    HME.setStatus('✅ All files found! Loading…', 'ok');
  }

  try {
    const tmxText = await HME.readText(found.tmx);

    const storedOrig = localStorage.getItem(HME.ORIG_TMX_KEY);
    if (storedOrig) {
      HME.state.originalTMX = storedOrig;
    } else {
      HME.state.originalTMX = tmxText;
      try { localStorage.setItem(HME.ORIG_TMX_KEY, tmxText); } catch(e) {}
    }

    HME.parseTMX(tmxText);

    const SPAWNER_EXCEPTIONS = new Set([145, 153]);
    HME._requiredLocGIDs = new Set(
      HME.state.map.objects
        .filter(o => !HME.SPAWNER_GIDS[o.gid] || SPAWNER_EXCEPTIONS.has(o.gid))
        .map(o => o.gid)
    );

    if (found.terrainXML) {
      const xml = await HME.readText(found.terrainXML);
      HME.terrainAtlas = HME.parseAtlasXML(xml);
    } else if (found.terrainTSX) {
      HME.terrainAtlas = null;
    }

    if (found.locsXML) {
      const xml = await HME.readText(found.locsXML);
      HME.locsAtlas = HME.parseAtlasXML(xml, 8, 256, 256, 32, 32);
    } else if (found.locsTSX) {
      HME.locsAtlas = null;
    }

    await Promise.all([
      found.terrainPNG
        ? HME.loadImage(found.terrainPNG).then(img => { HME.state.terrainImg = img; }).catch(() => {})
        : Promise.resolve(),
      found.locsPNG
        ? HME.loadImage(found.locsPNG).then(img => { HME.state.locsImg = img; }).catch(() => {})
        : Promise.resolve(),
    ]);

    HME.initEditor();
  } catch (e) {
    HME.setStatus('❌ Error: ' + e.message, 'error');
    console.error(e);
  }
};

HME.openNewFiles = function() {
  document.getElementById('folder-input').click();
};

HME.loadFromWeb = async function(config) {
  var statusEl = document.getElementById('setup-status');
  if (statusEl) statusEl.textContent = 'Loading map data…';

  try {
    var fetchText = function(url) {
      return fetch(url).then(function(r) {
        if (!r.ok) throw new Error(url + ' returned HTTP ' + r.status);
        return r.text();
      });
    };

    var results = await Promise.all([
      fetchText(config.tmxUrl),
      fetchText(config.terrainXmlUrl),
      fetchText(config.locsXmlUrl),
    ]);

    var tmxText        = results[0];
    var terrainXmlText = results[1];
    var locsXmlText    = results[2];

    HME.state.originalTMX = tmxText;
    HME.parseTMX(tmxText);

    var SPAWNER_EXCEPTIONS = new Set([145, 153]);
    HME._requiredLocGIDs = new Set(
      HME.state.map.objects
        .filter(function(o) { return !HME.SPAWNER_GIDS[o.gid] || SPAWNER_EXCEPTIONS.has(o.gid); })
        .map(function(o) { return o.gid; })
    );

    HME.terrainAtlas = HME.parseAtlasXML(terrainXmlText);
    HME.locsAtlas    = HME.parseAtlasXML(locsXmlText, 8, 256, 256, 32, 32);

    var loadImg = function(url) {
      return new Promise(function(resolve, reject) {
        var img    = new Image();
        img.onload  = function() { resolve(img); };
        img.onerror = reject;
        img.src     = url;
      });
    };

    var imgs = await Promise.all([
      loadImg(config.terrainPngUrl),
      loadImg(config.locsPngUrl),
    ]);

    HME.state.terrainImg = imgs[0];
    HME.state.locsImg    = imgs[1];

    HME.initEditor();
  } catch (e) {
    if (statusEl) {
      statusEl.textContent = 'Web load failed — use the file picker instead.';
      statusEl.className   = 'error';
    }
    console.error('Web mode load error:', e);
  }
};

HME.doSaveAs = function() {
  HME.showInstallMapModal(false);
};

HME.doExport = function() {
  HME.showInstallMapModal(false);
};
