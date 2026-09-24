import { APIClient } from './api.js';
import { UIComponents } from './ui.js';
import { BulkActionManager } from './bulk-actions.js';
import { state, clearDirtySongs } from './state.js';
import { GlobalSave } from './global-save.js';

export class SearchManager {
    static async searchSongs() {
        const query = document.getElementById('searchInput').value;
        if (!query.trim()) {
            UIComponents.showMessage('Please enter a search term', 'info');
            return;
        }
        if (!GlobalSave.confirmDiscard('Run a new search')) return;
        
        state.lastSearchQuery = query;
        UIComponents.showLoading();
        
        try {
            const songs = await APIClient.get(`/api/songs/search?q=${encodeURIComponent(query)}`);
            SearchManager.showTabByName('search');
            SearchManager.displaySongs(songs);
        } catch (error) {
            console.error('Search error:', error);
            UIComponents.showMessage('Failed to search songs', 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }

    static showTabByName(tabName) {
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        document.querySelectorAll('.tab-button').forEach(button => {
            button.classList.remove('active');
        });
        
        document.getElementById(tabName + 'Tab').classList.add('active');
        document.querySelector(`[onclick="showTab('${tabName}')"]`).classList.add('active');
    }

    static displaySongs(songs) {
        const container = document.getElementById('songsContainer');
        let emptyState = document.getElementById('emptyState');
        
        if (songs.length === 0) {
            container.innerHTML = '<div class="empty-state" id="emptyState"><p>No songs found</p></div>';
            return;
        }
        
        if (emptyState) {
            emptyState.style.display = 'none';
        }
        
        container.innerHTML = UIComponents.createBulkEditHeader() + songs.map(song => UIComponents.createSongCard(song)).join('');
        clearDirtySongs();
        
        songs.forEach(song => {
            state.originalData[song.id] = { ...song };
        });
        
        if (state.bulkEditMode) {
            BulkActionManager.addSongCheckboxes();
        }
    }

    static clearResults() {
        if (!GlobalSave.confirmDiscard('Clear results')) return;
        const container = document.getElementById('songsContainer');
        
        container.innerHTML = '<div class="empty-state" id="emptyState"><p>Use the search bar above to find songs to edit</p></div>';
        
        document.getElementById('searchInput').value = '';
        state.lastSearchQuery = '';
        state.originalData = {};
        clearDirtySongs();
        state.selectedSongs.clear();
        BulkActionManager.updateBulkEditControls();
    }

    static async refreshSearch() {
        if (state.lastSearchQuery) {
            document.getElementById('searchInput').value = state.lastSearchQuery;
            await SearchManager.searchSongs();
        }
    }

    static async editSongFromIssue(songId, retryCount = 0) {
        if (retryCount === 0 && !GlobalSave.confirmDiscard('Open this song')) return;
        UIComponents.showLoading();
        
        try {
            await new Promise(resolve => setTimeout(resolve, retryCount * 500));
            
            const song = await APIClient.get(`/api/songs/${songId}`);
            
            SearchManager.showTabByName('search');
            SearchManager.displaySongs([song]);
            
            setTimeout(() => {
                const songCard = document.querySelector(`[data-song-id="${songId}"]`);
                if (songCard) {
                    songCard.scrollIntoView({ behavior: 'smooth' });
                    songCard.style.border = '2px solid #007bff';
                    setTimeout(() => {
                        songCard.style.border = '';
                    }, 3000);
                }
            }, 100);
            
        } catch (error) {
            console.error('Failed to load song:', error);
            if (retryCount < 3) {
                UIComponents.showMessage(`Retrying... (attempt ${retryCount + 1})`, 'info');
                UIComponents.hideLoading();
                return SearchManager.editSongFromIssue(songId, retryCount + 1);
            }
            UIComponents.showMessage(`Failed to load song for editing after ${retryCount + 1} attempts: ${error.message}`, 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }
}
