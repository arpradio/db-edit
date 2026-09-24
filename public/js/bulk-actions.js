import { APIClient } from './api.js';
import { UIComponents } from './ui.js';
import { ModalManager } from './modals.js';
import { QualityManager } from './quality.js';
import { StateManager } from './state.js';
import { state, refreshCountsAndStats, refreshCurrentIssues } from './state.js';

export class BulkActionManager {
    static toggleBulkEditMode() {
        state.bulkEditMode = !state.bulkEditMode;
        const button = document.getElementById('bulkEditToggle');
        const selectAllContainer = document.getElementById('bulkSelectAllContainer');

        if (state.bulkEditMode) {
            button.textContent = 'Exit Bulk Edit';
            button.className = 'btn btn-secondary';
            state.selectedSongs.clear();
            if (selectAllContainer) selectAllContainer.style.display = 'block';
            const selectAllCheckbox = document.getElementById('bulkSelectAllSongs');
            if (selectAllCheckbox) selectAllCheckbox.checked = false;
            BulkActionManager.updateBulkEditControls();
            BulkActionManager.addSongCheckboxes();
        } else {
            button.textContent = 'Bulk Edit Mode';
            button.className = 'btn btn-primary';
            state.selectedSongs.clear();
            if (selectAllContainer) selectAllContainer.style.display = 'none';
            BulkActionManager.updateBulkEditControls();
            BulkActionManager.removeSongCheckboxes();
        }
    }

    static toggleSelectAllSongs() {
        const selectAllCheckbox = document.getElementById('bulkSelectAllSongs');
        const checkboxes = document.querySelectorAll('.song-checkbox');

        checkboxes.forEach(checkbox => {
            checkbox.checked = selectAllCheckbox.checked;
            BulkActionManager.toggleSongSelection(checkbox.dataset.songId);
        });
    }

    static addSongCheckboxes() {
        document.querySelectorAll('.song-card').forEach(card => {
            const songId = card.dataset.songId;
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'song-checkbox';
            checkbox.dataset.songId = songId;
            checkbox.onchange = () => BulkActionManager.toggleSongSelection(songId);
            
            const checkboxContainer = document.createElement('div');
            checkboxContainer.className = 'song-checkbox-container';
            checkboxContainer.appendChild(checkbox);
            
            card.insertBefore(checkboxContainer, card.firstChild);
        });
    }

    static removeSongCheckboxes() {
        document.querySelectorAll('.song-checkbox-container').forEach(container => {
            container.remove();
        });
    }

    static toggleSongSelection(songId) {
        const checkbox = document.querySelector(`input[data-song-id="${songId}"]`);
        const card = document.querySelector(`[data-song-id="${songId}"]`);
        
        if (checkbox.checked) {
            state.selectedSongs.add(parseInt(songId));
            card.classList.add('selected');
        } else {
            state.selectedSongs.delete(parseInt(songId));
            card.classList.remove('selected');
        }
        
        BulkActionManager.updateBulkEditControls();
    }

    static updateBulkEditControls() {
        const controls = document.getElementById('bulkEditControls');
        if (controls) {
            if (state.bulkEditMode && state.selectedSongs.size > 0) {
                controls.style.display = 'block';
                document.getElementById('selectedCount').textContent = state.selectedSongs.size;
            } else {
                controls.style.display = 'none';
            }
        }
    }

    static toggleItemSelection(itemId) {
        const checkbox = document.querySelector(`input[data-item-id="${itemId}"]`);
        const issueItem = document.querySelector(`div[data-item-id="${itemId}"]`);
        
        if (checkbox.checked) {
            state.selectedItems.add(itemId);
            issueItem.classList.add('selected');
        } else {
            state.selectedItems.delete(itemId);
            issueItem.classList.remove('selected');
        }
        
        BulkActionManager.updateSelectionInfo();
        BulkActionManager.updateSelectAllCheckbox();
        BulkActionManager.updateBulkActionsVisibility();
    }

