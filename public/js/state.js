import { UIComponents } from './ui.js';
import { QualityManager } from './quality.js';
import { StatsManager } from './stats.js';

export const state = {
    originalData: {},
    currentChanges: {},
    lastSearchQuery: '',
    selectedSongs: new Set(),
    bulkEditMode: false,
    selectedItems: new Set(),
    currentIssueType: '',
    selectedSongsForLink: new Set(),
    selectedSongsForFix: new Set(),
    searchTimeout: null
};

// Runs a set of zero-arg refresh callbacks without letting a refresh failure
// masquerade as a failure of the action that triggered it.
export async function safeRefresh(tasks) {
    try {
        await Promise.all(tasks.map(fn => fn()));
    } catch (error) {
        console.error('Post-action refresh failed:', error);
    }
}

// Data quality counts and overall stats can change after almost any edit
// (songs/artists/genres/contributors created, linked, or removed), so this
// is the standard refresh to run after a successful mutation.
export function refreshCountsAndStats() {
    return safeRefresh([QualityManager.loadQualityCounts, StatsManager.loadStats]);
}

// Re-fetches the currently open data-quality issue list, if one is open.
export function refreshCurrentIssues() {
    if (!state.currentIssueType) return Promise.resolve();
    return safeRefresh([() => QualityManager.loadDataIssues(state.currentIssueType)]);
}
export class StateManager {
    static refreshSongCard(songId) {
        const card = document.querySelector(`[data-song-id="${songId}"]`);
        const song = state.originalData[songId];
        if (!card || !song) return;

        const titleElement = card.querySelector('.song-title');
        if (titleElement) titleElement.textContent = song.title;

        const titleInput = card.querySelector('[data-field="title"]');
        if (titleInput) titleInput.value = song.title;

        const durationInput = card.querySelector('[data-field="duration"]');
        if (durationInput) durationInput.value = song.duration || '';

        const isrcInput = card.querySelector('[data-field="isrc"]');
        if (isrcInput) isrcInput.value = song.isrc || '';

        const iswcInput = card.querySelector('[data-field="iswc"]');
        if (iswcInput) iswcInput.value = song.iswc || '';

        const statusSelect = card.querySelector('[data-field="validation_status"]');
        if (statusSelect) statusSelect.value = song.validation_status;

        const statusIndicator = card.querySelector('.status-indicator');
        if (statusIndicator) {
            statusIndicator.className = `status-indicator status-${song.validation_status}`;
        }

        const artistsContainer = document.getElementById(`artists-${songId}`);
        if (artistsContainer) {
            StateManager.rebuildTagContainer(artistsContainer, song.artists || [], songId, 'artist');
        }

        const genresContainer = document.getElementById(`genres-${songId}`);
        if (genresContainer) {
            StateManager.rebuildTagContainer(genresContainer, song.genres || [], songId, 'genre');
        }

        StateManager.resetSaveButton(songId);
        card.classList.remove('changed');
    }

    static rebuildTagContainer(container, items, songId, type) {
        const placeholder = type === 'artist' ? 'Add artist...' : 'Add genre...';
        const containerId = type === 'artist' ? `artists-${songId}` : `genres-${songId}`;
        
        const processedItems = type === 'artist' ? 
            items.map(item => typeof item === 'object' ? item.name : item) :
            items;
        
        container.innerHTML = `
            ${processedItems.map(item => `
                <div class="tag">
                    ${UIComponents.escapeHtml(item)}
                    <span class="tag-remove" onclick="SongEditor.removeTag(this, ${songId})">×</span>
                </div>
            `).join('')}
            <input type="text" class="add-tag-input" placeholder="${placeholder}" 
                   onkeypress="SongEditor.addTag(event, '${containerId}', ${songId})">
        `;
    }

    static resetSaveButton(songId) {
        const saveButton = document.getElementById(`save-${songId}`);
        if (saveButton) {
            saveButton.disabled = true;
            saveButton.className = 'btn btn-primary';
            saveButton.textContent = 'Save Changes';
        }
    }

    static markSongChanged(songId) {
        const card = document.querySelector(`[data-song-id="${songId}"]`);
        const saveButton = document.getElementById(`save-${songId}`);
        
        if (card) card.classList.add('changed');
        if (saveButton) {
            saveButton.disabled = false;
            saveButton.className = 'btn btn-success';
            saveButton.textContent = 'Save Changes*';
        }
    }
}
