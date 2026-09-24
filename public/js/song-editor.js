import { APIClient } from './api.js';
import { UIComponents } from './ui.js';
import { ModalManager } from './modals.js';
import { StateManager } from './state.js';
import { BulkActionManager } from './bulk-actions.js';
import { state, refreshCountsAndStats } from './state.js';

export class SongEditor {
    static removeTag(element, songId) {
        element.parentElement.remove();
        StateManager.markSongChanged(songId);
    }

    static addTag(event, containerId, songId) {
        if (event.key === 'Enter' && event.target.value.trim()) {
            const container = document.getElementById(containerId);
            const input = event.target;
            
            const tag = document.createElement('div');
            tag.className = 'tag';
            tag.innerHTML = `
                ${UIComponents.escapeHtml(input.value.trim())}
                <span class="tag-remove" onclick="SongEditor.removeTag(this, ${songId})">×</span>
            `;
            
            container.insertBefore(tag, input);
            input.value = '';
            StateManager.markSongChanged(songId);
        }
    }

    static saveSong(songId) {
        const changes = SongEditor.detectChanges(songId);
        if (Object.keys(changes).length === 0) {
            UIComponents.showMessage('No changes detected', 'info');
            return;
        }
        
        state.currentChanges = { songId, changes };
        ModalManager.showSaveModal(changes);
    }
    

    static detectChanges(songId) {
        const changes = {};
        const card = document.querySelector(`[data-song-id="${songId}"]`);
        
        const titleInput = card.querySelector('[data-field="title"]');
        if (titleInput && titleInput.value !== state.originalData[songId].title) {
            changes.title = titleInput.value;
        }
        
        const durationInput = card.querySelector('[data-field="duration"]');
        if (durationInput && durationInput.value !== (state.originalData[songId].duration || '')) {
            changes.duration = durationInput.value;
        }
        
        const isrcInput = card.querySelector('[data-field="isrc"]');
        if (isrcInput && isrcInput.value !== (state.originalData[songId].isrc || '')) {
            changes.isrc = isrcInput.value;
        }
        
        const iswcInput = card.querySelector('[data-field="iswc"]');
        if (iswcInput && iswcInput.value !== (state.originalData[songId].iswc || '')) {
            changes.iswc = iswcInput.value;
        }
        
        const statusSelect = card.querySelector('[data-field="validation_status"]');
        if (statusSelect && statusSelect.value !== state.originalData[songId].validation_status) {
            changes.validation_status = statusSelect.value;
        }

        const isExplicitCheckbox = card.querySelector('[data-field="is_explicit"]');
        if (isExplicitCheckbox && isExplicitCheckbox.checked !== (state.originalData[songId].is_explicit || false)) {
            changes.is_explicit = isExplicitCheckbox.checked;
        }

        const isAiGeneratedCheckbox = card.querySelector('[data-field="is_ai_generated"]');
        if (isAiGeneratedCheckbox && isAiGeneratedCheckbox.checked !== (state.originalData[songId].is_ai_generated || false)) {
            changes.is_ai_generated = isAiGeneratedCheckbox.checked;
        }

        const artistsContainer = document.getElementById(`artists-${songId}`);
        const currentArtists = Array.from(artistsContainer.querySelectorAll('.tag'))
            .map(tag => tag.textContent.replace('×', '').trim());
        const originalArtists = (state.originalData[songId].artists || []).map(artist => 
            typeof artist === 'object' ? artist.name : artist
        );
        
        if (JSON.stringify(currentArtists.sort()) !== JSON.stringify(originalArtists.sort())) {
            changes.artists = currentArtists;
        }
        
        const genresContainer = document.getElementById(`genres-${songId}`);
        const currentGenres = Array.from(genresContainer.querySelectorAll('.tag'))
            .map(tag => tag.textContent.replace('×', '').trim());
        const originalGenres = state.originalData[songId].genres || [];
        
        if (JSON.stringify(currentGenres.sort()) !== JSON.stringify(originalGenres.sort())) {
            changes.genres = currentGenres;
        }
        
        return changes;
    }

    static async confirmSave() {
        const { songId, changes } = state.currentChanges;
        
        UIComponents.showLoading();
        
        try {
            await APIClient.post(`/api/songs/${songId}/update`, changes);
            
            UIComponents.showMessage('Changes saved successfully!', 'success');
            
            state.originalData[songId] = { ...state.originalData[songId], ...changes };
            StateManager.refreshSongCard(songId);
            
            ModalManager.hide('saveModal');

            await refreshCountsAndStats();

        } catch (error) {
            console.error('Save error:', error);
            UIComponents.showMessage('Error saving changes: ' + error.message, 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }

    static revertSong(songId) {
        const original = state.originalData[songId];
        if (!original) return;
        
        StateManager.refreshSongCard(songId);
    }

    static async deleteSong(songId) {
        const song = state.originalData[songId];
        if (!song) {
            UIComponents.showMessage('Song data not found', 'error');
            return;
        }
        
        ModalManager.showDeleteConfirmModal(
            `Are you sure you want to delete "${song.title}"? This action cannot be undone and will remove all associated data.`,
            () => SongEditor.executeSingleDelete(songId)
        );
    }

    static async executeSingleDelete(songId) {
        const song = state.originalData[songId];
        ModalManager.hide('deleteConfirmModal');
        UIComponents.showLoading();
        
        try {
            await APIClient.delete(`/api/songs/${songId}`);
            
            UIComponents.showMessage(`Successfully deleted "${song.title}"`, 'success');
            
            const songCard = document.querySelector(`[data-song-id="${songId}"]`);
            if (songCard) songCard.remove();
            
            delete state.originalData[songId];
            state.selectedSongs.delete(songId);
            BulkActionManager.updateBulkEditControls();
            
            const remainingSongs = document.querySelectorAll('.song-card').length;
            if (remainingSongs === 0) {
                const container = document.getElementById('songsContainer');
                container.innerHTML = '<div class="empty-state" id="emptyState"><p>Use the search bar above to find songs to edit</p></div>';
            }

            await refreshCountsAndStats();

        } catch (error) {
            console.error('Delete error:', error);
            UIComponents.showMessage(`Failed to delete song: ${error.message}`, 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }
}
