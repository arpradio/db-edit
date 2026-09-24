import { APIClient } from './api.js';
import { UIComponents } from './ui.js';
import { ModalManager } from './modals.js';
import { SongEditor } from './song-editor.js';
import { StateManager, state, DIRTY_CHANGED_EVENT, refreshCountsAndStats } from './state.js';

const FIELD_LABELS = {
    title: 'Title',
    artists: 'Artists',
    genres: 'Genres',
    duration: 'Duration',
    validation_status: 'Status',
    isrc: 'ISRC',
    iswc: 'ISWC',
    is_explicit: 'Explicit',
    is_ai_generated: 'AI Generated'
};

function formatValue(value) {
    if (Array.isArray(value)) {
        const names = value.map(item => (typeof item === 'object' && item !== null ? item.name : item));
        return names.length ? names.join(', ') : '(none)';
    }
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (value === null || value === undefined || value === '') return '(empty)';
    return String(value);
}

// Save-all across every edited song card, plus guards against losing unsaved edits.
export class GlobalSave {
    static init() {
        document.addEventListener(DIRTY_CHANGED_EVENT, () => GlobalSave.update());

        // Text fields only fire onchange on blur; mark as soon as the user types
        document.addEventListener('input', (event) => {
            const card = event.target.closest('.song-card');
            if (card && event.target.matches('.editable-field')) {
                StateManager.markSongChanged(Number(card.dataset.songId));
            }
        });

        document.addEventListener('keydown', (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                // Second Ctrl+S while reviewing confirms the save
                const reviewOpen = document.getElementById('saveAllModal')?.style.display === 'block';
                if (reviewOpen) {
                    GlobalSave.confirmSaveAll();
                } else {
                    GlobalSave.reviewAll();
                }
            }
        });

        window.addEventListener('beforeunload', (event) => {
            if (GlobalSave.getPendingUpdates().length > 0) {
                event.preventDefault();
                event.returnValue = '';
            }
        });
    }

    // Recomputes real changes for every dirty song, dropping any whose edits were undone by hand.
    static getPendingUpdates() {
        const updates = [];
        for (const songId of [...state.dirtySongs]) {
            const card = document.querySelector(`[data-song-id="${songId}"]`);
            if (!card || !state.originalData[songId]) {
                state.dirtySongs.delete(songId);
                continue;
            }
            const changes = SongEditor.detectChanges(songId);
            if (Object.keys(changes).length > 0) {
                updates.push({ songId, changes });
            }
        }
        return updates;
    }

    static update() {
        const bar = document.getElementById('globalSaveBar');
        if (!bar) return;

        const count = GlobalSave.getPendingUpdates().length;
        bar.hidden = count === 0;
        document.body.classList.toggle('has-global-save-bar', count > 0);
        document.getElementById('globalSaveCount').textContent =
            `${count} song${count === 1 ? '' : 's'} with unsaved changes`;
    }

    static reviewAll() {
        const updates = GlobalSave.getPendingUpdates();
        if (updates.length === 0) {
            UIComponents.showMessage('No unsaved changes', 'info');
            return;
        }

        document.getElementById('saveAllTitle').textContent =
            `Save changes to ${updates.length} song${updates.length === 1 ? '' : 's'}`;

        document.getElementById('saveAllList').innerHTML = updates.map(({ songId, changes }) => {
            const original = state.originalData[songId];
            return `
                <div class="save-all-song">
                    <div class="save-all-song-title">${UIComponents.escapeHtml(original.title)} <span class="save-all-song-id">#${songId}</span></div>
                    ${Object.entries(changes).map(([field, value]) => `
                        <div class="save-all-change">
                            <span class="save-all-field">${FIELD_LABELS[field] || field}</span>
                            <span class="save-all-old">${UIComponents.escapeHtml(formatValue(original[field]))}</span>
                            <span class="save-all-arrow">→</span>
                            <span class="save-all-new">${UIComponents.escapeHtml(formatValue(value))}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        }).join('');

        ModalManager.show('saveAllModal');
    }

    static closeReview() {
        ModalManager.hide('saveAllModal');
    }

    static async confirmSaveAll() {
        const updates = GlobalSave.getPendingUpdates();
        if (updates.length === 0) {
            ModalManager.hide('saveAllModal');
            return;
        }

        const confirmButton = document.getElementById('saveAllConfirm');
        confirmButton.disabled = true;
        UIComponents.showLoading();

        try {
            await APIClient.post('/api/songs/batch-update', { updates });

            updates.forEach(({ songId, changes }) => {
                state.originalData[songId] = { ...state.originalData[songId], ...changes };
                StateManager.refreshSongCard(songId);
            });

            ModalManager.hide('saveAllModal');
            UIComponents.showMessage(`Saved changes to ${updates.length} song${updates.length === 1 ? '' : 's'}`, 'success');
            await refreshCountsAndStats();
        } catch (error) {
            console.error('Save all error:', error);
            UIComponents.showMessage(`Save failed: ${error.message}`, 'error');
        } finally {
            confirmButton.disabled = false;
            UIComponents.hideLoading();
        }
    }

    static discardAll() {
        const count = GlobalSave.getPendingUpdates().length;
        if (count === 0) return;
        if (!confirm(`Discard unsaved changes to ${count} song${count === 1 ? '' : 's'}?`)) return;

        [...state.dirtySongs].forEach(songId => SongEditor.revertSong(songId));
        GlobalSave.update();
    }

    // Returns true when it's OK to replace the current results (nothing unsaved, or user agreed).
    static confirmDiscard(action) {
        const count = GlobalSave.getPendingUpdates().length;
        if (count === 0) return true;
        return confirm(`You have unsaved changes to ${count} song${count === 1 ? '' : 's'}. ${action} and discard them?`);
    }
}
