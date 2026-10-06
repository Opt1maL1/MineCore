/**
 * OhioWorld Map - Markers Store (OLED Edition)
 * Handles IndexedDB persistence, LocalStorage fallback, image compression, export/import
 */

const CATEGORIES = {
    base: { id: 'base', name: 'База / Укрытие', label: 'База', color: '#38bdf8' },
    settlement: { id: 'settlement', name: 'Поселение / Город', label: 'Город', color: '#34d399' },
    portal: { id: 'portal', name: 'Портал', label: 'Портал', color: '#a78bfa' },
    farm: { id: 'farm', name: 'Ферма / Ресурсы', label: 'Ферма', color: '#a3e635' },
    mine: { id: 'mine', name: 'Шахта / Данж', label: 'Шахта', color: '#fbbf24' },
    trade: { id: 'trade', name: 'Рынок / Торговля', label: 'Рынок', color: '#f472b6' },
    poi: { id: 'poi', name: 'Точка интереса', label: 'Интересное', color: '#fb923c' },
    other: { id: 'other', name: 'Прочее', label: 'Прочее', color: '#94a3b8' }
};

class MarkersStore {
    constructor() {
        this.dbName = 'OhioWorldMapDB';
        this.dbVersion = 1;
        this.storeName = 'markers';
        this.db = null;
        this.cache = new Map();
        this.isInitialized = false;
        this.useLocalStorage = false;
    }

    async init() {
        if (this.isInitialized) return;

        try {
            await this._initIndexedDB();
        } catch (e) {
            console.warn('[MarkersStore] IndexedDB unavailable, using localStorage:', e);
            this.useLocalStorage = true;
        }

        const markers = await this.getAll();
        if (markers.length === 0) {
            await this._createDefaultMarkers();
        }

        this.isInitialized = true;
    }

    _initIndexedDB() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) {
                return reject(new Error('IndexedDB not supported'));
            }

            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'id' });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }

    async _createDefaultMarkers() {
        const defaultSpawn = {
            id: 'marker-spawn-init',
            title: 'Спавн мира (Spawn)',
            category: 'poi',
            color: '#fb923c',
            x: 0,
            z: 0,
            description: 'Нулевые координаты и стартовая точка мира OhioWorld.',
            image: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        await this.save(defaultSpawn);
    }

    async getAll() {
        if (this.useLocalStorage) {
            try {
                const raw = localStorage.getItem('ohio_markers');
                const list = raw ? JSON.parse(raw) : [];
                this.cache.clear();
                list.forEach(m => {
                    this._normalizeCategory(m);
                    this.cache.set(m.id, m);
                });
                return list;
            } catch (err) {
                console.error('Error reading localStorage markers', err);
                return [];
            }
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.getAll();

            request.onsuccess = () => {
                const list = request.result || [];
                this.cache.clear();
                list.forEach(m => {
                    this._normalizeCategory(m);
                    this.cache.set(m.id, m);
                });
                resolve(list);
            };

            request.onerror = () => reject(request.error);
        });
    }

    _normalizeCategory(m) {
        // Map any legacy categories seamlessly
        if (m.category === 'city') m.category = 'settlement';
        if (m.category === 'landmark') m.category = 'poi';
        if (m.category === 'shop') m.category = 'trade';
        if (!CATEGORIES[m.category]) m.category = 'other';
    }

    get(id) {
        return this.cache.get(id) || null;
    }

    async save(marker) {
        if (!marker.id) {
            marker.id = 'marker_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
        }
        if (!marker.createdAt) {
            marker.createdAt = new Date().toISOString();
        }
        marker.updatedAt = new Date().toISOString();
        marker.x = Math.round(Number(marker.x) || 0);
        marker.z = Math.round(Number(marker.z) || 0);
        this._normalizeCategory(marker);

        this.cache.set(marker.id, marker);

        if (this.useLocalStorage) {
            const list = Array.from(this.cache.values());
            try {
                localStorage.setItem('ohio_markers', JSON.stringify(list));
            } catch (e) {
                console.warn('LocalStorage quota limit reached, saving stripped images', e);
                const safeList = list.map(m => ({ ...m, image: m.image ? m.image.substring(0, 100) : '' }));
                localStorage.setItem('ohio_markers', JSON.stringify(safeList));
            }
            return marker;
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put(marker);

            request.onsuccess = () => resolve(marker);
            request.onerror = () => reject(request.error);
        });
    }

    async delete(id) {
        this.cache.delete(id);

        if (this.useLocalStorage) {
            const list = Array.from(this.cache.values());
            localStorage.setItem('ohio_markers', JSON.stringify(list));
            return true;
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(id);

            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    async exportJSON() {
        const markers = await this.getAll();
        const exportData = {
            version: 2,
            theme: 'oled',
            world: 'OhioWorld',
            exportedAt: new Date().toISOString(),
            markers: markers
        };
        return JSON.stringify(exportData, null, 2);
    }

    async importJSON(jsonText, replaceExisting = false) {
        let data;
        try {
            data = JSON.parse(jsonText);
        } catch (e) {
            throw new Error('Некорректный формат файла JSON');
        }

        const list = Array.isArray(data) ? data : (data.markers || []);
        if (!Array.isArray(list)) {
            throw new Error('В файле не найден список меток');
        }

        if (replaceExisting) {
            const current = await this.getAll();
            for (const item of current) {
                await this.delete(item.id);
            }
        }

        let importedCount = 0;
        for (const item of list) {
            if (typeof item.x === 'number' && typeof item.z === 'number' && item.title) {
                await this.save({
                    id: item.id || ('imported_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8)),
                    title: String(item.title).trim(),
                    category: item.category || 'other',
                    color: item.color || CATEGORIES[item.category]?.color || '#38bdf8',
                    x: Math.round(item.x),
                    z: Math.round(item.z),
                    description: item.description || '',
                    image: item.image || '',
                    createdAt: item.createdAt || new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
                importedCount++;
            }
        }

        return importedCount;
    }

    static compressImageFile(file, maxDimension = 1600, quality = 0.85) {
        return new Promise((resolve, reject) => {
            if (!file.type.startsWith('image/')) {
                return reject(new Error('Выбранный файл не является изображением'));
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    let { width, height } = img;
                    if (width > maxDimension || height > maxDimension) {
                        if (width > height) {
                            height = Math.round((height * maxDimension) / width);
                            width = maxDimension;
                        } else {
                            width = Math.round((width * maxDimension) / height);
                            height = maxDimension;
                        }
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                    ctx.drawImage(img, 0, 0, width, height);

                    let result = canvas.toDataURL('image/webp', quality);
                    if (!result.startsWith('data:image/webp')) {
                        result = canvas.toDataURL('image/jpeg', quality);
                    }
                    resolve(result);
                };
                img.onerror = () => reject(new Error('Не удалось обработать изображение'));
                img.src = e.target.result;
            };
            reader.onerror = () => reject(new Error('Ошибка чтения файла'));
            reader.readAsDataURL(file);
        });
    }
}

window.markersStore = new MarkersStore();
