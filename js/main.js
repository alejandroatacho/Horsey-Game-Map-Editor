'use strict';

HME.initEditor = function() {
  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('editor').classList.add('show');

  const wrap   = document.getElementById('canvas-wrap');
  const canvas = document.getElementById('map-canvas');

  function resizeCanvas() {
    canvas.width  = wrap.clientWidth;
    canvas.height = wrap.clientHeight;
    HME.render();
  }
  new ResizeObserver(resizeCanvas).observe(wrap);
  resizeCanvas();

  HME.state.panX = (HME.state.map.width  * HME.TS * HME.state.zoom - canvas.width)  / 2;
  HME.state.panY = (HME.state.map.height * HME.TS * HME.state.zoom - canvas.height) / 2;

  HME.buildMinimap();
  HME.buildTerrainPal();
  HME.buildObjectPal();
  HME.buildInspectList();
  HME.updateStats();
  HME.setupCanvasEvents();
  HME.setupKeyboard();
  HME.setupPanelResize();
  HME.setMode('inspect');
  HME.setPaintTool(HME.state.paintTool || 'brush');
  HME._syncUndoRedoButtons();

  const kb = HME.settings.keybinds;
  const kbBrush   = document.getElementById('kb-brush');
  const kbPipette = document.getElementById('kb-pipette');
  const kbFill    = document.getElementById('kb-fill');
  if (kbBrush)   kbBrush.textContent   = (kb.modePaint   || 'b').toUpperCase();
  if (kbPipette) kbPipette.textContent = (kb.toolPipette || 'p').toUpperCase();
  if (kbFill)    kbFill.textContent    = (kb.toolFill    || 'g').toUpperCase();

  const helpBtn = document.getElementById('btn-help');
  if (helpBtn && !localStorage.getItem('hme_v1_help_seen')) {
    helpBtn.classList.add('help-pulse');
  }

  HME.render();
};

