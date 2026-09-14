// ==UserScript==
// @name         Polymarket Portfolio APR Overlay
// @namespace    http://tampermonkey.net/
// @version      0.10.0
// @description  在 Polymarket portfolio/profile 页面显示继续持有 APR、建仓 APR、剩余期限和风险筛选。
// @author       飞人牙膏 & AI Assistant
// @match        https://polymarket.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      data-api.polymarket.com
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const DATA_API = 'https://data-api.polymarket.com';
    const PAGE_SIZE = 500;
    const REFRESH_MS = 30000;
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const SETTLEMENT_TIME_ZONE = 'America/New_York';
    const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

    const STORAGE = {
        address: 'pm-apr-overlay-address',
        minSize: 'pm-apr-overlay-min-size',
        aprThreshold: 'pm-apr-overlay-apr-threshold',
        losingThreshold: 'pm-apr-overlay-losing-threshold',
        filter: 'pm-apr-overlay-filter',
        collapsed: 'pm-apr-overlay-collapsed',
        position: 'pm-apr-overlay-position',
        sortKey: 'pm-apr-overlay-sort-key',
        sortDirection: 'pm-apr-overlay-sort-direction'
    };

    const DEFAULTS = {
        minSize: 0.1,
        aprThreshold: 8,
        losingThreshold: 0.5,
        filter: 'all',
        collapsed: true,
        sortKey: '',
        sortDirection: ''
    };

    const SORT_KEYS = ['market', 'price', 'holdApr', 'costApr', 'daysToSettle', 'status'];

    let host = null;
    let shadow = null;
    let positions = [];
    let currentAddress = readString(STORAGE.address, '');
    let minSize = readNumber(STORAGE.minSize, DEFAULTS.minSize, 0);
    let aprThreshold = readNumber(STORAGE.aprThreshold, DEFAULTS.aprThreshold, 0);
    let losingThreshold = readNumber(STORAGE.losingThreshold, DEFAULTS.losingThreshold, 0, 1);
    let activeFilter = readString(STORAGE.filter, DEFAULTS.filter);
    let collapsed = readBoolean(STORAGE.collapsed, DEFAULTS.collapsed);
    let panelPosition = readPosition(STORAGE.position);
    let sortKey = readString(STORAGE.sortKey, DEFAULTS.sortKey);
    let sortDirection = readString(STORAGE.sortDirection, DEFAULTS.sortDirection);
    let suppressNextCollapseClick = false;
    let isLoading = false;
    let lastError = '';
    let lastFetchedAt = null;
    let refreshTimer = null;
    let refreshDebounceTimer = null;
    let lastPathname = '';

    // Older versions stored the two price columns independently. Preserve a
    // previous price sort as a sort on the merged column (by current price).
    if (sortKey === 'curPrice' || sortKey === 'avgPrice') sortKey = 'price';
    if (SORT_KEYS.indexOf(sortKey) === -1) sortKey = '';
    if (sortDirection !== 'asc' && sortDirection !== 'desc') sortDirection = '';

    console.log('[PM APR] v0.10.0 启动');

    function readString(key, fallback) {
        try {
            const value = GM_getValue(key, fallback);
            return typeof value === 'string' ? value : fallback;
        } catch (error) {
            return fallback;
        }
    }

    function readNumber(key, fallback, min, max) {
        try {
            const value = Number(GM_getValue(key, fallback));
            if (!Number.isFinite(value) || value < min || (typeof max === 'number' && value > max)) {
                return fallback;
            }
            return value;
        } catch (error) {
            return fallback;
        }
    }

    function readBoolean(key, fallback) {
        try {
            const value = GM_getValue(key, fallback);
            return typeof value === 'boolean' ? value : fallback;
        } catch (error) {
            return fallback;
        }
    }

    function readPosition(key) {
        try {
            const stored = GM_getValue(key, null);
            const value = typeof stored === 'string' ? JSON.parse(stored) : stored;
            if (value && Number.isFinite(Number(value.left)) && Number.isFinite(Number(value.top))) {
                return { left: Number(value.left), top: Number(value.top) };
            }
        } catch (error) {
            // Ignore an invalid saved position and use the default corner.
        }
        return null;
    }

    function saveValue(key, value) {
        try {
            GM_setValue(key, value);
        } catch (error) {
            console.warn('[PM APR] 保存设置失败:', error);
        }
    }

    function panelPositionStyle() {
        if (!panelPosition) return 'top: 8px; right: 8px;';

        const panelWidth = collapsed ? 40 : Math.min(780, Math.max(0, window.innerWidth - 16));
        const panelHeight = collapsed ? 40 : Math.min(480, Math.max(0, window.innerHeight - 16));
        const maxLeft = Math.max(8, window.innerWidth - panelWidth - 8);
        const maxTop = Math.max(8, window.innerHeight - panelHeight - 8);
        const left = Math.min(Math.max(8, panelPosition.left), maxLeft);
        const top = Math.min(Math.max(8, panelPosition.top), maxTop);
        return `left: ${left}px; top: ${top}px; right: auto;`;
    }

    function describeInteractionTarget(event) {
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
        for (const item of path) {
            if (!item || item.nodeType !== 1 || item === host) continue;
            const action = item.getAttribute('data-action');
            const field = item.getAttribute('data-field');
            const text = String(item.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
            return {
                tag: item.tagName.toLowerCase(),
                action: action || undefined,
                field: field || undefined,
                text: text || undefined,
            };
        }
        return { tag: 'unknown' };
    }

    function logInteraction(type, event) {
        console.log(`[PM APR][interaction] ${type}`, {
            target: describeInteractionTarget(event),
            collapsed: collapsed,
            pointerType: event.pointerType || undefined,
            button: typeof event.button === 'number' ? event.button : undefined,
            x: typeof event.clientX === 'number' ? Math.round(event.clientX) : undefined,
            y: typeof event.clientY === 'number' ? Math.round(event.clientY) : undefined,
        });
    }

    function installInteractionLogging() {
        if (!shadow) return;
        shadow.addEventListener('click', (event) => logInteraction('click', event), true);
        shadow.addEventListener('dblclick', (event) => logInteraction('dblclick', event), true);
        shadow.addEventListener('contextmenu', (event) => logInteraction('contextmenu', event), true);
        shadow.addEventListener('pointerdown', (event) => logInteraction('pointerdown', event), true);
        shadow.addEventListener('pointerup', (event) => logInteraction('pointerup', event), true);
        shadow.addEventListener('change', (event) => logInteraction('change', event), true);
    }

    function isSupportedPage() {
        return location.pathname.startsWith('/portfolio') || location.pathname.startsWith('/profile');
    }

    function isValidAddress(address) {
        return ADDRESS_RE.test(String(address || '').trim());
    }

    function addressFromText(text) {
        const value = String(text || '');
        const match = value.match(/0x[a-fA-F0-9]{40}/);
        return match ? match[0].toLowerCase() : '';
    }

    function addressFromPageUrl() {
        const href = location.href;
        const queryCandidate = new URL(location.href).searchParams.get('user');
        if (isValidAddress(queryCandidate)) return queryCandidate.toLowerCase();
        if (/\/profile\/0x[a-fA-F0-9]{40}/i.test(href)) {
            return addressFromText(href);
        }
        return '';
    }

    function adoptAddress(address, source) {
        const normalized = String(address || '').trim().toLowerCase();
        if (!isValidAddress(normalized) || normalized === currentAddress) return false;
        currentAddress = normalized;
        saveValue(STORAGE.address, currentAddress);
        console.log(`[PM APR] 🎯 使用地址 (${source}): ${currentAddress}`);
        scheduleRefresh(50);
        render();
        return true;
    }

    function installAddressCaptureFallback() {
        const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        if (!pageWindow || typeof pageWindow.fetch !== 'function') return;

        const originFetch = pageWindow.fetch;
        pageWindow.fetch = function () {
            const args = Array.prototype.slice.call(arguments);
            const resource = args[0];
            const requestUrl = typeof resource === 'string' ? resource : (resource && resource.url) || '';
            if (/[?&]user=0x[a-fA-F0-9]{40}/.test(requestUrl)) {
                adoptAddress(addressFromText(requestUrl), '页面请求');
            }
            return originFetch.apply(this, args);
        };
    }

    function gmFetchJson(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                headers: { Accept: 'application/json' },
                timeout: 15000,
                onload: (response) => {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error(`HTTP ${response.status}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(response.responseText));
                    } catch (error) {
                        reject(new Error('API 返回的不是有效 JSON'));
                    }
                },
                onerror: () => reject(new Error('跨域请求失败')),
                ontimeout: () => reject(new Error('API 请求超时'))
            });
        });
    }

    function extractPositionArray(data) {
        if (Array.isArray(data)) return data;
        if (!data || typeof data !== 'object') return [];
        for (const key of ['positions', 'data', 'results', 'items']) {
            if (Array.isArray(data[key])) return data[key];
        }
        return [];
    }

    async function fetchAllPositions(address) {
        const all = [];
        for (let offset = 0; offset <= 10000; offset += PAGE_SIZE) {
            const params = new URLSearchParams({
                user: address,
                sizeThreshold: '0',
                limit: String(PAGE_SIZE),
                offset: String(offset),
                sortBy: 'TOKENS',
                sortDirection: 'DESC'
            });
            const page = extractPositionArray(await gmFetchJson(`${DATA_API}/positions?${params.toString()}`));
            Array.prototype.push.apply(all, page);
            if (page.length < PAGE_SIZE) break;
        }
        return all.filter((position) => Number(position.size) >= minSize);
    }

    function getTimeZoneOffsetMinutes(date, timeZone) {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23'
        }).formatToParts(date);
        const values = {};
        for (const part of parts) {
            if (part.type !== 'literal') values[part.type] = part.value;
        }
        const asUtcMs = Date.UTC(
            Number(values.year),
            Number(values.month) - 1,
            Number(values.day),
            Number(values.hour),
            Number(values.minute),
            Number(values.second)
        );
        if (!Number.isFinite(asUtcMs)) return 0;
        return Math.round((asUtcMs - date.getTime()) / (60 * 1000));
    }

    function settlementUtcMs(value) {
        if (!value) return null;
        const dateString = String(value).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
            const parsed = new Date(dateString).getTime();
            return Number.isNaN(parsed) ? null : parsed;
        }

        const startOfDayUtcMs = new Date(`${dateString}T00:00:00.000Z`).getTime();
        if (Number.isNaN(startOfDayUtcMs)) return null;

        const endOfDayUtcMs = startOfDayUtcMs + MS_PER_DAY - 1;
        let settlementMs = endOfDayUtcMs;
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const offsetMinutes = getTimeZoneOffsetMinutes(new Date(settlementMs), SETTLEMENT_TIME_ZONE);
            settlementMs = endOfDayUtcMs - offsetMinutes * 60 * 1000;
        }
        return settlementMs;
    }

    function calcApr(position, now = new Date()) {
        const curPrice = Number(position.curPrice);
        const avgPrice = Number(position.avgPrice);
        const holdRoi = curPrice > 0 ? (1 - curPrice) / curPrice : 0;
        const costRoi = avgPrice > 0 ? (1 - avgPrice) / avgPrice : 0;
        let daysToSettle = Number.NaN;
        let holdApr = null;
        let costApr = null;
        let note = '';

        if (!position.endDate) {
            note = '缺少结算日期';
        } else {
            const endMs = settlementUtcMs(position.endDate);
            if (endMs === null) {
                note = '结算日期无法解析';
            } else {
                daysToSettle = (endMs - now.getTime()) / MS_PER_DAY;
                if (daysToSettle <= 0) {
                    note = '已过结算日';
                } else {
                    holdApr = curPrice > 0 && curPrice < 1 ? (holdRoi * 365) / daysToSettle : 0;
                    costApr = avgPrice > 0 && avgPrice < 1 ? (costRoi * 365) / daysToSettle : 0;
                    if (curPrice <= 0 || curPrice >= 1) note = '市价无套利空间';
                }
            }
        }

        return {
            curPrice: curPrice,
            avgPrice: avgPrice,
            holdRoi: holdRoi,
            costRoi: costRoi,
            daysToSettle: daysToSettle,
            holdApr: holdApr,
            costApr: costApr,
            note: note,
        };
    }

    function enrichPosition(position) {
        const result = calcApr(position);
        const cashPnl = Number(position.cashPnl);
        const currentLoss = Number.isFinite(cashPnl) && cashPnl < 0;
        const losing = currentLoss || result.curPrice < losingThreshold;
        let status = 'good';
        if (position.redeemable) {
            status = 'redeemable';
        } else if (losing) {
            status = 'losing';
        } else if (result.holdApr === null || result.holdApr * 100 <= aprThreshold) {
            status = 'attention';
        }
        return Object.assign({}, position, result, { status: status });
    }

    async function refresh() {
        if (!isSupportedPage() || isLoading) return;
        if (!isValidAddress(currentAddress)) {
            lastError = '请先输入 Profile/Proxy Wallet 地址';
            render();
            return;
        }

        isLoading = true;
        lastError = '';
        render();
        console.log(`[PM APR] 开始读取持仓: ${currentAddress}`);
        try {
            const rawPositions = await fetchAllPositions(currentAddress);
            positions = rawPositions.map(enrichPosition);
            lastFetchedAt = new Date();
            console.log(`[PM APR] ✅ 读取 ${positions.length} 个符合最小仓位条件的持仓`);
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
            console.error('[PM APR] ❌ 拉取失败:', error);
        } finally {
            isLoading = false;
            render();
        }
    }

    function scheduleRefresh(delay = 200) {
        clearTimeout(refreshDebounceTimer);
        refreshDebounceTimer = setTimeout(refresh, delay);
    }

    function statusLabel(status) {
        return {
            good: '正常',
            attention: '低年化/异常',
            losing: '当前亏损/方向风险',
            redeemable: '已结算可赎回'
        }[status] || status;
    }

    function statusClass(status) {
        return `status-${status}`;
    }

    function compareSortValues(a, b) {
        let aValue;
        let bValue;
        let aMissing = false;
        let bMissing = false;

        if (sortKey === 'market') {
            aValue = `${a.title || ''} ${a.outcome || ''}`.trim().toLowerCase();
            bValue = `${b.title || ''} ${b.outcome || ''}`.trim().toLowerCase();
            aMissing = !aValue;
            bMissing = !bValue;
        } else if (sortKey === 'status') {
            const statusOrder = { losing: 0, attention: 1, redeemable: 2, good: 3 };
            aValue = Object.prototype.hasOwnProperty.call(statusOrder, a.status) ? statusOrder[a.status] : 99;
            bValue = Object.prototype.hasOwnProperty.call(statusOrder, b.status) ? statusOrder[b.status] : 99;
        } else {
            const valueKey = sortKey === 'price' ? 'curPrice' : sortKey;
            aValue = Number(a[valueKey]);
            bValue = Number(b[valueKey]);
            aMissing = !Number.isFinite(aValue);
            bMissing = !Number.isFinite(bValue);
        }

        // Keep unavailable APR/date values at the bottom, matching the
        // dashboard's practical behavior while preserving the chosen order.
        if (aMissing && bMissing) return 0;
        if (aMissing) return 1;
        if (bMissing) return -1;

        const direction = sortDirection === 'desc' ? -1 : 1;
        if (typeof aValue === 'string') return aValue.localeCompare(bValue, 'zh-CN') * direction;
        return (aValue - bValue) * direction;
    }

    function visiblePositions() {
        const filtered = positions.filter((position) => {
            if (activeFilter === 'attention') return position.status === 'attention';
            if (activeFilter === 'losing') return position.status === 'losing';
            if (activeFilter === 'redeemable') return position.status === 'redeemable';
            return true;
        });
        if (!sortKey || !sortDirection) return filtered;
        return filtered.slice().sort(compareSortValues);
    }

    function sortIndicator(key) {
        if (sortKey !== key || !sortDirection) return '↕';
        return sortDirection === 'asc' ? '↑' : '↓';
    }

    function sortHeader(key, label) {
        const active = sortKey === key && !!sortDirection;
        return `<th><button type="button" class="sort-button${active ? ' active' : ''}" data-sort="${key}" title="点击切换升序/降序/取消排序"><span>${label}</span><span class="sort-indicator">${sortIndicator(key)}</span></button></th>`;
    }

    function installDrag() {
        const header = shadow.querySelector('[data-drag-handle]');
        const panel = shadow.querySelector('.panel');
        if (!header || !panel) return;

        header.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;

            const target = event.target;
            const clickedControl = target && target.closest && target.closest('button, input, select');
            // In expanded mode controls keep their normal click behavior. The
            // icon itself remains draggable when the panel is collapsed.
            if (!collapsed && clickedControl) {
                console.log('[PM APR][drag] expanded control pointerdown ignored', describeInteractionTarget(event));
                return;
            }

            const rect = panel.getBoundingClientRect();
            const offsetX = event.clientX - rect.left;
            const offsetY = event.clientY - rect.top;
            let moved = false;
            const startX = event.clientX;
            const startY = event.clientY;
            console.log('[PM APR][drag] start', {
                collapsed: collapsed,
                target: describeInteractionTarget(event),
                left: Math.round(rect.left),
                top: Math.round(rect.top),
            });

            const move = (moveEvent) => {
                const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
                if (!moved && distance < 4) return;
                if (!moved) {
                    moved = true;
                    try {
                        header.setPointerCapture(event.pointerId);
                    } catch (captureError) {
                        // Pointer capture is optional; window listeners still track the drag.
                    }
                }
                const maxLeft = Math.max(4, window.innerWidth - rect.width - 4);
                const maxTop = Math.max(4, window.innerHeight - rect.height - 4);
                const left = Math.min(Math.max(4, moveEvent.clientX - offsetX), maxLeft);
                const top = Math.min(Math.max(4, moveEvent.clientY - offsetY), maxTop);
                panel.style.left = `${left}px`;
                panel.style.top = `${top}px`;
                panel.style.right = 'auto';
                moveEvent.preventDefault();
            };

            const end = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', end);
                window.removeEventListener('pointercancel', end);
                try {
                    if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
                } catch (releaseError) {
                    // Ignore browsers that do not expose pointer capture.
                }

                console.log('[PM APR][drag] end', {
                    moved: moved,
                    collapsed: collapsed,
                    left: moved ? Math.round(parseFloat(panel.style.left)) : Math.round(rect.left),
                    top: moved ? Math.round(parseFloat(panel.style.top)) : Math.round(rect.top),
                });
                if (!moved) return;
                panelPosition = {
                    left: parseFloat(panel.style.left),
                    top: parseFloat(panel.style.top),
                };
                saveValue(STORAGE.position, JSON.stringify(panelPosition));
                if (collapsed) {
                    suppressNextCollapseClick = true;
                    setTimeout(() => { suppressNextCollapseClick = false; }, 300);
                }
            };

            // Do not capture on pointerdown. Capturing immediately retargets a
            // normal click on the collapsed icon to the header div. Capture is
            // enabled only after the pointer has moved enough to be a drag.
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', end);
            window.addEventListener('pointercancel', end);
        });
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatNumber(value, digits = 3) {
        const number = Number(value);
        return Number.isFinite(number) ? number.toFixed(digits) : '—';
    }

    function formatPriceCents(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return '—';
        return `$${(number * 100).toFixed(2).replace(/\.?0+$/, '')}`;
    }

    function formatApr(value) {
        return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
    }

    function formatDays(value) {
        return typeof value === 'number' && Number.isFinite(value) ? `${Math.max(0, value).toFixed(1)} 天` : '—';
    }

    function formatDate(value) {
        if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '—';
        return value.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function formatEndDate(value) {
        if (!value) return '—';
        const dateString = String(value);
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return dateString;
        const parsed = new Date(dateString);
        return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('zh-CN');
    }

    function renderRows() {
        const visible = visiblePositions();
        if (visible.length === 0) {
            return `<tr><td class="empty" colspan="6">${positions.length ? '当前筛选条件下没有仓位' : '暂无持仓数据'}</td></tr>`;
        }
        return visible.map((position) => `
            <tr>
                <td class="market" title="${escapeHtml(position.title || '')}">
                    <div>${escapeHtml(position.title || 'Unknown market')}</div>
                    <small>${escapeHtml(position.outcome || 'unknown')} · 到期 ${escapeHtml(formatEndDate(position.endDate))}</small>
                </td>
                <td class="number price-path">${formatPriceCents(position.avgPrice)} <span class="price-arrow">→</span> ${formatPriceCents(position.curPrice)}</td>
                <td class="number ${position.holdApr !== null && position.holdApr * 100 <= aprThreshold ? 'danger' : 'good-value'}">${formatApr(position.holdApr)}</td>
                <td class="number">${formatApr(position.costApr)}</td>
                <td class="number">${formatDays(position.daysToSettle)}</td>
                <td><span class="pill ${statusClass(position.status)}">${statusLabel(position.status)}</span></td>
            </tr>
        `).join('');
    }

    function render() {
        if (!shadow) return;
        host.style.display = isSupportedPage() ? 'block' : 'none';

        const counts = {
            all: positions.length,
            attention: positions.filter((position) => position.status === 'attention').length,
            losing: positions.filter((position) => position.status === 'losing').length,
            redeemable: positions.filter((position) => position.status === 'redeemable').length
        };

        shadow.innerHTML = `
            <style>
                :host { all: initial; }
                * { box-sizing: border-box; }
                .panel {
                    position: fixed; z-index: 2147483647; top: 8px; right: 8px;
                    width: min(780px, calc(100vw - 16px)); max-height: calc(100vh - 16px);
                    overflow: auto; color: #e5eefc; background: rgba(8, 15, 30, .97);
                    border: 1px solid rgba(80, 140, 220, .45); border-radius: 14px;
                    box-shadow: 0 12px 36px rgba(0, 0, 0, .42); font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                    backdrop-filter: blur(14px);
                }
                .panel.collapsed { width: 40px; height: 40px; max-height: 40px; overflow: hidden; border-radius: 50%; background: rgba(8, 15, 30, .94); }
                .panel.collapsed .body, .panel.collapsed .brand { display: none; }
                .panel.collapsed .header { width: 40px; height: 40px; padding: 0; border-bottom: 0; justify-content: center; }
                .panel.collapsed .actions { width: 100%; height: 100%; display: block; }
                .panel.collapsed .actions button { display: none; }
                .panel.collapsed .actions button[data-action="collapse"] { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; padding: 0; border: 0; border-radius: 50%; font-size: 12px; font-weight: 800; color: #75d6ff; background: radial-gradient(circle, rgba(42, 108, 160, .65), rgba(13, 39, 68, .92)); }
                .header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 11px; border-bottom: 1px solid rgba(100, 140, 190, .25); cursor: grab; user-select: none; touch-action: none; }
                .header:active { cursor: grabbing; }
                .title { font-weight: 700; color: #f7fbff; font-size: 13px; }
                .sub { margin-top: 2px; color: #8da4c5; font-size: 10px; }
                .actions { display: flex; gap: 4px; }
                button, input, select { font: inherit; }
                button { cursor: pointer; border: 1px solid rgba(100, 160, 230, .4); border-radius: 6px; color: #d9ecff; background: rgba(28, 64, 105, .7); padding: 5px 8px; font-size: 11px; }
                button:hover { background: rgba(35, 91, 150, .9); }
                .body { padding: 9px 11px 11px; }
                .controls { display: grid; grid-template-columns: minmax(190px, 1fr) 76px 86px 86px 124px auto; gap: 5px; align-items: end; }
                label { display: flex; flex-direction: column; gap: 3px; color: #8da4c5; font-size: 10px; }
                input, select { min-width: 0; width: 100%; color: #e5eefc; background: #0b1729; border: 1px solid rgba(100, 140, 190, .38); border-radius: 6px; padding: 6px 7px; outline: none; font-size: 11px; }
                input:focus, select:focus { border-color: #44b7ff; }
                .summary { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; margin: 7px 0; color: #9cb2d0; font-size: 10px; }
                .summary span { padding: 4px 7px; border-radius: 99px; background: rgba(35, 63, 98, .5); }
                .summary .error { color: #ff9da9; background: rgba(145, 33, 54, .3); }
                .table-wrap { overflow-x: auto; border: 1px solid rgba(100, 140, 190, .24); border-radius: 9px; }
                table { width: 100%; min-width: 740px; border-collapse: collapse; font-size: 11px; }
                th, td { padding: 6px 7px; border-bottom: 1px solid rgba(100, 140, 190, .14); text-align: left; white-space: nowrap; }
                th { padding: 0; color: #8da4c5; background: rgba(25, 46, 74, .7); font-size: 10px; font-weight: 600; }
                .sort-button { display: flex; align-items: center; justify-content: space-between; gap: 4px; width: 100%; min-width: 76px; padding: 6px 7px; border: 0; border-radius: 0; color: #8da4c5; background: transparent; text-align: left; font-size: 10px; font-weight: 600; }
                .sort-button:hover, .sort-button.active { color: #70d5ff; background: rgba(45, 105, 155, .28); }
                .sort-indicator { color: #54708f; font-size: 13px; line-height: 1; }
                .sort-button.active .sort-indicator { color: #70d5ff; }
                tr:last-child td { border-bottom: 0; }
                .market { max-width: 240px; overflow: hidden; text-overflow: ellipsis; }
                .market div { overflow: hidden; text-overflow: ellipsis; }
                small { display: block; margin-top: 2px; color: #728bab; font-size: 10px; }
                .number { color: #c9dcf4; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; text-align: right; }
                .price-path { color: #d9e9ff; }
                .price-arrow { padding: 0 2px; color: #728bab; }
                .good-value { color: #65e6b0; }
                .danger { color: #ff8795; }
                .pill { display: inline-block; padding: 3px 6px; border-radius: 99px; font-size: 10px; }
                .status-good { color: #65e6b0; background: rgba(25, 145, 101, .18); }
                .status-attention { color: #ffd36a; background: rgba(180, 120, 20, .2); }
                .status-losing { color: #ff8795; background: rgba(190, 45, 70, .2); }
                .status-redeemable { color: #69c9ff; background: rgba(35, 120, 190, .2); }
                .empty { padding: 18px; color: #7890b1; text-align: center; }
                @media (max-width: 760px) { .controls { grid-template-columns: 1fr 1fr; } .controls label:first-child { grid-column: 1 / -1; } }
            </style>
            <div class="panel ${collapsed ? 'collapsed' : ''}" style="${panelPositionStyle()}">
                <div class="header" data-drag-handle="true">
                    <div class="brand">
                        <div class="title">Polymarket 仓位 APR</div>
                        <div class="sub">继续持有 APR / 建仓 APR · 只读监控</div>
                    </div>
                    <div class="actions">
                        ${collapsed ? '' : `<button type="button" data-action="refresh">${isLoading ? '读取中…' : '刷新'}</button>`}
                        <button type="button" data-action="collapse" title="${collapsed ? '展开 APR 浮层' : '收起为图标'}">${collapsed ? '%' : '收起'}</button>
                    </div>
                </div>
                <div class="body">
                    <div class="controls">
                        <label>Profile / Proxy Wallet 地址<input data-field="address" value="${escapeHtml(currentAddress)}" placeholder="0x + 40 位十六进制字符"></label>
                        <label>最小仓位<input data-field="min-size" type="number" min="0" step="0.01" value="${minSize}"></label>
                        <label>APR 阈值 %<input data-field="apr-threshold" type="number" min="0" step="0.5" value="${aprThreshold}"></label>
                        <label>风险价格阈值<input data-field="losing-threshold" type="number" min="0" max="1" step="0.05" value="${losingThreshold}"></label>
                        <label>筛选<select data-field="filter">
                            <option value="all" ${activeFilter === 'all' ? 'selected' : ''}>全部 (${counts.all})</option>
                            <option value="attention" ${activeFilter === 'attention' ? 'selected' : ''}>低年化/异常 (${counts.attention})</option>
                            <option value="losing" ${activeFilter === 'losing' ? 'selected' : ''}>当前亏损/风险 (${counts.losing})</option>
                            <option value="redeemable" ${activeFilter === 'redeemable' ? 'selected' : ''}>可赎回 (${counts.redeemable})</option>
                        </select></label>
                        <button type="button" data-action="apply">应用</button>
                    </div>
                    <div class="summary">
                        <span>地址：${escapeHtml(currentAddress ? `${currentAddress.slice(0, 6)}…${currentAddress.slice(-4)}` : '未设置')}</span>
                        <span>数据：${lastFetchedAt ? formatDate(lastFetchedAt) : '尚未读取'}</span>
                        ${lastError ? `<span class="error">${escapeHtml(lastError)}</span>` : ''}
                    </div>
                    <div class="table-wrap">
                        <table>
                            <thead><tr>
                                ${sortHeader('market', '市场 / 方向')}
                                ${sortHeader('price', '建仓价 → 当前价')}
                                ${sortHeader('holdApr', '继续持有 APR')}
                                ${sortHeader('costApr', '建仓 APR')}
                                ${sortHeader('daysToSettle', '剩余时间')}
                                ${sortHeader('status', '状态')}
                            </tr></thead>
                            <tbody>${renderRows()}</tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;

        const action = (name) => shadow.querySelector(`[data-action="${name}"]`);
        const sortButtons = shadow.querySelectorAll('[data-sort]');
        sortButtons.forEach((button) => button.addEventListener('click', (event) => {
            event.stopPropagation();
            const nextKey = button.getAttribute('data-sort');
            if (SORT_KEYS.indexOf(nextKey) === -1) return;

            if (sortKey !== nextKey) {
                sortKey = nextKey;
                sortDirection = 'asc';
            } else if (sortDirection === 'asc') {
                sortDirection = 'desc';
            } else {
                sortKey = '';
                sortDirection = '';
            }

            saveValue(STORAGE.sortKey, sortKey);
            saveValue(STORAGE.sortDirection, sortDirection);
            console.log('[PM APR][handler] sort clicked', {
                sortKey: sortKey || 'none',
                sortDirection: sortDirection || 'none',
            });
            render();
        }));

        const refreshAction = action('refresh');
        if (refreshAction) refreshAction.addEventListener('click', () => {
            console.log('[PM APR][handler] refresh clicked');
            const addressInput = shadow.querySelector('[data-field="address"]');
            if (addressInput) adoptAddress(addressInput.value, '手动输入');
            scheduleRefresh(0);
        });
        const collapseAction = action('collapse');
        if (collapseAction) collapseAction.addEventListener('click', () => {
            console.log('[PM APR][handler] collapse clicked', { suppressNextCollapseClick: suppressNextCollapseClick, collapsed: collapsed });
            if (suppressNextCollapseClick) {
                suppressNextCollapseClick = false;
                console.log('[PM APR][handler] collapse click suppressed because it followed a drag');
                return;
            }
            collapsed = !collapsed;
            saveValue(STORAGE.collapsed, collapsed);
            console.log('[PM APR][handler] collapsed state changed', collapsed);
            render();
        });
        const applyAction = action('apply');
        if (applyAction) applyAction.addEventListener('click', () => {
            console.log('[PM APR][handler] apply clicked');
            const addressInput = shadow.querySelector('[data-field="address"]');
            const minSizeInput = shadow.querySelector('[data-field="min-size"]');
            const aprInput = shadow.querySelector('[data-field="apr-threshold"]');
            const losingInput = shadow.querySelector('[data-field="losing-threshold"]');
            const filterInput = shadow.querySelector('[data-field="filter"]');
            const nextAddress = addressInput ? addressInput.value.trim().toLowerCase() : currentAddress;
            const nextMinSize = minSizeInput ? Number(minSizeInput.value) : minSize;
            const nextAprThreshold = aprInput ? Number(aprInput.value) : aprThreshold;
            const nextLosingThreshold = losingInput ? Number(losingInput.value) : losingThreshold;
            console.log('[PM APR][handler] apply values', {
                address: nextAddress ? `${nextAddress.slice(0, 6)}…${nextAddress.slice(-4)}` : 'empty',
                minSize: nextMinSize,
                aprThreshold: nextAprThreshold,
                losingThreshold: nextLosingThreshold,
                filter: filterInput ? filterInput.value : 'all',
            });
            if (!isValidAddress(nextAddress)) {
                lastError = '地址格式错误，应为 0x + 40 位十六进制字符';
                render();
                return;
            }
            if (!Number.isFinite(nextMinSize) || nextMinSize < 0 || !Number.isFinite(nextAprThreshold) || nextAprThreshold < 0 || !Number.isFinite(nextLosingThreshold) || nextLosingThreshold < 0 || nextLosingThreshold > 1) {
                lastError = '筛选参数格式错误';
                render();
                return;
            }
            const addressChanged = nextAddress !== currentAddress;
            currentAddress = nextAddress;
            minSize = nextMinSize;
            aprThreshold = nextAprThreshold;
            losingThreshold = nextLosingThreshold;
            activeFilter = filterInput ? filterInput.value : 'all';
            saveValue(STORAGE.address, currentAddress);
            saveValue(STORAGE.minSize, minSize);
            saveValue(STORAGE.aprThreshold, aprThreshold);
            saveValue(STORAGE.losingThreshold, losingThreshold);
            saveValue(STORAGE.filter, activeFilter);
            if (addressChanged || positions.length === 0) scheduleRefresh(0);
            else {
                positions = positions.map(enrichPosition);
                render();
            }
        });

        installDrag();
    }

    function mount() {
        if (!document.body) return;
        if (!host || !host.isConnected) {
            host = document.createElement('div');
            host.id = 'pm-apr-overlay-host';
            document.body.appendChild(host);
            shadow = host.attachShadow({ mode: 'closed' });
            installInteractionLogging();
        }
        render();
    }

    function init() {
        currentAddress = addressFromPageUrl() || currentAddress;
        if (isValidAddress(currentAddress)) saveValue(STORAGE.address, currentAddress);
        installAddressCaptureFallback();
        mount();
        lastPathname = location.pathname;
        if (isSupportedPage() && isValidAddress(currentAddress)) scheduleRefresh(400);
        refreshTimer = setInterval(() => {
            mount();
            if (location.pathname !== lastPathname) {
                lastPathname = location.pathname;
                render();
                if (isSupportedPage()) scheduleRefresh(300);
            }
            if (isSupportedPage() && isValidAddress(currentAddress)) scheduleRefresh(0);
        }, REFRESH_MS);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