    static toggleSelectAll() {
        const selectAllCheckbox = document.getElementById('selectAllCheckbox');
        const allCheckboxes = document.querySelectorAll('.issue-checkbox[data-item-id]');
        
        state.selectedItems.clear();
        
        allCheckboxes.forEach(checkbox => {
            checkbox.checked = selectAllCheckbox.checked;
            const itemId = parseInt(checkbox.dataset.itemId);
            const issueItem = document.querySelector(`div[data-item-id="${itemId}"]`);
            
            if (selectAllCheckbox.checked) {
                state.selectedItems.add(itemId);
                issueItem.classList.add('selected');
            } else {
                issueItem.classList.remove('selected');
            }
        });
        
        BulkActionManager.updateSelectionInfo();
        BulkActionManager.updateBulkActionsVisibility();
    }

    static updateSelectionInfo() {
        const selectionInfo = document.getElementById('selectionInfo');
        if (selectionInfo) {
            selectionInfo.textContent = `${state.selectedItems.size} items selected`;
        }
    }

    static updateSelectAllCheckbox() {
        const selectAllCheckbox = document.getElementById('selectAllCheckbox');
        const allCheckboxes = document.querySelectorAll('.issue-checkbox[data-item-id]');
        
        if (selectAllCheckbox && allCheckboxes.length > 0) {
            const checkedCount = Array.from(allCheckboxes).filter(cb => cb.checked).length;
            selectAllCheckbox.checked = checkedCount === allCheckboxes.length;
            selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < allCheckboxes.length;
        }
    }

    static updateBulkActionsVisibility() {
        const bulkActions = document.getElementById('bulkActions');
        if (bulkActions) {
            bulkActions.classList.toggle('visible', state.selectedItems.size > 0);
        }
    }

    static async bulkDeleteSelected() {
        if (state.selectedItems.size === 0) {
            UIComponents.showMessage('No items selected', 'info');
            return;
        }

        const entityType = QualityManager.getEntityTypeLabel(state.currentIssueType);
        const selectedIds = Array.from(state.selectedItems);
        
        const selectedNames = selectedIds.map(id => {
            const issueItem = document.querySelector(`div[data-item-id="${id}"] .issue-title`);
            return issueItem ? issueItem.textContent : `ID: ${id}`;
        });
        
        ModalManager.showBulkModal(
            `Delete ${state.selectedItems.size} selected ${entityType}?`,
            selectedNames,
            () => BulkActionManager.executeBulkDelete(state.currentIssueType, selectedIds)
        );
    }

    static async bulkDeleteAll(issueType) {
        const entityType = QualityManager.getEntityTypeLabel(issueType);
        const allItems = document.querySelectorAll('.issue-item[data-item-id]');
        const allIds = Array.from(allItems).map(item => parseInt(item.dataset.itemId));
        const allNames = Array.from(allItems).map(item => item.querySelector('.issue-title').textContent);
        
        ModalManager.showBulkModal(
            `Delete ALL ${allIds.length} ${entityType}?`,
            allNames,
            () => BulkActionManager.executeBulkDelete(issueType, allIds)
        );
    }