HME.setupCanvasEvents = function() {
  const canvas = document.getElementById('map-canvas');
  const S      = HME.state;

  const DRAG_THRESHOLD = 5;

  canvas.addEventListener('mousemove', e => {
    const { col, row } = HME.screenToTile(e.offsetX, e.offsetY);
    S.hovCol = col;
    S.hovRow = row;
    document.getElementById('st-coord').textContent = `${col},${row}`;

    if (S.isDraggingObj) {
      const dx = e.clientX - S.dragMouseStartX;
      const dy = e.clientY - S.dragMouseStartY;
      if (!S.dragMoved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
        S.dragMoved = true;
        canvas.style.cursor = 'grabbing';
      }
      HME.render();
      return;
    }

    if (S.mode === 'inspect') {
      HME.updateInspector(col, row);
      if (!S.isPanning) {
        canvas.style.cursor = HME.objAt(col, row) ? 'grab' : 'grab';
      }
    }

    if (S.mode === 'paint') {
      document.getElementById('i-coord').textContent = `${col},${row}`;
      if (S.isPainting) HME.paintAt(col, row);
    }

    if (S.isPanning && S.panStart) {
      S.cameraLerpActive = false;
      S.panX = S.panStart.px + (S.panStart.mx - e.clientX);
      S.panY = S.panStart.py + (S.panStart.my - e.clientY);
      HME.clampPan();
    }
    HME.render();
  });

  canvas.addEventListener('mouseleave', () => {
    S.hovCol = -1;
    S.hovRow = -1;
    HME.render();
  });

  canvas.addEventListener('mousedown', e => {
    const { col, row } = HME.screenToTile(e.offsetX, e.offsetY);

    if (S.mode === 'inspect' && e.button === 0 && !S.spaceDown) {
      const hit = HME.objAt(col, row);

      if (hit) {
        S.isDraggingObj    = true;
        S.dragObj          = hit;
        S.dragObjOrigX     = hit.x;
        S.dragObjOrigY     = hit.y;
        S.dragMouseStartX  = e.clientX;
        S.dragMouseStartY  = e.clientY;
        S.dragMoved        = false;
        S.cameraLerpActive = false;
        HME.selectObj(hit);
        HME.highlightInspectRow(hit);
        HME.render();
        e.preventDefault();
        return;
      }

      S.isPanning = true;
      S.cameraLerpActive = false;
      S.panStart = { mx: e.clientX, my: e.clientY, px: S.panX, py: S.panY };
      canvas.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }

    if (e.button === 1 || (e.button === 0 && S.spaceDown)) {
      S.isPanning = true;
      S.cameraLerpActive = false;
      S.panStart = { mx: e.clientX, my: e.clientY, px: S.panX, py: S.panY };
      canvas.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }

    if (S.mode === 'paint' && e.button === 0) {
      const tool = S.altCmdDown ? 'pipette' : (S.paintTool || 'brush');

      if (tool === 'pipette') {
        const idx = row * S.map.width + col;
        const pickedGID = S.map.layer.data[idx];
        if (pickedGID > 0) {
          S.selTileGID = pickedGID;
          document.querySelectorAll('.tile-chip').forEach(el => {
            el.classList.toggle('sel', +el.dataset.gid === pickedGID);
          });
          HME.updatePaintInspector();
          HME.render();
        }
        return;
      }

      if (tool === 'fill') {
        HME.floodFill(col, row);
        return;
      }

      S.isPainting = true;
      S._paintSnap = [...S.map.layer.data];
      S._paintDiff = new Map();
      HME.paintAt(col, row);
      return;
    }

    if (S.mode === 'object') {
      if (e.button === 0) {
        const hit = HME.objAt(col, row);
        hit ? HME.selectObj(hit) : HME.placeObj(col, row);
        if (HME.state.mode === 'object') HME.updateObjectWarning();
      } else if (e.button === 2) {
        const hit = HME.objAt(col, row);
        if (hit) { HME.removeObj(hit); HME.updateObjectWarning(); }
        e.preventDefault();
      }
    }
  });

  canvas.addEventListener('mouseup', e => {
    if (S.isDraggingObj) {
      if (S.dragMoved && S.hovCol >= 0 && S.hovRow >= 0) {
        const obj    = S.dragObj;
        const newX   = S.hovCol * HME.TS;
        const newY   = (S.hovRow + 1) * HME.TS;
        const origX  = S.dragObjOrigX;
        const origY  = S.dragObjOrigY;

        obj.x = newX;
        obj.y = newY;

        HME.state.redoStack = [];
        HME.state.undoStack.push({
          undo() { obj.x = origX; obj.y = origY; HME.buildMinimap(); HME.buildInspectList(); HME.render(); },
          redo() { obj.x = newX;  obj.y = newY;  HME.buildMinimap(); HME.buildInspectList(); HME.render(); },
        });
        if (HME.state.undoStack.length > 80) HME.state.undoStack.shift();

        HME.markModified();
        HME.selectObj(obj);
        HME.buildMinimap();
        HME.buildInspectList();
        HME._syncUndoRedoButtons();
      }

      S.isDraggingObj   = false;
      S.dragObj         = null;
      S.dragObjOrigX    = null;
      S.dragObjOrigY    = null;
      S.dragMouseStartX = null;
      S.dragMouseStartY = null;
      S.dragMoved       = false;
      canvas.style.cursor = HME.modeCursor();
      HME.render();
      return;
    }

    if (S.isPanning) {
      S.isPanning = false;
      S.panStart  = null;
      canvas.style.cursor = S.spaceDown ? 'grab' : HME.modeCursor();
    }
    if (e.button === 0 && S.isPainting) {
      S.isPainting = false;
      HME.commitPaintUndo();
    }
  });

  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (S.mode === 'paint') {
      HME.openBrushSizeModal(e.clientX, e.clientY);
    }
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const factor  = e.deltaY > 0 ? 0.9 : 1.1;
    const oldZoom = S.zoom;
    const newZoom = Math.max(0.1, Math.min(10, oldZoom * factor));

    const worldX = (mx + S.panX) / oldZoom;
    const worldY = (my + S.panY) / oldZoom;

    S.zoom = newZoom;
    S.panX = worldX * newZoom - mx;
    S.panY = worldY * newZoom - my;

    HME.clampPan();
    document.getElementById('st-zoom').textContent = Math.round(S.zoom * 100) + '%';
    HME.render();
  }, { passive: false });
};

