/**
 * OhioWorld - Interactive Map (OLED Edition)
 * Pure blacks, frosted glass, tactile controls, no generic AI styling
 */

(function () {
    'use strict';

    // State
    let isAddMarkerMode = false;
    let selectedMarkerId = null;
    let activeCategoryFilter = 'all';
    let searchQuery = '';
    let currentMarkerEditing = null;
    let stagedImageBase64 = '';
    let userMarkersLayer = null;
    let userMarkersSource = null;
    let hoveredFeature = null;

    // SVG Pin Cache
    const pinCache = new Map();

    /**
     * Generate Tactical OLED SVG Pin as Data URL
     */
    function getPinSvgUrl(color) {
        if (pinCache.has(color)) return pinCache.get(color);

        const svg = `
        <svg width="28" height="38" viewBox="0 0 28 38" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <filter id="shadow" x="-30%" y="-10%" width="160%" height="140%">
                    <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="rgba(0,0,0,0.95)"/>
                </filter>
            </defs>
            <path d="M14 38L9.5 26.5C4 24.5 1 19.5 1 14C1 6.8 6.8 1 14 1C21.2 1 27 6.8 27 14C27 19.5 24 24.5 18.5 26.5L14 38Z" fill="#000000" stroke="${color}" stroke-width="1.8" filter="url(#shadow)"/>
            <circle cx="14" cy="14" r="5" fill="${color}"/>
        </svg>`.trim();

        const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        pinCache.set(color, dataUrl);
        return dataUrl;
    }

    /**
     * Coordinate Converters
     */
    function blockToView(coords) {
        return ol.proj.transform(coords, unmined.dataProjection, unmined.viewProjection);
    }

    function viewToBlock(coords) {
        const c = ol.proj.transform(coords, unmined.viewProjection, unmined.dataProjection);
        return [Math.round(c[0]), Math.round(c[1])];
    }

    /**
     * Calculate Distance from Map View Center
     */
    function getDistanceFromCenter(x, z) {
        if (!unmined || !unmined.olMap) return '';
        try {
            const centerBlock = viewToBlock(unmined.olMap.getView().getCenter());
            const dx = x - centerBlock[0];
            const dz = z - centerBlock[1];
            const dist = Math.round(Math.hypot(dx, dz));
            if (dist >= 1000) {
                return `${(dist / 1000).toFixed(1)}k`;
            }
            return `${dist}m`;
        } catch {
            return '';
        }
    }

    /**
     * Create Tactical Feature Style
     */
    function createMarkerStyle(marker, isHovered = false) {
        const cat = CATEGORIES[marker.category] || CATEGORIES.other;
        const color = marker.color || cat.color;
        const pinUrl = getPinSvgUrl(color);

        const iconStyle = new ol.style.Icon({
            src: pinUrl,
            anchor: [0.5, 1],
            anchorXUnits: 'fraction',
            anchorYUnits: 'fraction',
            scale: isHovered ? 1.15 : 1.0
        });

        const textStyle = new ol.style.Text({
            text: marker.title,
            font: isHovered
                ? '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
                : '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            offsetY: 15,
            fill: new ol.style.Fill({ color: '#ffffff' }),
            backgroundFill: new ol.style.Fill({
                color: isHovered ? 'rgba(0, 0, 0, 0.96)' : 'rgba(0, 0, 0, 0.85)'
            }),
            backgroundStroke: new ol.style.Stroke({
                color: isHovered ? '#ffffff' : color,
                width: isHovered ? 1.5 : 1
            }),
            padding: [3, 7, 3, 7]
        });

        return [new ol.style.Style({ image: iconStyle }), new ol.style.Style({ text: textStyle })];
    }

    /**
     * Toast Notification
     */
    function showToast(message) {
        if (window.Toastify) {
            Toastify({
                text: message,
                duration: 2200,
                gravity: 'bottom',
                position: 'center',
                style: {
                    background: 'rgba(12, 12, 12, 0.95)',
                    border: '1px solid rgba(255, 255, 255, 0.18)',
                    borderRadius: '9999px',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontWeight: '600',
                    padding: '8px 16px',
                    boxShadow: '0 12px 30px rgba(0,0,0,0.9)'
                }
            }).showToast();
        }
    }

    /**
     * Initialize OpenLayers User Markers Vector Layer
     */
    function initMarkersLayer() {
        userMarkersSource = new ol.source.Vector();
        userMarkersLayer = new ol.layer.Vector({
            source: userMarkersSource,
            zIndex: 1500
        });

        unmined.olMap.addLayer(userMarkersLayer);

        // Click Handler
        unmined.olMap.on('singleclick', (evt) => {
            if (isAddMarkerMode) {
                const blockCoords = viewToBlock(evt.coordinate);
                exitAddMarkerMode();
                openAddMarkerModal(blockCoords[0], blockCoords[1]);
                return;
            }

            let clicked = null;
            unmined.olMap.forEachFeatureAtPixel(evt.pixel, (feature, layer) => {
                if (layer === userMarkersLayer) {
                    const id = feature.get('markerId');
                    if (id) {
                        clicked = markersStore.get(id);
                        return true;
                    }
                }
            });

            if (clicked) {
                openMarkerDetail(clicked);
            } else {
                closeMarkerDetail();
            }
        });

        // Pointer move (Cursor coordinates & Hover effect)
        unmined.olMap.on('pointermove', (evt) => {
            if (evt.dragging) {
                hideHoverTooltip();
                return;
            }

            const curBlock = viewToBlock(evt.coordinate);
            updateLiveCoordsHUD(curBlock[0], curBlock[1]);

            if (isAddMarkerMode) {
                unmined.olMap.getTargetElement().style.cursor = 'crosshair';
                hideHoverTooltip();
                return;
            }

            const pixel = unmined.olMap.getEventPixel(evt.originalEvent);
            let foundFeature = null;

            unmined.olMap.forEachFeatureAtPixel(pixel, (feature, layer) => {
                if (layer === userMarkersLayer) {
                    foundFeature = feature;
                    return true;
                }
            });

            unmined.olMap.getTargetElement().style.cursor = foundFeature ? 'pointer' : '';

            if (foundFeature !== hoveredFeature) {
                if (hoveredFeature) {
                    const id = hoveredFeature.get('markerId');
                    const m = markersStore.get(id);
                    if (m) hoveredFeature.setStyle(createMarkerStyle(m, false));
                }
                hoveredFeature = foundFeature;
                if (hoveredFeature) {
                    const id = hoveredFeature.get('markerId');
                    const m = markersStore.get(id);
                    if (m) {
                        hoveredFeature.setStyle(createMarkerStyle(m, true));
                        showHoverTooltip(pixel, m);
                    }
                } else {
                    hideHoverTooltip();
                }
            } else if (hoveredFeature) {
                moveHoverTooltip(pixel);
            }
        });

        // Re-calculate distances on map move
        unmined.olMap.on('moveend', () => {
            renderSidebarList();
        });
    }

    /**
     * Update Live Coords in HUD
     */
    function updateLiveCoordsHUD(x, z) {
        const xEl = document.getElementById('hudCoordX');
        const zEl = document.getElementById('hudCoordZ');
        if (xEl && zEl) {
            xEl.textContent = x;
            zEl.textContent = z;
        }
    }

    /**
     * Render all markers on map
     */
    function renderMarkersOnMap() {
        if (!userMarkersSource) return;
        userMarkersSource.clear();

        const markers = Array.from(markersStore.cache.values());
        markers.forEach(m => {
            const feature = new ol.Feature({
                geometry: new ol.geom.Point(blockToView([m.x, m.z]))
            });
            feature.set('markerId', m.id);
            feature.setStyle(createMarkerStyle(m, false));
            userMarkersSource.addFeature(feature);
        });

        const badge = document.getElementById('markersCountBadge');
        if (badge) badge.textContent = markersStore.cache.size;
    }

    /**
     * Hover Tooltip
     */
    function showHoverTooltip(pixel, marker) {
        const tooltip = document.getElementById('markerHoverTooltip');
        if (!tooltip) return;

        const cat = CATEGORIES[marker.category] || CATEGORIES.other;
        let html = `
            <div class="tooltip-title">
                <span style="width:7px; height:7px; border-radius:50%; background:${marker.color || cat.color}; display:inline-block;"></span>
                <span>${escapeHtml(marker.title)}</span>
            </div>
            <div class="tooltip-coords">X: ${marker.x} / Z: ${marker.z}</div>
        `;
        if (marker.image) {
            html += `<img src="${marker.image}" class="tooltip-thumb" alt="Preview"/>`;
        }

        tooltip.innerHTML = html;
        tooltip.style.left = pixel[0] + 'px';
        tooltip.style.top = pixel[1] + 'px';
        tooltip.classList.add('active');
    }

    function moveHoverTooltip(pixel) {
        const tooltip = document.getElementById('markerHoverTooltip');
        if (tooltip && tooltip.classList.contains('active')) {
            tooltip.style.left = pixel[0] + 'px';
            tooltip.style.top = pixel[1] + 'px';
        }
    }

    function hideHoverTooltip() {
        const tooltip = document.getElementById('markerHoverTooltip');
        if (tooltip) tooltip.classList.remove('active');
    }

    /**
     * Add Marker Placement Mode
     */
    function enterAddMarkerMode() {
        isAddMarkerMode = true;
        document.getElementById('placementBanner').classList.add('active');
        unmined.olMap.getTargetElement().style.cursor = 'crosshair';
        closeMarkerDetail();
    }

    function exitAddMarkerMode() {
        isAddMarkerMode = false;
        document.getElementById('placementBanner').classList.remove('active');
        unmined.olMap.getTargetElement().style.cursor = '';
    }

    /**
     * Open Add Marker Modal
     */
    function openAddMarkerModal(x = null, z = null) {
        currentMarkerEditing = null;
        stagedImageBase64 = '';

        if (x === null || z === null) {
            const center = unmined.olMap.getView().getCenter();
            const b = viewToBlock(center);
            x = b[0];
            z = b[1];
        }

        document.getElementById('modalTitle').textContent = 'Новая точка на карте';
        document.getElementById('markerTitleInput').value = '';
        document.getElementById('markerXInput').value = x;
        document.getElementById('markerZInput').value = z;
        document.getElementById('markerDescInput').value = '';
        document.getElementById('markerColorInput').value = CATEGORIES.base.color;
        document.getElementById('markerImageUrlInput').value = '';

        selectCategoryOption('base');
        updateModalImagePreview('');

        document.getElementById('markerModal').classList.add('active');
        setTimeout(() => document.getElementById('markerTitleInput').focus(), 80);
    }

    /**
     * Open Edit Marker Modal
     */
    function openEditMarkerModal(marker) {
        currentMarkerEditing = marker;
        stagedImageBase64 = marker.image || '';

        document.getElementById('modalTitle').textContent = 'Редактировать точку';
        document.getElementById('markerTitleInput').value = marker.title;
        document.getElementById('markerXInput').value = marker.x;
        document.getElementById('markerZInput').value = marker.z;
        document.getElementById('markerDescInput').value = marker.description || '';
        document.getElementById('markerColorInput').value = marker.color || (CATEGORIES[marker.category]?.color || '#38bdf8');
        document.getElementById('markerImageUrlInput').value = (marker.image && marker.image.startsWith('http')) ? marker.image : '';

        selectCategoryOption(marker.category || 'other');
        updateModalImagePreview(stagedImageBase64);

        document.getElementById('markerModal').classList.add('active');
    }

    function closeModal() {
        document.getElementById('markerModal').classList.remove('active');
        currentMarkerEditing = null;
        stagedImageBase64 = '';
    }

    /**
     * Select Category in Modal
     */
    function selectCategoryOption(catId) {
        document.querySelectorAll('.category-option-btn').forEach(btn => {
            const isTarget = btn.dataset.category === catId;
            btn.classList.toggle('selected', isTarget);
            if (isTarget) {
                const cat = CATEGORIES[catId];
                if (cat) document.getElementById('markerColorInput').value = cat.color;
            }
        });
    }

    /**
     * Update Modal Staged Image
     */
    function updateModalImagePreview(src) {
        stagedImageBase64 = src;
        const box = document.getElementById('modalImagePreviewBox');
        const img = document.getElementById('modalImagePreview');

        if (src) {
            img.src = src;
            box.classList.add('has-image');
        } else {
            img.src = '';
            box.classList.remove('has-image');
        }
    }

    /**
     * Save Marker
     */
    async function saveMarkerFromModal() {
        const title = document.getElementById('markerTitleInput').value.trim();
        if (!title) {
            showToast('Введите название точки');
            document.getElementById('markerTitleInput').focus();
            return;
        }

        const x = Math.round(Number(document.getElementById('markerXInput').value) || 0);
        const z = Math.round(Number(document.getElementById('markerZInput').value) || 0);
        const description = document.getElementById('markerDescInput').value.trim();
        const color = document.getElementById('markerColorInput').value;

        const selectedBtn = document.querySelector('.category-option-btn.selected');
        const category = selectedBtn ? selectedBtn.dataset.category : 'other';

        let image = stagedImageBase64;
        const urlInput = document.getElementById('markerImageUrlInput').value.trim();
        if (!image && urlInput) {
            image = urlInput;
        }

        const markerData = {
            id: currentMarkerEditing ? currentMarkerEditing.id : null,
            title: title,
            category: category,
            color: color,
            x: x,
            z: z,
            description: description,
            image: image,
            createdAt: currentMarkerEditing ? currentMarkerEditing.createdAt : new Date().toISOString()
        };

        const saved = await markersStore.save(markerData);
        closeModal();
        renderMarkersOnMap();
        renderSidebarList();
        showToast(currentMarkerEditing ? 'Точка обновлена' : 'Точка создана');
        openMarkerDetail(saved);
    }

    /**
     * Open Marker Detail Drawer (Right side)
     */
    function openMarkerDetail(marker) {
        selectedMarkerId = marker.id;
        const drawer = document.getElementById('markerDetailDrawer');
        const cat = CATEGORIES[marker.category] || CATEGORIES.other;

        const catName = document.getElementById('drawerCategoryName');
        const catDot = document.getElementById('drawerCategoryDot');
        catName.textContent = cat.name;
        catDot.style.background = marker.color || cat.color;

        document.getElementById('drawerTitle').textContent = marker.title;
        document.getElementById('drawerCoords').textContent = `X: ${marker.x} / Z: ${marker.z}`;

        const dist = getDistanceFromCenter(marker.x, marker.z);
        const distEl = document.getElementById('drawerDistance');
        if (distEl) distEl.textContent = dist ? `~${dist}` : '';

        // Description
        const descEl = document.getElementById('drawerDesc');
        if (marker.description && marker.description.trim()) {
            descEl.textContent = marker.description;
            descEl.style.display = 'block';
        } else {
            descEl.textContent = 'Описание отсутствует.';
            descEl.style.display = 'block';
        }

        // Cover Photo
        const coverBox = document.getElementById('drawerCoverBox');
        if (marker.image) {
            coverBox.innerHTML = `
                <img src="${marker.image}" alt="${escapeHtml(marker.title)}" id="drawerCoverImg" />
                <div class="drawer-cover-controls">
                    <button class="hud-btn" id="changePhotoBtn" style="font-size:11px; padding:4px 8px; background:rgba(0,0,0,0.75);">
                        Заменить фото
                    </button>
                </div>
            `;
            document.getElementById('drawerCoverImg').onclick = () => openLightbox(marker.image);
            document.getElementById('changePhotoBtn').onclick = () => triggerQuickPhotoUpload(marker);
        } else {
            coverBox.innerHTML = `
                <div class="drawer-cover-empty" id="addPhotoPrompt">
                    <svg class="hud-icon" style="width:28px; height:28px;" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                    <span style="font-weight:600; font-size:12px;">Нажмите, чтобы добавить фото</span>
                    <span style="font-size:10px; color:var(--text-tertiary);">PNG, JPG, WebP или Ctrl+V</span>
                </div>
            `;
            document.getElementById('addPhotoPrompt').onclick = () => triggerQuickPhotoUpload(marker);
        }

        flyToMarker(marker.x, marker.z);
        highlightSidebarCard(marker.id);
        drawer.classList.add('active');
    }

    function closeMarkerDetail() {
        selectedMarkerId = null;
        document.getElementById('markerDetailDrawer').classList.remove('active');
        highlightSidebarCard(null);
    }

    /**
     * Direct Photo Upload from Detail Card
     */
    function triggerQuickPhotoUpload(marker) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                showToast('Сжатие изображения...');
                const compressed = await MarkersStore.compressImageFile(file, 1600, 0.85);
                marker.image = compressed;
                await markersStore.save(marker);
                renderMarkersOnMap();
                renderSidebarList();
                openMarkerDetail(marker);
                showToast('Фото добавлено');
            } catch (err) {
                showToast('Ошибка: ' + err.message);
            }
        };
        input.click();
    }

    /**
     * Delete Marker
     */
    async function deleteMarker(id) {
        const marker = markersStore.get(id);
        if (!marker) return;

        if (confirm(`Удалить точку "${marker.title}"?`)) {
            await markersStore.delete(id);
            closeMarkerDetail();
            renderMarkersOnMap();
            renderSidebarList();
            showToast('Точка удалена');
        }
    }

    /**
     * Fly Map to Coordinates
     */
    function flyToMarker(x, z) {
        unmined.olMap.getView().animate({
            center: blockToView([x, z]),
            duration: 450
        });
    }

    /**
     * Lightbox
     */
    function openLightbox(src) {
        const box = document.getElementById('lightboxBackdrop');
        const img = document.getElementById('lightboxImage');
        img.src = src;
        box.classList.add('active');
    }

    function closeLightbox() {
        document.getElementById('lightboxBackdrop').classList.remove('active');
    }

    /**
     * Render Places List in Left Sidebar
     */
    function renderSidebarList() {
        const listEl = document.getElementById('sidebarMarkersList');
        if (!listEl) return;

        let markers = Array.from(markersStore.cache.values());

        if (activeCategoryFilter !== 'all') {
            markers = markers.filter(m => m.category === activeCategoryFilter);
        }

        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            markers = markers.filter(m =>
                m.title.toLowerCase().includes(q) ||
                (m.description && m.description.toLowerCase().includes(q)) ||
                String(m.x).includes(q) ||
                String(m.z).includes(q) ||
                (CATEGORIES[m.category] && CATEGORIES[m.category].name.toLowerCase().includes(q))
            );
        }

        markers.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

        if (markers.length === 0) {
            listEl.innerHTML = `
                <div style="text-align:center; padding:40px 20px; color:var(--text-tertiary);">
                    <div style="font-size:13px; font-weight:600; color:var(--text-secondary); margin-bottom:8px;">Точек не найдено</div>
                    <button class="hud-btn hud-btn-primary" id="emptyAddBtn" style="font-size:11px;">➕ Добавить точку</button>
                </div>
            `;
            const btn = document.getElementById('emptyAddBtn');
            if (btn) btn.onclick = () => openAddMarkerModal();
            return;
        }

        listEl.innerHTML = markers.map(m => {
            const cat = CATEGORIES[m.category] || CATEGORIES.other;
            const dist = getDistanceFromCenter(m.x, m.z);
            const thumb = m.image
                ? `<img src="${m.image}" alt="thumb"/>`
                : `<span class="card-thumb-dot" style="background:${m.color || cat.color}; color:${m.color || cat.color};"></span>`;

            return `
                <div class="marker-card ${selectedMarkerId === m.id ? 'active' : ''}" data-id="${m.id}">
                    <div class="card-thumb">${thumb}</div>
                    <div class="card-info">
                        <div class="card-title">${escapeHtml(m.title)}</div>
                        <div class="card-meta">
                            <span class="card-category-tag">
                                <span style="width:5px; height:5px; border-radius:50%; background:${m.color || cat.color};"></span>
                                ${cat.label || cat.name}
                            </span>
                            <span class="card-coords">${m.x}, ${m.z}</span>
                        </div>
                    </div>
                    ${dist ? `<div class="card-distance">${dist}</div>` : ''}
                </div>
            `;
        }).join('');

        listEl.querySelectorAll('.marker-card').forEach(card => {
            card.onclick = () => {
                const id = card.dataset.id;
                const m = markersStore.get(id);
                if (m) openMarkerDetail(m);
            };
        });
    }

    function highlightSidebarCard(id) {
        document.querySelectorAll('.marker-card').forEach(card => {
            card.classList.toggle('active', card.dataset.id === id);
        });
    }

    /**
     * Export / Import JSON
     */
    async function exportMarkers() {
        const jsonStr = await markersStore.exportJSON();
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `OhioWorld_Markers.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Экспортировано в JSON');
    }

    function triggerImportMarkers() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (evt) => {
                try {
                    const count = await markersStore.importJSON(evt.target.result, false);
                    renderMarkersOnMap();
                    renderSidebarList();
                    showToast(`Импортировано: ${count}`);
                } catch (err) {
                    showToast('Ошибка импорта: ' + err.message);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    /**
     * Hook into Unmined Context Menu (Right Click)
     */
    function hookUnminedContextMenu() {
        if (!unmined || !unmined.olMap) return;

        unmined.olMap.getControls().forEach(ctrl => {
            const isMenu = (window.ContextMenu && ctrl instanceof ContextMenu) ||
                (ctrl && typeof ctrl.push === 'function' && typeof ctrl.clear === 'function');

            if (isMenu) {
                ctrl.on('open', (evt) => {
                    const coords = ol.proj.transform(
                        unmined.olMap.getEventCoordinate(evt.originalEvent),
                        unmined.viewProjection,
                        unmined.dataProjection
                    );
                    const bx = Math.round(coords[0]);
                    const bz = Math.round(coords[1]);

                    ctrl.push('-');
                    ctrl.push({
                        text: `📍 Добавить метку сюда (${bx}, ${bz})`,
                        classname: 'menuitem-addmarker',
                        callback: () => {
                            openAddMarkerModal(bx, bz);
                        }
                    });
                });
            }
        });
    }

    function checkInitialUrlHash() {
        const hash = window.location.hash;
        if (!hash || hash.length <= 1) return;

        const params = new URLSearchParams(hash.substring(1));
        const markerId = params.get('marker');
        if (markerId) {
            const m = markersStore.get(markerId);
            if (m) {
                setTimeout(() => openMarkerDetail(m), 300);
            }
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /**
     * Teleport to Random Saved Marker (or random explored coordinates)
     */
    function teleportToRandomPlace() {
        const markers = Array.from(markersStore.cache.values());
        if (markers.length > 0) {
            let targetMarker = markers[Math.floor(Math.random() * markers.length)];
            if (markers.length > 1 && selectedMarkerId === targetMarker.id) {
                const candidates = markers.filter(m => m.id !== selectedMarkerId);
                targetMarker = candidates[Math.floor(Math.random() * candidates.length)];
            }
            flyToMarker(targetMarker.x, targetMarker.z);
            openMarkerDetail(targetMarker);
            showToast(`🎲 Случайная локация: ${targetMarker.title}`);
        } else {
            const randX = Math.round((Math.random() - 0.5) * 600);
            const randZ = Math.round((Math.random() - 0.5) * 600);
            flyToMarker(randX, randZ);
            showToast(`🎲 Случайные координаты: X: ${randX}, Z: ${randZ}`);
        }
    }

    /**
     * Initialize UI Events
     */
    function initUI() {
        // Brand Logo -> Spawn
        const brandLogo = document.getElementById('brandLogo');
        if (brandLogo) {
            brandLogo.onclick = (e) => {
                e.preventDefault();
                flyToMarker(0, 0);
                showToast('🎯 Спавн сервера (0, 0)');
            };
        }

        // Spawn Button
        const spawnBtn = document.getElementById('spawnBtn');
        if (spawnBtn) {
            spawnBtn.onclick = () => {
                flyToMarker(0, 0);
                showToast('🎯 Спавн сервера (0, 0)');
            };
        }

        // Random Place Button
        const randomPlaceBtn = document.getElementById('randomPlaceBtn');
        if (randomPlaceBtn) {
            randomPlaceBtn.onclick = () => teleportToRandomPlace();
        }

        // Toggle Sidebar
        const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
        const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
        const sidebar = document.getElementById('sidebarPanel');
        if (toggleSidebarBtn && sidebar) {
            toggleSidebarBtn.onclick = () => sidebar.classList.toggle('collapsed');
        }
        if (sidebarCloseBtn && sidebar) {
            sidebarCloseBtn.onclick = () => sidebar.classList.add('collapsed');
        }

        // Add Marker Button
        const addMarkerBtn = document.getElementById('addMarkerBtn');
        if (addMarkerBtn) {
            addMarkerBtn.onclick = () => {
                if (isAddMarkerMode) {
                    exitAddMarkerMode();
                } else {
                    enterAddMarkerMode();
                }
            };
        }

        // Placement Banner Cancel
        const cancelPlacementBtn = document.getElementById('cancelPlacementBtn');
        if (cancelPlacementBtn) {
            cancelPlacementBtn.onclick = () => exitAddMarkerMode();
        }

        // Drawer Close
        const drawerCloseBtn = document.getElementById('drawerCloseBtn');
        if (drawerCloseBtn) {
            drawerCloseBtn.onclick = () => closeMarkerDetail();
        }

        // Copy /tp
        const copyTpBtn = document.getElementById('copyTpBtn');
        if (copyTpBtn) {
            copyTpBtn.onclick = () => {
                if (!selectedMarkerId) return;
                const m = markersStore.get(selectedMarkerId);
                if (m) {
                    const cmd = `/tp ${m.x} ~ ${m.z}`;
                    navigator.clipboard.writeText(cmd);
                    showToast(`Скопировано: ${cmd}`);
                }
            };
        }

        // Center map
        const centerMarkerBtn = document.getElementById('centerMarkerBtn');
        if (centerMarkerBtn) {
            centerMarkerBtn.onclick = () => {
                if (!selectedMarkerId) return;
                const m = markersStore.get(selectedMarkerId);
                if (m) flyToMarker(m.x, m.z);
            };
        }

        // Share Link
        const shareMarkerBtn = document.getElementById('shareMarkerBtn');
        if (shareMarkerBtn) {
            shareMarkerBtn.onclick = () => {
                if (!selectedMarkerId) return;
                const m = markersStore.get(selectedMarkerId);
                if (m) {
                    const url = new URL(window.location.href);
                    url.hash = `#marker=${encodeURIComponent(m.id)}&rx=${m.x}&rz=${m.z}`;
                    navigator.clipboard.writeText(url.toString());
                    showToast('Ссылка скопирована');
                }
            };
        }

        // Edit
        const editMarkerBtn = document.getElementById('editMarkerBtn');
        if (editMarkerBtn) {
            editMarkerBtn.onclick = () => {
                if (!selectedMarkerId) return;
                const m = markersStore.get(selectedMarkerId);
                if (m) openEditMarkerModal(m);
            };
        }

        // Delete
        const deleteMarkerBtn = document.getElementById('deleteMarkerBtn');
        if (deleteMarkerBtn) {
            deleteMarkerBtn.onclick = () => {
                if (selectedMarkerId) deleteMarker(selectedMarkerId);
            };
        }

        // Modal Category Buttons
        const catContainer = document.getElementById('categoryPickerGrid');
        if (catContainer) {
            catContainer.innerHTML = Object.values(CATEGORIES).map(cat => `
                <button type="button" class="category-option-btn" data-category="${cat.id}">
                    <span class="cat-dot" style="width:6px; height:6px; border-radius:50%; background:${cat.color};"></span>
                    <span>${cat.label || cat.name}</span>
                </button>
            `).join('');

            catContainer.querySelectorAll('.category-option-btn').forEach(btn => {
                btn.onclick = () => selectCategoryOption(btn.dataset.category);
            });
        }

        // Modal Save
        const saveModalBtn = document.getElementById('saveModalBtn');
        if (saveModalBtn) saveModalBtn.onclick = () => saveMarkerFromModal();

        // Modal Cancel & Close
        const cancelModalBtn = document.getElementById('cancelModalBtn');
        const modalCloseBtn = document.getElementById('modalCloseBtn');
        if (cancelModalBtn) cancelModalBtn.onclick = () => closeModal();
        if (modalCloseBtn) modalCloseBtn.onclick = () => closeModal();

        // Pick Center Coords Button
        const pickCenterCoordsBtn = document.getElementById('pickCenterCoordsBtn');
        if (pickCenterCoordsBtn) {
            pickCenterCoordsBtn.onclick = () => {
                const center = unmined.olMap.getView().getCenter();
                const b = viewToBlock(center);
                document.getElementById('markerXInput').value = b[0];
                document.getElementById('markerZInput').value = b[1];
                showToast(`Координаты: ${b[0]}, ${b[1]}`);
            };
        }

        // Image Dropzone
        const dropzone = document.getElementById('imageDropzone');
        const fileInput = document.getElementById('markerImageFileInput');
        if (dropzone && fileInput) {
            dropzone.onclick = () => fileInput.click();

            fileInput.onchange = async (e) => {
                const file = e.target.files[0];
                if (file) {
                    try {
                        const compressed = await MarkersStore.compressImageFile(file);
                        updateModalImagePreview(compressed);
                    } catch (err) {
                        showToast(err.message);
                    }
                }
            };

            dropzone.ondragover = (e) => {
                e.preventDefault();
                dropzone.classList.add('dragover');
            };

            dropzone.ondragleave = () => dropzone.classList.remove('dragover');

            dropzone.ondrop = async (e) => {
                e.preventDefault();
                dropzone.classList.remove('dragover');
                const file = e.dataTransfer.files[0];
                if (file) {
                    try {
                        const compressed = await MarkersStore.compressImageFile(file);
                        updateModalImagePreview(compressed);
                    } catch (err) {
                        showToast(err.message);
                    }
                }
            };
        }

        // Remove Modal Image
        const removeImgBtn = document.getElementById('removeModalImageBtn');
        if (removeImgBtn) {
            removeImgBtn.onclick = () => updateModalImagePreview('');
        }

        // Image URL Input
        const urlInput = document.getElementById('markerImageUrlInput');
        if (urlInput) {
            urlInput.oninput = () => {
                const val = urlInput.value.trim();
                if (val) updateModalImagePreview(val);
            };
        }

        // Global Paste (Ctrl+V) for Screenshots
        window.addEventListener('paste', async (e) => {
            const items = (e.clipboardData || e.originalEvent.clipboardData).items;
            for (let item of items) {
                if (item.type.indexOf('image') === 0) {
                    const blob = item.getAsFile();
                    try {
                        const compressed = await MarkersStore.compressImageFile(blob);
                        const modal = document.getElementById('markerModal');
                        if (modal.classList.contains('active')) {
                            updateModalImagePreview(compressed);
                            showToast('Скриншот вставлен');
                        } else if (selectedMarkerId) {
                            const m = markersStore.get(selectedMarkerId);
                            if (m) {
                                m.image = compressed;
                                await markersStore.save(m);
                                renderMarkersOnMap();
                                renderSidebarList();
                                openMarkerDetail(m);
                                showToast('Скриншот сохранен в точку');
                            }
                        }
                    } catch (err) {
                        showToast('Ошибка при вставке');
                    }
                    break;
                }
            }
        });

        // Search Input
        const searchInput = document.getElementById('sidebarSearchInput');
        if (searchInput) {
            searchInput.oninput = (e) => {
                searchQuery = e.target.value.trim();
                renderSidebarList();
            };
        }

        // Category Filter Chips
        const filterContainer = document.getElementById('categoryFilterChips');
        if (filterContainer) {
            let filterHtml = `<button class="filter-chip active" data-filter="all">Все</button>`;
            Object.values(CATEGORIES).forEach(cat => {
                filterHtml += `
                    <button class="filter-chip" data-filter="${cat.id}">
                        <span class="filter-chip-dot" style="color:${cat.color};"></span>
                        ${cat.label || cat.name}
                    </button>
                `;
            });
            filterContainer.innerHTML = filterHtml;

            filterContainer.querySelectorAll('.filter-chip').forEach(chip => {
                chip.onclick = () => {
                    filterContainer.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
                    chip.classList.add('active');
                    activeCategoryFilter = chip.dataset.filter;
                    renderSidebarList();
                };
            });
        }

        // Export / Import
        const exportBtn = document.getElementById('exportMarkersBtn');
        const importBtn = document.getElementById('importMarkersBtn');
        if (exportBtn) exportBtn.onclick = () => exportMarkers();
        if (importBtn) importBtn.onclick = () => triggerImportMarkers();

        // Lightbox Close
        const lightbox = document.getElementById('lightboxBackdrop');
        if (lightbox) {
            lightbox.onclick = (e) => {
                if (e.target !== document.getElementById('lightboxImage')) {
                    closeLightbox();
                }
            };
        }

        // Keyboard Shortcuts
        window.addEventListener('keydown', (e) => {
            const isInputFocused = document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);

            if (e.key === 'Escape') {
                if (document.getElementById('lightboxBackdrop').classList.contains('active')) {
                    closeLightbox();
                } else if (document.getElementById('markerModal').classList.contains('active')) {
                    closeModal();
                } else if (isAddMarkerMode) {
                    exitAddMarkerMode();
                } else if (document.getElementById('markerDetailDrawer').classList.contains('active')) {
                    closeMarkerDetail();
                }
            } else if (!isInputFocused) {
                if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') {
                    e.preventDefault();
                    teleportToRandomPlace();
                } else if (e.key === 'n' || e.key === 'N' || e.key === 'т' || e.key === 'Т') {
                    e.preventDefault();
                    if (!isAddMarkerMode) enterAddMarkerMode();
                } else if (e.key === '/') {
                    e.preventDefault();
                    const search = document.getElementById('sidebarSearchInput');
                    const sidebar = document.getElementById('sidebarPanel');
                    if (sidebar) sidebar.classList.remove('collapsed');
                    if (search) search.focus();
                } else if (e.key === 'Tab') {
                    e.preventDefault();
                    const sidebar = document.getElementById('sidebarPanel');
                    if (sidebar) sidebar.classList.toggle('collapsed');
                }
            }
        });
    }

    /**
     * Start the Application
     */
    async function start() {
        try {
            await markersStore.init();
            initMarkersLayer();
            hookUnminedContextMenu();
            initUI();
            renderMarkersOnMap();
            renderSidebarList();
            checkInitialUrlHash();
            console.log('[OhioWorld] OLED Map ready.');
        } catch (err) {
            console.error('[OhioWorld] Initialization error', err);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

})();