    static async executeBulkDelete(issueType, ids) {
        UIComponents.showLoading();
        ModalManager.hide('bulkModal');

        try {
            if (QualityManager.isSongIssueType(issueType)) {
                await APIClient.deleteWithBody('/api/songs/bulk-delete', { ids });
            } else {
                const endpointMap = {
                    'orphan-artists': 'artists',
                    'orphan-genres': 'genres',
                    'orphan-contributors': 'contributors',
                    'orphan-tokens': 'tokens',
                    'orphan-images': 'images'
                };

                const endpoint = endpointMap[issueType] || 'items';
                await APIClient.deleteWithBody(`/api/${endpoint}/bulk-delete`, { ids });
            }

            UIComponents.showMessage(`Successfully deleted ${ids.length} items`, 'success');
            state.selectedItems.clear();
            await refreshCurrentIssues();
            await refreshCountsAndStats();
        } catch (error) {
            console.error('Bulk delete error:', error);
            UIComponents.showMessage(`Failed to delete items: ${error.message}`, 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }

    static openBulkEditModal() {
        if (state.selectedSongs.size === 0) {
            UIComponents.showMessage('No songs selected', 'info');
            return;
        }

        document.getElementById('bulkTitle').value = '';
        document.getElementById('bulkDuration').value = '';
        document.getElementById('bulkStatus').value = '';
        document.getElementById('bulkIsrc').value = '';
        document.getElementById('bulkIswc').value = '';
        document.getElementById('bulkArtists').value = '';
        document.getElementById('bulkGenres').value = '';
        document.getElementById('bulkIsExplicit').value = '';
        document.getElementById('bulkIsAiGenerated').value = '';

        ModalManager.show('bulkEditModal');
    }

    static async applyBulkChanges() {
        const title = document.getElementById('bulkTitle').value.trim();
        const duration = document.getElementById('bulkDuration').value.trim();
        const status = document.getElementById('bulkStatus').value;
        const isrc = document.getElementById('bulkIsrc').value.trim();
        const iswc = document.getElementById('bulkIswc').value.trim();
        const artistsText = document.getElementById('bulkArtists').value.trim();
        const genresText = document.getElementById('bulkGenres').value.trim();
        const isExplicit = document.getElementById('bulkIsExplicit').value;
        const isAiGenerated = document.getElementById('bulkIsAiGenerated').value;

        const changes = {};
        if (title) changes.title = title;
        if (duration) changes.duration = duration;
        if (status) changes.validation_status = status;
        if (isrc) changes.isrc = isrc;
        if (iswc) changes.iswc = iswc;
        if (artistsText) changes.artists = artistsText.split(',').map(a => a.trim()).filter(a => a);
        if (genresText) changes.genres = genresText.split(',').map(g => g.trim()).filter(g => g);
        if (isExplicit) changes.is_explicit = isExplicit === 'true';
        if (isAiGenerated) changes.is_ai_generated = isAiGenerated === 'true';
        
        if (Object.keys(changes).length === 0) {
            UIComponents.showMessage('No changes specified', 'info');
            return;
        }
        
        UIComponents.showLoading();
        ModalManager.hide('bulkEditModal');
        
        try {
            await APIClient.post('/api/songs/bulk-update', {
                songs: Array.from(state.selectedSongs),
                changes: changes
            });
            
            UIComponents.showMessage(`Successfully updated ${state.selectedSongs.size} songs`, 'success');
            
            state.selectedSongs.forEach(songId => {
                if (state.originalData[songId]) {
                    state.originalData[songId] = { ...state.originalData[songId], ...changes };
                    StateManager.refreshSongCard(songId);
                }
            });
            
            BulkActionManager.toggleBulkEditMode();

            await refreshCountsAndStats();

        } catch (error) {
            console.error('Bulk update error:', error);
            UIComponents.showMessage(`Failed to update songs: ${error.message}`, 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }

    static async bulkDeleteSongs() {
        if (state.selectedSongs.size === 0) {
            UIComponents.showMessage('No songs selected', 'info');
            return;
        }
        
        const selectedIds = Array.from(state.selectedSongs);
        const selectedTitles = selectedIds.map(id => {
            const song = state.originalData[id];
            return song ? song.title : `ID: ${id}`;
        });
        
        ModalManager.showBulkModal(
            `Delete ${state.selectedSongs.size} selected songs?`,
            selectedTitles,
            () => BulkActionManager.executeBulkSongDelete(selectedIds)
        );
    }

    static async executeBulkSongDelete(ids) {
        UIComponents.showLoading();
        ModalManager.hide('bulkModal');
        
        try {
            await APIClient.deleteWithBody('/api/songs/bulk-delete', { ids });
            
            UIComponents.showMessage(`Successfully deleted ${ids.length} songs`, 'success');
            
            ids.forEach(id => {
                const songCard = document.querySelector(`[data-song-id="${id}"]`);
                if (songCard) songCard.remove();
                delete state.originalData[id];
                state.selectedSongs.delete(id);
            });
            
            BulkActionManager.updateBulkEditControls();
            
            const remainingSongs = document.querySelectorAll('.song-card').length;
            if (remainingSongs === 0) {
                const container = document.getElementById('songsContainer');
                container.innerHTML = '<div class="empty-state" id="emptyState"><p>Use the search bar above to find songs to edit</p></div>';
            }
            
            if (state.bulkEditMode) {
                BulkActionManager.toggleBulkEditMode();
            }

            await refreshCountsAndStats();

        } catch (error) {
            console.error('Bulk delete error:', error);
            UIComponents.showMessage(`Failed to delete songs: ${error.message}`, 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }
}