HME.setupKeyboard = function() {
  const canvas = document.getElementById('map-canvas');
  const S      = HME.state;

  document.addEventListener('keydown', e => {
    if (e.code === 'Escape') {
      HME.closeBrushSizeModal();
      e.preventDefault();
      return;
    }

    const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
    if (isInput) return;

    const settingsOpen = document.getElementById('settings-overlay')?.classList.contains('open');
    if (settingsOpen) return;

    if (e.code === 'Space') {
      if (!S.spaceDown) {
        S.spaceDown = true;
        if (!S.isPanning) canvas.style.cursor = 'grab';
      }
      e.preventDefault();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      HME.doUndo();
      e.preventDefault();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      HME.doRedo();
      e.preventDefault();
      return;
    }

    if (e.key === 'Meta' || e.key === 'Alt') {
      if (S.mode === 'paint' && !S.altCmdDown) {
        S.altCmdDown = true;
        if (!S.isPanning) canvas.style.cursor = HME.modeCursor();
        HME.render();
      }
      e.preventDefault();
      return;
    }

    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      const kb = HME.settings.keybinds;
      const k  = e.key.toLowerCase();
      if (k === kb.modeInspect) { HME.setMode('inspect'); e.preventDefault(); return; }
      if (k === kb.modePaint)   { HME.setMode('paint'); HME.setPaintTool('brush'); e.preventDefault(); return; }
      if (k === kb.modeObject)  { HME.setMode('object'); e.preventDefault(); return; }
      if (k === kb.toolPipette) { HME.setMode('paint'); HME.setPaintTool('pipette'); e.preventDefault(); return; }
      if (k === kb.toolFill)    { HME.setMode('paint'); HME.setPaintTool('fill'); e.preventDefault(); return; }
    }
  });

  document.addEventListener('keyup', e => {
    if (e.code === 'Space') {
      S.spaceDown = false;
      if (!S.isPanning) canvas.style.cursor = HME.modeCursor();
    }
    if (e.key === 'Meta' || e.key === 'Alt') {
      if (S.altCmdDown) {
        S.altCmdDown = false;
        if (S.mode === 'paint' && !S.isPanning) canvas.style.cursor = HME.modeCursor();
        HME.render();
      }
    }
  });

  window.addEventListener('blur', () => {
    if (S.altCmdDown) {
      S.altCmdDown = false;
      if (S.mode === 'paint' && !S.isPanning) canvas.style.cursor = HME.modeCursor();
      HME.render();
    }
    if (S.isDraggingObj) {
      S.isDraggingObj = false;
      S.dragObj = null;
      S.dragMoved = false;
      canvas.style.cursor = HME.modeCursor();
      HME.render();
    }
  });
};

HME.setupPanelResize = function() {
  function makeResizable(handleId, panelSelector, side) {
    const handle = document.getElementById(handleId);
    const panel  = document.querySelector(panelSelector);
    if (!handle || !panel) return;

    let startX, startW;

    handle.addEventListener('mousedown', e => {
      startX = e.clientX;
      startW = panel.offsetWidth;
      handle.classList.add('dragging');
      document.body.style.cursor     = 'col-resize';
      document.body.style.userSelect = 'none';

      function onMove(ev) {
        const delta = side === 'left' ? ev.clientX - startX : startX - ev.clientX;
        const newW  = Math.max(140, Math.min(420, startW + delta));
        panel.style.width = newW + 'px';
        HME.render();
      }

      function onUp() {
        handle.classList.remove('dragging');
        document.body.style.cursor     = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
      e.preventDefault();
    });
  }

  makeResizable('left-resize',  '.left-panel',  'left');
  makeResizable('right-resize', '.right-panel', 'right');
};

HME.setupFileInputEvents = function() {
  document.getElementById('folder-input').addEventListener('change', e => {
    if (e.target.files.length) HME.handleFiles(e.target.files);
  });
  document.getElementById('files-input').addEventListener('change', e => {
    if (e.target.files.length) HME.handleFiles(e.target.files);
  });
};

HME.checkAcknowledgment = function() {
  if (!localStorage.getItem(HME.ACK_KEY)) {
    document.getElementById('ack-overlay').classList.add('open');
  }
};

HME.onAckInput = function() {
  const val = (document.getElementById('ack-input').value || '').trim().toLowerCase();
  const required = 'i do acknowledge that this is a fan made tool and i will not harass the developers of horsey game for any issues with this tool';
  const btn = document.getElementById('ack-continue-btn');
  if (btn) btn.disabled = val !== required;
};

HME.submitAcknowledgment = function() {
  try { localStorage.setItem(HME.ACK_KEY, '1'); } catch(e) {}
  document.getElementById('ack-overlay').classList.remove('open');
};

HME.detectPlatform();
HME.setupFileInputEvents();

var _params = new URLSearchParams(window.location.search);
if (_params.get('mode') === 'web') {
  // Immediately swap setup screen to loading state
  var _setupCard = document.querySelector('.setup-card');
  if (_setupCard) {
    _setupCard.innerHTML = '<div class="setup-logo">🐴</div>'
      + '<div class="setup-title">Horsey Map Editor</div>'
      + '<div class="setup-sub">Loading map data...</div>'
      + '<div id="setup-status"></div>';
  }
  var _ackOverlay = document.getElementById('ack-overlay');
  if (_ackOverlay) _ackOverlay.style.display = 'none';

  var _base    = _params.get('assets') || '/horsey-source';
  var _imgBase = _params.get('images') || '/assets/horsey_atlas';
  HME.loadFromWeb({
    tmxUrl:          _base + '/horsey.tmx',
    terrainXmlUrl:   _base + '/terrain.xml',
    locsXmlUrl:      _base + '/locs.xml',
    terrainPngUrl:   _imgBase + '/terrain.png',
    locsPngUrl:      _imgBase + '/locs.png',
  });
} else {
  HME.checkAcknowledgment();
}

document.addEventListener('click', () => {
  if (HME.closePaintDropdown) HME.closePaintDropdown();
  if (HME.closeHelpDropdown)  HME.closeHelpDropdown();
});
