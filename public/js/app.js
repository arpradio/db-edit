let originalData = {};
let currentChanges = {};
let lastSearchQuery = '';
let selectedSongs = new Set();
let bulkEditMode = false;
let selectedItems = new Set();
let currentIssueType = '';
let selectedSongsForLink = new Set();
let selectedSongsForFix = new Set();
let searchTimeout;

class APIClient {
    static async get(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    }

    static async post(url, data) {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    }

    static async put(url, data) {
        const response = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    }

    static async delete(url) {
        const response = await fetch(url, { method: 'DELETE' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    }

    static async deleteWithBody(url, data) {
        const response = await fetch(url, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    }
}

class UIComponents {
    static showLoading() {
        document.getElementById('loadingSpinner').style.display = 'block';
    }

    static hideLoading() {
        document.getElementById('loadingSpinner').style.display = 'none';
    }

    static showMessage(message, type) {
        const existingMessage = document.querySelector('.success-message, .error-message');
        if (existingMessage) existingMessage.remove();
        
        const messageDiv = document.createElement('div');
        messageDiv.className = type === 'error' ? 'error-message' : 'success-message';
        messageDiv.textContent = message;
        
        const firstContainer = document.querySelector('.container');
        firstContainer.parentNode.insertBefore(messageDiv, firstContainer.nextSibling);
        
        setTimeout(() => messageDiv.remove(), 5000);
    }

    static escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    static createModal(id, title, content, actions) {
        const modal = document.createElement('div');
        modal.id = id;
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>${title}</h3>
                ${content}
                <div class="modal-actions">${actions}</div>
            </div>
        `;
        document.body.appendChild(modal);
        return modal;
    }

    static createBulkEditHeader() {
        return `
            <div class="bulk-edit-header">
                <button class="btn btn-primary" id="bulkEditToggle" onclick="BulkActionManager.toggleBulkEditMode()">Bulk Edit Mode</button>
                <div id="bulkEditControls" style="display: none;">
                    <span id="selectedCount">0</span> songs selected
                    <button class="btn btn-primary" onclick="BulkActionManager.openBulkEditModal()">Edit Selected</button>
                    <button class="btn btn-danger" onclick="BulkActionManager.bulkDeleteSongs()">Delete Selected</button>
                </div>
            </div>
        `;
    }

    static createSongCard(song) {
        const artists = song.artists || [];
        const genres = song.genres || [];
        const audioFiles = song.audio_files || [];
        const tokens = song.tokens || [];
        
        const processedArtists = artists.map(artist => 
            typeof artist === 'object' ? artist.name : artist
        );
        
        return `
            <div class="song-card" data-song-id="${song.id}">
                <div class="song-header">
                    <div class="song-title">${UIComponents.escapeHtml(song.title)}</div>
                    <div class="song-id">ID: ${song.id}</div>
                </div>
                
                <div class="metadata-row">
                    <span class="metadata-label">Title:</span>
                    <div class="metadata-value">
                        <input type="text" class="editable-field" value="${UIComponents.escapeHtml(song.title)}" 
                               onchange="StateManager.markSongChanged(${song.id})" data-field="title">
                    </div>
                </div>
                
                <div class="metadata-row">
                    <span class="metadata-label">Artists:</span>
                    <div class="metadata-value">
                        <div class="tag-container" id="artists-${song.id}" onchange="StateManager.markSongChanged(${song.id})">
                            ${processedArtists.map(artist => `
                                <div class="tag">
                                    ${UIComponents.escapeHtml(artist)}
                                    <span class="tag-remove" onclick="SongEditor.removeTag(this, ${song.id})">×</span>
                                </div>
                            `).join('')}
                            <input type="text" class="add-tag-input" placeholder="Add artist..." 
                                   onkeypress="SongEditor.addTag(event, 'artists-${song.id}', ${song.id})">
                        </div>
                    </div>
                </div>
                
                <div class="metadata-row">
                    <span class="metadata-label">Genres:</span>
                    <div class="metadata-value">
                        <div class="tag-container" id="genres-${song.id}" onchange="StateManager.markSongChanged(${song.id})">
                            ${genres.map(genre => `
                                <div class="tag">
                                    ${UIComponents.escapeHtml(genre)}
                                    <span class="tag-remove" onclick="SongEditor.removeTag(this, ${song.id})">×</span>
                                </div>
                            `).join('')}
                            <input type="text" class="add-tag-input" placeholder="Add genre..." 
                                   onkeypress="SongEditor.addTag(event, 'genres-${song.id}', ${song.id})">
                        </div>
                    </div>
                </div>
                
                <div class="two-column">
                    <div class="metadata-row">
                        <span class="metadata-label">Duration:</span>
                        <div class="metadata-value">
                            <input type="text" class="editable-field" value="${song.duration || ''}" 
                                   onchange="StateManager.markSongChanged(${song.id})" data-field="duration">
                        </div>
                    </div>
                    
                    <div class="metadata-row">
                        <span class="metadata-label">Status:</span>
                        <div class="metadata-value">
                            <span class="status-indicator status-${song.validation_status}"></span>
                            <select class="editable-field" onchange="StateManager.markSongChanged(${song.id})" data-field="validation_status">
                                <option value="unverified" ${song.validation_status === 'unverified' ? 'selected' : ''}>Unverified</option>
                                <option value="verified" ${song.validation_status === 'verified' ? 'selected' : ''}>Verified</option>
                                <option value="pending" ${song.validation_status === 'pending' ? 'selected' : ''}>Pending</option>
                            </select>
                        </div>
                    </div>
                </div>
                
                <div class="two-column">
                    <div class="metadata-row">
                        <span class="metadata-label">ISRC:</span>
                        <div class="metadata-value">
                            <input type="text" class="editable-field id-field" value="${song.isrc || ''}" 
                                   onchange="StateManager.markSongChanged(${song.id})" data-field="isrc" maxlength="12" placeholder="ISRC code">
                        </div>
                    </div>
                    
                    <div class="metadata-row">
                        <span class="metadata-label">ISWC:</span>
                        <div class="metadata-value">
                            <input type="text" class="editable-field id-field" value="${song.iswc || ''}" 
                                   onchange="StateManager.markSongChanged(${song.id})" data-field="iswc" maxlength="11" placeholder="ISWC code">
                        </div>
                    </div>
                </div>
                
                ${RelationshipManager.createRelationsSection(song, audioFiles, tokens)}
                
                <div class="actions">
                    <button class="btn btn-primary" onclick="SongEditor.saveSong(${song.id})" id="save-${song.id}" disabled>
                        Save Changes
                    </button>
                    <button class="btn btn-secondary" onclick="SongEditor.revertSong(${song.id})">
                        Revert
                    </button>
                    <button class="btn btn-danger" onclick="SongEditor.deleteSong(${song.id})">
                        Delete Song
                    </button>
                </div>
            </div>
        `;
    }
}

class StateManager {
    static refreshSongCard(songId) {
        const card = document.querySelector(`[data-song-id="${songId}"]`);
        const song = originalData[songId];
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

class ModalManager {
    static show(modalId) {
        document.getElementById(modalId).style.display = 'block';
    }

    static hide(modalId) {
        document.getElementById(modalId).style.display = 'none';
    }

    static showBulkModal(actionText, itemNames, confirmCallback) {
        document.getElementById('bulkActionText').textContent = actionText;
        
        const itemsList = document.getElementById('bulkItemsList');
        itemsList.innerHTML = itemNames.map(name => 
            `<div class="bulk-item">${UIComponents.escapeHtml(name)}</div>`
        ).join('');
        
        document.getElementById('confirmBulkBtn').onclick = confirmCallback;
        ModalManager.show('bulkModal');
    }

    static showDeleteConfirmModal(text, confirmCallback) {
        document.getElementById('deleteConfirmText').textContent = text;
        document.getElementById('confirmDeleteBtn').onclick = confirmCallback;
        ModalManager.show('deleteConfirmModal');
    }

    static showSaveModal(changes) {
        const changesList = document.getElementById('changesList');
        changesList.innerHTML = '';
        
        const tableUpdates = [];
        
        if (changes.title || changes.duration || changes.validation_status || changes.isrc || changes.iswc) {
            tableUpdates.push('metadata.songs table (basic info)');
        }
        
        if (changes.artists) {
            tableUpdates.push(`metadata.song_artists table (${changes.artists.length} artists)`);
            tableUpdates.push('metadata.artists table (auto-create new artists)');
        }
        
        if (changes.genres) {
            tableUpdates.push(`metadata.song_genres table (${changes.genres.length} genres)`);
            tableUpdates.push('metadata.genres table (auto-create new genres)');
        }
        
        tableUpdates.forEach(update => {
            const li = document.createElement('li');
            li.textContent = update;
            changesList.appendChild(li);
        });
        
        ModalManager.show('saveModal');
    }

    static createLinkTokenModal() {
        if (document.getElementById('linkTokenModal')) return;
        
        const modal = UIComponents.createModal('linkTokenModal', 'Link Token to Songs', `
            <p>Link "<span id="linkTokenName"></span>" to songs</p>
            <input type="hidden" id="linkTokenId">
            
            <div class="search-section">
                <input type="text" id="songSearchInput" class="search-bar" placeholder="Search songs to link..." 
                       oninput="TokenManager.searchSongsForToken(this.value, document.getElementById('linkTokenId').value, 'songSearchResults')">
                <div id="songSearchResults" class="search-results-modal"></div>
            </div>
            
            <div id="selectedSongsList" class="selected-songs-list"></div>
        `, `
            <button class="btn btn-primary" onclick="TokenManager.linkTokenToSongs()">Link Selected Songs</button>
            <button class="btn btn-secondary" onclick="TokenManager.closeLinkTokenModal()">Cancel</button>
        `);
    }

    static createFixTokenModal() {
        if (document.getElementById('fixTokenModal')) return;
        
        const modal = UIComponents.createModal('fixTokenModal', 'Fix Token Relations', `
            <p>Fix relations for "<span id="fixTokenName"></span>"</p>
            <input type="hidden" id="fixTokenId">
            
            <div class="search-section">
                <input type="text" id="fixSongSearchInput" class="search-bar" placeholder="Search songs to link..." 
                       oninput="TokenManager.searchSongsForToken(this.value, document.getElementById('fixTokenId').value, 'fixSongSearchResults')">
                <div id="fixSongSearchResults" class="search-results-modal"></div>
            </div>
            
            <div id="fixSelectedSongsList" class="selected-songs-list"></div>
            
            <div class="checkbox-section">
                <label>
                    <input type="checkbox" id="markProcessedCheck" checked>
                    Mark token as processed
                </label>
            </div>
        `, `
            <button class="btn btn-success" onclick="TokenManager.fixTokenRelations()">Fix Relations</button>
            <button class="btn btn-secondary" onclick="TokenManager.closeFixTokenModal()">Cancel</button>
        `);
    }
}

class QualityManager {
    static async loadQualityCounts() {
        try {
            const counts = await APIClient.get('/api/quality/counts');
            
            const elements = {
                'noArtistsCount': counts.no_artists || 0,
                'noGenresCount': counts.no_genres || 0,
                'noAudioCount': counts.no_audio || 0,
                'noDurationCount': counts.no_duration || 0,
                'noIsrcCount': counts.no_isrc || 0,
                'noIswcCount': counts.no_iswc || 0,
                'noTokensCount': counts.no_tokens || 0,
                'noCopyrightCount': counts.no_copyright || 0,
                'noImagesCount': counts.no_images || 0,
                'orphanArtistsCount': counts.orphan_artists || 0,
                'orphanGenresCount': counts.orphan_genres || 0,
                'orphanContributorsCount': counts.orphan_contributors || 0,
                'orphanTokensCount': counts.orphan_tokens || 0,
                'orphanImagesCount': counts.orphan_images || 0,
                'unprocessedTokensCount': counts.unprocessed_tokens || 0,
                'failedTokensCount': counts.failed_tokens || 0,
                'artistsNoIsniCount': counts.artists_no_isni || 0
            };
            
            Object.entries(elements).forEach(([id, count]) => {
                const element = document.getElementById(id);
                if (element) {
                    element.textContent = count;
                    element.classList.toggle('zero', count === 0);
                }
            });
            
        } catch (error) {
            console.error('Failed to load quality counts:', error);
            UIComponents.showMessage('Failed to load data quality information', 'error');
        }
    }

    static async loadDataIssues(issueType) {
        currentIssueType = issueType;
        selectedItems.clear();
        UIComponents.showLoading();
        
        try {
            const issues = await APIClient.get(`/api/quality/issues/${issueType}`);
            QualityManager.displayIssues(issues, issueType);
        } catch (error) {
            console.error('Failed to load issues:', error);
            UIComponents.showMessage('Failed to load data issues', 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }

    static displayIssues(issues, issueType) {
        const container = document.getElementById('issuesContainer');
        
        if (issues.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No issues found! 🎉</p></div>';
            return;
        }
        
        const issueTitle = QualityManager.getIssueTitle(issueType);
        const showBulkActions = QualityManager.shouldShowBulkActions(issueType);
        
        container.innerHTML = `
            <h4>${issueTitle} (${issues.length} found)</h4>
            ${showBulkActions ? QualityManager.createBulkActionsHTML(issueType) : ''}
            <div class="issues-list">
                ${showBulkActions ? QualityManager.createSelectAllHTML() : ''}
                ${issues.map(issue => QualityManager.createIssueItem(issue, issueType)).join('')}
            </div>
        `;
        
        BulkActionManager.updateBulkActionsVisibility();
    }

    static shouldShowBulkActions(issueType) {
        return issueType.includes('orphan') || issueType.includes('unprocessed') || 
               issueType.includes('failed') || issueType.includes('artists-no-isni');
    }

    static createBulkActionsHTML(issueType) {
        const entityMap = {
            'orphan-artists': 'artists',
            'orphan-genres': 'genres', 
            'orphan-contributors': 'contributors',
            'orphan-tokens': 'tokens',
            'orphan-images': 'images'
        };
        
        const entityType = entityMap[issueType] || 'items';
        
        let bulkButtons = `
            <button class="btn btn-small btn-danger" onclick="BulkActionManager.bulkDeleteSelected()">Delete Selected</button>
            <button class="btn btn-small btn-danger" onclick="BulkActionManager.bulkDeleteAll('${issueType}')">Delete All ${entityType}</button>
        `;
        
        if (issueType === 'orphan-tokens') {
            bulkButtons = `<button class="btn btn-small btn-primary" onclick="TokenManager.bulkLinkTokens()">Bulk Link Selected</button>` + bulkButtons;
        }
        
        if (issueType === 'unprocessed-tokens') {
            bulkButtons += `<button class="btn btn-small btn-primary" onclick="TokenManager.bulkProcessTokens()">Process Selected</button>`;
        }
        
        if (issueType === 'failed-tokens') {
            bulkButtons = `<button class="btn btn-small btn-success" onclick="TokenManager.bulkFixTokens()">Fix Selected</button>` + bulkButtons;
        }
        
        if (issueType === 'artists-no-isni') {
            bulkButtons += `<button class="btn btn-small btn-primary" onclick="QualityManager.bulkEditIsni()">Add ISNI</button>`;
        }
        
        return `
            <div class="bulk-actions" id="bulkActions">
                <div class="bulk-actions-header">
                    <span class="selection-info" id="selectionInfo">0 items selected</span>
                    <div class="bulk-buttons">
                        ${bulkButtons}
                    </div>
                </div>
            </div>
        `;
    }

    static createSelectAllHTML() {
        return `
            <div class="select-all-container">
                <input type="checkbox" id="selectAllCheckbox" class="issue-checkbox" onchange="BulkActionManager.toggleSelectAll()">
                <label for="selectAllCheckbox">Select All</label>
            </div>
        `;
    }

    static createIssueItem(issue, issueType) {
        if (issueType.includes('songs') || issueType.includes('no-')) {
            return `
                <div class="issue-item" onclick="SearchManager.editSongFromIssue(${issue.id})">
                    <div class="issue-content">
                        <span class="issue-title">${UIComponents.escapeHtml(issue.title || issue.name)}</span>
                        <span class="issue-id">ID: ${issue.id}</span>
                    </div>
                    <div class="issue-actions">
                        <button class="btn btn-small btn-primary" onclick="event.stopPropagation(); SearchManager.editSongFromIssue(${issue.id})">Edit</button>
                    </div>
                </div>
            `;
        } else if (QualityManager.shouldShowBulkActions(issueType)) {
            let actionButtons = `<button class="btn btn-small btn-danger" onclick="QualityManager.deleteOrphan('${issueType}', ${issue.id}, '${UIComponents.escapeHtml(issue.name)}')">Delete</button>`;
            
            if (issueType === 'orphan-tokens') {
                actionButtons = `<button class="btn btn-small btn-primary" onclick="TokenManager.showLinkTokenModal(${issue.id}, '${UIComponents.escapeHtml(issue.name)}')">Link to Song</button>` + actionButtons;
            }
            
            if (issueType === 'unprocessed-tokens') {
                actionButtons += `<button class="btn btn-small btn-primary" onclick="TokenManager.processToken(${issue.id}, '${UIComponents.escapeHtml(issue.name)}')">Process</button>`;
            }
            
            if (issueType === 'failed-tokens') {
                actionButtons = `<button class="btn btn-small btn-success" onclick="TokenManager.showFixTokenModal(${issue.id}, '${UIComponents.escapeHtml(issue.name)}')">Fix Relations</button>` + actionButtons;
            }
            
            if (issueType === 'artists-no-isni') {
                actionButtons = `<button class="btn btn-small btn-primary" onclick="QualityManager.editArtistIsni(${issue.id}, '${UIComponents.escapeHtml(issue.name)}')">Add ISNI</button>` + actionButtons;
            }
            
            return `
                <div class="issue-item" data-item-id="${issue.id}">
                    <div class="issue-content">
                        <input type="checkbox" class="issue-checkbox" data-item-id="${issue.id}" onchange="BulkActionManager.toggleItemSelection(${issue.id})">
                        <span class="issue-title">${UIComponents.escapeHtml(issue.name)}</span>
                        <span class="issue-id">ID: ${issue.id}</span>
                        ${issue.policy_id ? `<span class="issue-meta">Policy: ${UIComponents.escapeHtml(issue.policy_id.substring(0, 8))}...</span>` : ''}
                        ${issue.image_type ? `<span class="issue-meta">Type: ${UIComponents.escapeHtml(issue.image_type)}</span>` : ''}
                    </div>
                    <div class="issue-actions">
                        ${actionButtons}
                    </div>
                </div>
            `;
        }
        
        return '';
    }

    static getIssueTitle(issueType) {
        const titles = {
            'no-artists': 'Songs Without Artists',
            'no-genres': 'Songs Without Genres', 
            'no-audio': 'Songs Without Audio Files',
            'no-duration': 'Songs Without Duration',
            'no-isrc': 'Songs Without ISRC',
            'no-iswc': 'Songs Without ISWC',
            'no-tokens': 'Songs Without Tokens',
            'no-copyright': 'Songs Without Copyright',
            'no-images': 'Songs Without Images',
            'orphan-artists': 'Artists With No Songs',
            'orphan-genres': 'Genres With No Songs',
            'orphan-contributors': 'Contributors With No Songs',
            'orphan-tokens': 'Tokens With No Songs',
            'orphan-images': 'Images With No Assets',
            'unprocessed-tokens': 'Unprocessed Tokens',
            'failed-tokens': 'Failed Tokens',
            'artists-no-isni': 'Artists Without ISNI'
        };
        return titles[issueType] || 'Data Issues';
    }

    static async deleteOrphan(type, id, name) {
        if (!confirm(`Are you sure you want to delete "${name}"? This action cannot be undone.`)) {
            return;
        }
        
        UIComponents.showLoading();
        
        try {
            const endpointMap = {
                'orphan-artists': 'artists',
                'orphan-genres': 'genres',
                'orphan-contributors': 'contributors',
                'orphan-tokens': 'tokens',
                'orphan-images': 'images',
                'unprocessed-tokens': 'tokens',
                'failed-tokens': 'tokens',
                'artists-no-isni': 'artists'
            };
            
            const endpoint = endpointMap[type] || 'artists';
            await APIClient.delete(`/api/${endpoint}/${id}`);
            
            UIComponents.showMessage(`Deleted ${name} successfully`, 'success');
            await QualityManager.loadDataIssues(currentIssueType);
            await QualityManager.loadQualityCounts();
        } catch (error) {
            console.error('Delete error:', error);
            UIComponents.showMessage(`Failed to delete ${name}: ${error.message}`, 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }

    static async editArtistIsni(artistId, artistName) {
        const isni = prompt(`Enter ISNI code for "${artistName}":`, '');
        
        if (isni === null || isni.trim() === '') {
            return;
        }
        
        try {
            await APIClient.put(`/api/artists/${artistId}/isni`, { isni: isni.trim() });
            UIComponents.showMessage(`ISNI updated for "${artistName}"`, 'success');
            await QualityManager.loadDataIssues(currentIssueType);
            await QualityManager.loadQualityCounts();
        } catch (error) {
            console.error('Update ISNI error:', error);
            UIComponents.showMessage(`Failed to update ISNI: ${error.message}`, 'error');
        }
    }
}

class BulkActionManager {
    static toggleBulkEditMode() {
        bulkEditMode = !bulkEditMode;
        const button = document.getElementById('bulkEditToggle');
        
        if (bulkEditMode) {
            button.textContent = 'Exit Bulk Edit';
            button.className = 'btn btn-secondary';
            selectedSongs.clear();
            BulkActionManager.updateBulkEditControls();
            BulkActionManager.addSongCheckboxes();
        } else {
            button.textContent = 'Bulk Edit Mode';
            button.className = 'btn btn-primary';
            selectedSongs.clear();
            BulkActionManager.updateBulkEditControls();
            BulkActionManager.removeSongCheckboxes();
        }
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
            selectedSongs.add(parseInt(songId));
            card.classList.add('selected');
        } else {
            selectedSongs.delete(parseInt(songId));
            card.classList.remove('selected');
        }
        
        BulkActionManager.updateBulkEditControls();
    }

    static updateBulkEditControls() {
        const controls = document.getElementById('bulkEditControls');
        if (controls) {
            if (bulkEditMode && selectedSongs.size > 0) {
                controls.style.display = 'block';
                document.getElementById('selectedCount').textContent = selectedSongs.size;
            } else {
                controls.style.display = 'none';
            }
        }
    }

    static toggleItemSelection(itemId) {
        const checkbox = document.querySelector(`input[data-item-id="${itemId}"]`);
        const issueItem = document.querySelector(`div[data-item-id="${itemId}"]`);
        
        if (checkbox.checked) {
            selectedItems.add(itemId);
            issueItem.classList.add('selected');
        } else {
            selectedItems.delete(itemId);
            issueItem.classList.remove('selected');
        }
        
        BulkActionManager.updateSelectionInfo();
        BulkActionManager.updateSelectAllCheckbox();
        BulkActionManager.updateBulkActionsVisibility();
    }

    static toggleSelectAll() {
        const selectAllCheckbox = document.getElementById('selectAllCheckbox');
        const allCheckboxes = document.querySelectorAll('.issue-checkbox[data-item-id]');
        
        selectedItems.clear();
        
        allCheckboxes.forEach(checkbox => {
            checkbox.checked = selectAllCheckbox.checked;
            const itemId = parseInt(checkbox.dataset.itemId);
            const issueItem = document.querySelector(`div[data-item-id="${itemId}"]`);
            
            if (selectAllCheckbox.checked) {
                selectedItems.add(itemId);
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
            selectionInfo.textContent = `${selectedItems.size} items selected`;
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
            bulkActions.classList.toggle('visible', selectedItems.size > 0);
        }
    }

    static async bulkDeleteSelected() {
        if (selectedItems.size === 0) {
            UIComponents.showMessage('No items selected', 'info');
            return;
        }
        
        const entityType = currentIssueType.includes('artists') ? 'artists' : 'genres';
        const selectedIds = Array.from(selectedItems);
        
        const selectedNames = selectedIds.map(id => {
            const issueItem = document.querySelector(`div[data-item-id="${id}"] .issue-title`);
            return issueItem ? issueItem.textContent : `ID: ${id}`;
        });
        
        ModalManager.showBulkModal(
            `Delete ${selectedItems.size} selected ${entityType}?`,
            selectedNames,
            () => BulkActionManager.executeBulkDelete(currentIssueType, selectedIds)
        );
    }

    static async bulkDeleteAll(issueType) {
        const entityType = issueType.includes('artists') ? 'artists' : 'genres';
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
            const endpointMap = {
                'orphan-artists': 'artists',
                'orphan-genres': 'genres',
                'orphan-contributors': 'contributors',
                'orphan-tokens': 'tokens',
                'orphan-images': 'images'
            };
            
            const endpoint = endpointMap[issueType] || 'items';
            await APIClient.deleteWithBody(`/api/${endpoint}/bulk-delete`, { ids });
            
            UIComponents.showMessage(`Successfully deleted ${ids.length} items`, 'success');
            selectedItems.clear();
            await QualityManager.loadDataIssues(currentIssueType);
            await QualityManager.loadQualityCounts();
        } catch (error) {
            console.error('Bulk delete error:', error);
            UIComponents.showMessage(`Failed to delete items: ${error.message}`, 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }

    static openBulkEditModal() {
        if (selectedSongs.size === 0) {
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
        
        const changes = {};
        if (title) changes.title = title;
        if (duration) changes.duration = duration;
        if (status) changes.validation_status = status;
        if (isrc) changes.isrc = isrc;
        if (iswc) changes.iswc = iswc;
        if (artistsText) changes.artists = artistsText.split(',').map(a => a.trim()).filter(a => a);
        if (genresText) changes.genres = genresText.split(',').map(g => g.trim()).filter(g => g);
        
        if (Object.keys(changes).length === 0) {
            UIComponents.showMessage('No changes specified', 'info');
            return;
        }
        
        UIComponents.showLoading();
        ModalManager.hide('bulkEditModal');
        
        try {
            await APIClient.post('/api/songs/bulk-update', {
                songs: Array.from(selectedSongs),
                changes: changes
            });
            
            UIComponents.showMessage(`Successfully updated ${selectedSongs.size} songs`, 'success');
            
            selectedSongs.forEach(songId => {
                if (originalData[songId]) {
                    originalData[songId] = { ...originalData[songId], ...changes };
                    StateManager.refreshSongCard(songId);
                }
            });
            
            BulkActionManager.toggleBulkEditMode();
            
            setTimeout(async () => {
                await Promise.all([QualityManager.loadQualityCounts(), StatsManager.loadStats()]);
            }, 500);
            
        } catch (error) {
            console.error('Bulk update error:', error);
            UIComponents.showMessage(`Failed to update songs: ${error.message}`, 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }

    static async bulkDeleteSongs() {
        if (selectedSongs.size === 0) {
            UIComponents.showMessage('No songs selected', 'info');
            return;
        }
        
        const selectedIds = Array.from(selectedSongs);
        const selectedTitles = selectedIds.map(id => {
            const song = originalData[id];
            return song ? song.title : `ID: ${id}`;
        });
        
        ModalManager.showBulkModal(
            `Delete ${selectedSongs.size} selected songs?`,
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
                delete originalData[id];
                selectedSongs.delete(id);
            });
            
            BulkActionManager.updateBulkEditControls();
            
            const remainingSongs = document.querySelectorAll('.song-card').length;
            if (remainingSongs === 0) {
                const container = document.getElementById('songsContainer');
                container.innerHTML = '<div class="empty-state" id="emptyState"><p>Use the search bar above to find songs to edit</p></div>';
            }
            
            if (bulkEditMode) {
                BulkActionManager.toggleBulkEditMode();
            }
            
            setTimeout(async () => {
                await Promise.all([QualityManager.loadQualityCounts(), StatsManager.loadStats()]);
            }, 500);
            
        } catch (error) {
            console.error('Bulk delete error:', error);
            UIComponents.showMessage(`Failed to delete songs: ${error.message}`, 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }
}

class SearchManager {
    static async searchSongs() {
        const query = document.getElementById('searchInput').value;
        if (!query.trim()) {
            UIComponents.showMessage('Please enter a search term', 'info');
            return;
        }
        
        lastSearchQuery = query;
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
        
        songs.forEach(song => {
            originalData[song.id] = { ...song };
        });
        
        if (bulkEditMode) {
            BulkActionManager.addSongCheckboxes();
        }
    }

    static clearResults() {
        const container = document.getElementById('songsContainer');
        
        container.innerHTML = '<div class="empty-state" id="emptyState"><p>Use the search bar above to find songs to edit</p></div>';
        
        document.getElementById('searchInput').value = '';
        lastSearchQuery = '';
        originalData = {};
        selectedSongs.clear();
        BulkActionManager.updateBulkEditControls();
    }

    static async refreshSearch() {
        if (lastSearchQuery) {
            document.getElementById('searchInput').value = lastSearchQuery;
            await SearchManager.searchSongs();
        }
    }

    static async editSongFromIssue(songId, retryCount = 0) {
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

class SongEditor {
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
        
        currentChanges = { songId, changes };
        ModalManager.showSaveModal(changes);
    }

    static detectChanges(songId) {
        const changes = {};
        const card = document.querySelector(`[data-song-id="${songId}"]`);
        
        const titleInput = card.querySelector('[data-field="title"]');
        if (titleInput && titleInput.value !== originalData[songId].title) {
            changes.title = titleInput.value;
        }
        
        const durationInput = card.querySelector('[data-field="duration"]');
        if (durationInput && durationInput.value !== (originalData[songId].duration || '')) {
            changes.duration = durationInput.value;
        }
        
        const isrcInput = card.querySelector('[data-field="isrc"]');
        if (isrcInput && isrcInput.value !== (originalData[songId].isrc || '')) {
            changes.isrc = isrcInput.value;
        }
        
        const iswcInput = card.querySelector('[data-field="iswc"]');
        if (iswcInput && iswcInput.value !== (originalData[songId].iswc || '')) {
            changes.iswc = iswcInput.value;
        }
        
        const statusSelect = card.querySelector('[data-field="validation_status"]');
        if (statusSelect && statusSelect.value !== originalData[songId].validation_status) {
            changes.validation_status = statusSelect.value;
        }
        
        const artistsContainer = document.getElementById(`artists-${songId}`);
        const currentArtists = Array.from(artistsContainer.querySelectorAll('.tag'))
            .map(tag => tag.textContent.replace('×', '').trim());
        const originalArtists = (originalData[songId].artists || []).map(artist => 
            typeof artist === 'object' ? artist.name : artist
        );
        
        if (JSON.stringify(currentArtists.sort()) !== JSON.stringify(originalArtists.sort())) {
            changes.artists = currentArtists;
        }
        
        const genresContainer = document.getElementById(`genres-${songId}`);
        const currentGenres = Array.from(genresContainer.querySelectorAll('.tag'))
            .map(tag => tag.textContent.replace('×', '').trim());
        const originalGenres = originalData[songId].genres || [];
        
        if (JSON.stringify(currentGenres.sort()) !== JSON.stringify(originalGenres.sort())) {
            changes.genres = currentGenres;
        }
        
        return changes;
    }

    static async confirmSave() {
        const { songId, changes } = currentChanges;
        
        UIComponents.showLoading();
        
        try {
            await APIClient.post(`/api/songs/${songId}/update`, changes);
            
            UIComponents.showMessage('Changes saved successfully!', 'success');
            
            originalData[songId] = { ...originalData[songId], ...changes };
            StateManager.refreshSongCard(songId);
            
            ModalManager.hide('saveModal');
            
            setTimeout(async () => {
                await Promise.all([QualityManager.loadQualityCounts(), StatsManager.loadStats()]);
            }, 500);
            
        } catch (error) {
            console.error('Save error:', error);
            UIComponents.showMessage('Error saving changes: ' + error.message, 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }

    static revertSong(songId) {
        const original = originalData[songId];
        if (!original) return;
        
        StateManager.refreshSongCard(songId);
    }

    static async deleteSong(songId) {
        const song = originalData[songId];
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
        const song = originalData[songId];
        ModalManager.hide('deleteConfirmModal');
        UIComponents.showLoading();
        
        try {
            await APIClient.delete(`/api/songs/${songId}`);
            
            UIComponents.showMessage(`Successfully deleted "${song.title}"`, 'success');
            
            const songCard = document.querySelector(`[data-song-id="${songId}"]`);
            if (songCard) songCard.remove();
            
            delete originalData[songId];
            selectedSongs.delete(songId);
            BulkActionManager.updateBulkEditControls();
            
            const remainingSongs = document.querySelectorAll('.song-card').length;
            if (remainingSongs === 0) {
                const container = document.getElementById('songsContainer');
                container.innerHTML = '<div class="empty-state" id="emptyState"><p>Use the search bar above to find songs to edit</p></div>';
            }
            
            setTimeout(async () => {
                await Promise.all([QualityManager.loadQualityCounts(), StatsManager.loadStats()]);
            }, 500);
            
        } catch (error) {
            console.error('Delete error:', error);
            UIComponents.showMessage(`Failed to delete song: ${error.message}`, 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }
}

class RelationshipManager {
    static createRelationsSection(song, audioFiles, tokens) {
        return `
            <div class="relations-section">
                <div class="relations-title">
                    Audio Files (${audioFiles.length})
                    <button class="btn btn-small btn-primary" onclick="RelationshipManager.toggleAddAudioForm(${song.id})">Add Audio File</button>
                </div>
                
                <div id="addAudioForm-${song.id}" class="add-form">
                    <div class="form-row">
                        <input type="text" placeholder="File URL" id="audioUrl-${song.id}">
                        <select id="audioType-${song.id}">
                            <option value="mp3">MP3</option>
                            <option value="wav">WAV</option>
                            <option value="flac">FLAC</option>
                            <option value="m4a">M4A</option>
                        </select>
                    </div>
                    <div class="form-row">
                        <input type="text" placeholder="IPFS CID (optional)" id="audioCid-${song.id}">
                        <button class="btn btn-small btn-primary" onclick="RelationshipManager.addAudioFile(${song.id})">Add</button>
                        <button class="btn btn-small btn-secondary" onclick="RelationshipManager.toggleAddAudioForm(${song.id})">Cancel</button>
                    </div>
                </div>
                
                ${audioFiles.map(file => `
                    <div class="relation-item" id="audio-${file.id}">
                        <div class="relation-info">
                            <div class="relation-type">${file.type}</div>
                            <div class="relation-name">${UIComponents.escapeHtml(file.url)}</div>
                        </div>
                        <div class="relation-actions">
                            <button class="btn btn-small btn-danger" onclick="RelationshipManager.deleteAudioFile(${file.id}, ${song.id})">Delete</button>
                        </div>
                    </div>
                `).join('')}
                
                <div class="relations-title" style="margin-top: 16px;">
                    Blockchain Tokens (${tokens.length})
                    <button class="btn btn-small btn-primary" onclick="RelationshipManager.toggleAddTokenForm(${song.id})">Link Token</button>
                </div>
                
                <div id="addTokenForm-${song.id}" class="add-form">
                    <div class="form-row">
                        <div class="search-dropdown">
                            <input type="text" placeholder="Search tokens..." id="tokenSearch-${song.id}" 
                                   oninput="RelationshipManager.searchTokens(${song.id}, this.value)" autocomplete="off">
                            <div class="search-results" id="tokenResults-${song.id}"></div>
                        </div>
                    </div>
                    <div class="form-row">
                        <label><input type="checkbox" id="tokenPrimary-${song.id}"> Primary Token</label>
                        <button class="btn btn-small btn-secondary" onclick="RelationshipManager.toggleAddTokenForm(${song.id})">Cancel</button>
                    </div>
                </div>
                
                ${tokens.map(token => `
                    <div class="relation-item" id="token-${token.id}">
                        <div class="relation-info">
                            <div class="relation-type">${token.policy_id.substring(0, 8)}...</div>
                            <div class="relation-name">${UIComponents.escapeHtml(token.name)}</div>
                        </div>
                        <div class="relation-actions">
                            <button class="btn btn-small btn-danger" onclick="RelationshipManager.unlinkToken(${song.id}, ${token.id})">Unlink</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    static toggleAddAudioForm(songId) {
        const form = document.getElementById(`addAudioForm-${songId}`);
        form.classList.toggle('active');
        
        if (form.classList.contains('active')) {
            document.getElementById(`audioUrl-${songId}`).focus();
        }
    }

    static toggleAddTokenForm(songId) {
        const form = document.getElementById(`addTokenForm-${songId}`);
        form.classList.toggle('active');
        
        if (form.classList.contains('active')) {
            document.getElementById(`tokenSearch-${songId}`).focus();
        }
    }

    static async addAudioFile(songId) {
        const url = document.getElementById(`audioUrl-${songId}`).value.trim();
        const type = document.getElementById(`audioType-${songId}`).value;
        const cid = document.getElementById(`audioCid-${songId}`).value.trim();
        
        if (!url) {
            UIComponents.showMessage('Please enter a file URL', 'error');
            return;
        }
        
        try {
            await APIClient.post(`/api/songs/${songId}/audio-files`, {
                file_url: url,
                file_type: type,
                ipfs_cid: cid || null
            });
            
            UIComponents.showMessage('Audio file added successfully', 'success');
            RelationshipManager.refreshSongData(songId);
            RelationshipManager.toggleAddAudioForm(songId);
        } catch (error) {
            console.error('Add audio file error:', error);
            UIComponents.showMessage(`Failed to add audio file: ${error.message}`, 'error');
        }
    }

    static async deleteAudioFile(audioId, songId) {
        if (!confirm('Are you sure you want to delete this audio file?')) {
            return;
        }
        
        try {
            await APIClient.delete(`/api/audio-files/${audioId}`);
            UIComponents.showMessage('Audio file deleted successfully', 'success');
            RelationshipManager.refreshSongData(songId);
        } catch (error) {
            console.error('Delete audio file error:', error);
            UIComponents.showMessage(`Failed to delete audio file: ${error.message}`, 'error');
        }
    }

    static async searchTokens(songId, query) {
        if (searchTimeout) {
            clearTimeout(searchTimeout);
        }
        
        const resultsContainer = document.getElementById(`tokenResults-${songId}`);
        
        if (!query || query.length < 2) {
            resultsContainer.style.display = 'none';
            return;
        }
        
        searchTimeout = setTimeout(async () => {
            try {
                const tokens = await APIClient.get(`/api/tokens/search?q=${encodeURIComponent(query)}`);
                
                if (tokens.length > 0) {
                    resultsContainer.innerHTML = tokens.map(token => `
                        <div class="search-result-item" onclick="RelationshipManager.selectToken(${songId}, ${token.id}, '${UIComponents.escapeHtml(token.asset_name)}')">
                            <div><strong>${UIComponents.escapeHtml(token.asset_name)}</strong></div>
                            <div style="font-size: 11px; color: #6c757d;">${token.policy_id.substring(0, 16)}...</div>
                        </div>
                    `).join('');
                    resultsContainer.style.display = 'block';
                } else {
                    resultsContainer.style.display = 'none';
                }
            } catch (error) {
                console.error('Search tokens error:', error);
                resultsContainer.style.display = 'none';
            }
        }, 300);
    }

    static async selectToken(songId, tokenId, tokenName) {
        const searchInput = document.getElementById(`tokenSearch-${songId}`);
        const resultsContainer = document.getElementById(`tokenResults-${songId}`);
        const isPrimary = document.getElementById(`tokenPrimary-${songId}`).checked;
        
        searchInput.value = tokenName;
        resultsContainer.style.display = 'none';
        
        try {
            await APIClient.post(`/api/songs/${songId}/tokens/${tokenId}/link`, {
                is_primary: isPrimary
            });
            
            UIComponents.showMessage('Token linked successfully', 'success');
            RelationshipManager.refreshSongData(songId);
            RelationshipManager.toggleAddTokenForm(songId);
        } catch (error) {
            console.error('Link token error:', error);
            UIComponents.showMessage(`Failed to link token: ${error.message}`, 'error');
        }
    }

    static async unlinkToken(songId, tokenId) {
        if (!confirm('Are you sure you want to unlink this token?')) {
            return;
        }
        
        try {
            await APIClient.delete(`/api/songs/${songId}/tokens/${tokenId}/unlink`);
            UIComponents.showMessage('Token unlinked successfully', 'success');
            RelationshipManager.refreshSongData(songId);
        } catch (error) {
            console.error('Unlink token error:', error);
            UIComponents.showMessage(`Failed to unlink token: ${error.message}`, 'error');
        }
    }

    static async refreshSongData(songId) {
        try {
            const song = await APIClient.get(`/api/songs/${songId}`);
            originalData[songId] = { ...song };
            
            const songCard = document.querySelector(`[data-song-id="${songId}"]`);
            if (songCard) {
                const newCard = UIComponents.createSongCard(song);
                songCard.outerHTML = newCard;
            }
        } catch (error) {
            console.error('Refresh song data error:', error);
        }
    }
}

class TokenManager {
    static async processToken(tokenId, tokenName) {
        try {
            await APIClient.post(`/api/tokens/${tokenId}/process`);
            UIComponents.showMessage(`Token "${tokenName}" marked as processed`, 'success');
            await QualityManager.loadDataIssues(currentIssueType);
            await QualityManager.loadQualityCounts();
        } catch (error) {
            console.error('Process token error:', error);
            UIComponents.showMessage(`Failed to process token: ${error.message}`, 'error');
        }
    }

    static async bulkProcessTokens() {
        if (selectedItems.size === 0) {
            UIComponents.showMessage('No tokens selected', 'info');
            return;
        }
        
        UIComponents.showLoading();
        
        try {
            const promises = Array.from(selectedItems).map(tokenId => 
                APIClient.post(`/api/tokens/${tokenId}/process`)
            );
            
            await Promise.all(promises);
            
            UIComponents.showMessage(`Successfully processed ${selectedItems.size} tokens`, 'success');
            selectedItems.clear();
            await QualityManager.loadDataIssues(currentIssueType);
            await QualityManager.loadQualityCounts();
        } catch (error) {
            console.error('Bulk process error:', error);
            UIComponents.showMessage(`Failed to process tokens: ${error.message}`, 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }

    static async showLinkTokenModal(tokenId, tokenName) {
        ModalManager.createLinkTokenModal();
        
        document.getElementById('linkTokenId').value = tokenId;
        document.getElementById('linkTokenName').textContent = tokenName;
        document.getElementById('songSearchInput').value = '';
        document.getElementById('songSearchResults').innerHTML = '';
        document.getElementById('selectedSongsList').innerHTML = '';
        selectedSongsForLink.clear();
        
        ModalManager.show('linkTokenModal');
    }

    static async showFixTokenModal(tokenId, tokenName) {
        ModalManager.createFixTokenModal();
        
        document.getElementById('fixTokenId').value = tokenId;
        document.getElementById('fixTokenName').textContent = tokenName;
        document.getElementById('fixSongSearchInput').value = '';
        document.getElementById('fixSongSearchResults').innerHTML = '';
        document.getElementById('fixSelectedSongsList').innerHTML = '';
        document.getElementById('markProcessedCheck').checked = true;
        selectedSongsForFix.clear();
        
        ModalManager.show('fixTokenModal');
    }

    static async searchSongsForToken(query, tokenId, resultsContainerId) {
        if (searchTimeout) {
            clearTimeout(searchTimeout);
        }
        
        const resultsContainer = document.getElementById(resultsContainerId);
        
        if (!query || query.length < 2) {
            resultsContainer.innerHTML = '';
            return;
        }
        
        searchTimeout = setTimeout(async () => {
            try {
                const songs = await APIClient.get(`/api/songs/search-for-token?q=${encodeURIComponent(query)}&tokenId=${tokenId}`);
                
                if (songs.length > 0) {
                    resultsContainer.innerHTML = songs.map(song => `
                        <div class="search-result-item ${song.already_linked ? 'already-linked' : ''}" 
                             onclick="TokenManager.selectSongForToken(${song.id}, '${UIComponents.escapeHtml(song.title)}', '${UIComponents.escapeHtml(song.artists || '')}', ${song.already_linked}, '${resultsContainerId}')">
                            <div><strong>${UIComponents.escapeHtml(song.title)}</strong></div>
                            <div style="font-size: 12px; color: #888;">${UIComponents.escapeHtml(song.artists || 'No artists')}</div>
                            ${song.already_linked ? '<div style="font-size: 11px; color: #66b2ff;">Already linked</div>' : ''}
                        </div>
                    `).join('');
                } else {
                    resultsContainer.innerHTML = '<div class="search-result-item">No songs found</div>';
                }
            } catch (error) {
                console.error('Search error:', error);
                resultsContainer.innerHTML = '<div class="search-result-item">Search failed</div>';
            }
        }, 300);
    }

    static selectSongForToken(songId, songTitle, artists, alreadyLinked, resultsContainerId) {
        if (alreadyLinked) {
            UIComponents.showMessage('Song is already linked to this token', 'info');
            return;
        }
        
        const selectedSet = resultsContainerId.includes('fix') ? selectedSongsForFix : selectedSongsForLink;
        const listContainerId = resultsContainerId.includes('fix') ? 'fixSelectedSongsList' : 'selectedSongsList';
        
        if (selectedSet.has(songId)) {
            UIComponents.showMessage('Song already selected', 'info');
            return;
        }
        
        selectedSet.add(songId);
        
        const selectedList = document.getElementById(listContainerId);
        const songItem = document.createElement('div');
        songItem.className = 'selected-song-item';
        songItem.innerHTML = `
            <span>${UIComponents.escapeHtml(songTitle)} - ${UIComponents.escapeHtml(artists)}</span>
            <button class="btn btn-small btn-danger" onclick="TokenManager.removeSongFromSelection(${songId}, '${listContainerId}')">Remove</button>
        `;
        selectedList.appendChild(songItem);
        
        document.getElementById(resultsContainerId).innerHTML = '';
        const searchInputId = resultsContainerId.includes('fix') ? 'fixSongSearchInput' : 'songSearchInput';
        document.getElementById(searchInputId).value = '';
    }

    static removeSongFromSelection(songId, listContainerId) {
        const selectedSet = listContainerId.includes('fix') ? selectedSongsForFix : selectedSongsForLink;
        selectedSet.delete(songId);
        
        const songItems = document.querySelectorAll(`#${listContainerId} .selected-song-item`);
        songItems.forEach(item => {
            if (item.innerHTML.includes(`removeSongFromSelection(${songId}`)) {
                item.remove();
            }
        });
    }

    static async linkTokenToSongs() {
        const tokenId = document.getElementById('linkTokenId').value;
        const songIds = Array.from(selectedSongsForLink);
        
        if (songIds.length === 0) {
            UIComponents.showMessage('Please select at least one song', 'error');
            return;
        }
        
        UIComponents.showLoading();
        
        try {
            const result = await APIClient.post(`/api/tokens/${tokenId}/bulk-link-songs`, { songIds });
            
            UIComponents.showMessage(`Successfully linked token to ${result.linkedCount} songs`, 'success');
            TokenManager.closeLinkTokenModal();
            await QualityManager.loadDataIssues(currentIssueType);
            await QualityManager.loadQualityCounts();
        } catch (error) {
            console.error('Link token error:', error);
            UIComponents.showMessage(`Failed to link token: ${error.message}`, 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }

    static async fixTokenRelations() {
        const tokenId = document.getElementById('fixTokenId').value;
        const songIds = Array.from(selectedSongsForFix);
        const markProcessed = document.getElementById('markProcessedCheck').checked;
        
        if (songIds.length === 0 && !markProcessed) {
            UIComponents.showMessage('Please select songs or choose to mark as processed', 'error');
            return;
        }
        
        UIComponents.showLoading();
        
        try {
            const result = await APIClient.post(`/api/tokens/${tokenId}/fix-relations`, { songIds, markProcessed });
            
            UIComponents.showMessage(result.message, 'success');
            TokenManager.closeFixTokenModal();
            await QualityManager.loadDataIssues(currentIssueType);
            await QualityManager.loadQualityCounts();
        } catch (error) {
            console.error('Fix token error:', error);
            UIComponents.showMessage(`Failed to fix token: ${error.message}`, 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }

    static closeLinkTokenModal() {
        ModalManager.hide('linkTokenModal');
        selectedSongsForLink.clear();
    }

    static closeFixTokenModal() {
        ModalManager.hide('fixTokenModal');
        selectedSongsForFix.clear();
    }

    static async bulkLinkTokens() {
        if (selectedItems.size === 0) {
            UIComponents.showMessage('No tokens selected', 'info');
            return;
        }
        
        UIComponents.showMessage('Bulk token linking not implemented yet. Please link tokens individually.', 'info');
    }

    static async bulkFixTokens() {
        if (selectedItems.size === 0) {
            UIComponents.showMessage('No tokens selected', 'info');
            return;
        }
        
        UIComponents.showLoading();
        
        try {
            const promises = Array.from(selectedItems).map(tokenId => 
                APIClient.post(`/api/tokens/${tokenId}/fix-relations`, { songIds: [], markProcessed: true })
            );
            
            await Promise.all(promises);
            
            UIComponents.showMessage(`Successfully marked ${selectedItems.size} tokens as processed`, 'success');
            selectedItems.clear();
            await QualityManager.loadDataIssues(currentIssueType);
            await QualityManager.loadQualityCounts();
        } catch (error) {
            console.error('Bulk fix tokens error:', error);
            UIComponents.showMessage(`Failed to fix tokens: ${error.message}`, 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }
}

class StatsManager {
    static async loadStats() {
        try {
            const stats = await APIClient.get('/api/stats');
            
            const statElements = {
                'totalSongs': stats.total_songs || 0,
                'totalArtists': stats.total_artists || 0,
                'totalGenres': stats.total_genres || 0,
                'verifiedSongs': stats.verified_songs || 0,
                'unverifiedSongs': stats.unverified_songs || 0,
                'pendingSongs': stats.pending_songs || 0
            };
            
            Object.entries(statElements).forEach(([id, value]) => {
                const element = document.getElementById(id);
                if (element) element.textContent = value;
            });
            
        } catch (error) {
            console.error('Failed to load statistics:', error);
            UIComponents.showMessage('Failed to load statistics', 'error');
        }
    }
}

function showTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    document.querySelectorAll('.tab-button').forEach(button => {
        button.classList.remove('active');
    });
    
    document.getElementById(tabName + 'Tab').classList.add('active');
    event.target.classList.add('active');
    
    if (tabName === 'quality') {
        QualityManager.loadQualityCounts();
    } else if (tabName === 'stats') {
        StatsManager.loadStats();
    }
}

async function searchSongs() {
    await SearchManager.searchSongs();
}

function clearResults() {
    SearchManager.clearResults();
}

async function loadDataIssues(issueType) {
    await QualityManager.loadDataIssues(issueType);
}

async function loadStats() {
    await StatsManager.loadStats();
}

function markChanged(songId) {
    StateManager.markSongChanged(songId);
}

function removeTag(element, songId) {
    SongEditor.removeTag(element, songId);
}

function addTag(event, containerId, songId) {
    SongEditor.addTag(event, containerId, songId);
}

function saveSong(songId) {
    SongEditor.saveSong(songId);
}

async function confirmSave() {
    await SongEditor.confirmSave();
}

function closeModal() {
    ModalManager.hide('saveModal');
}

function closeBulkModal() {
    ModalManager.hide('bulkModal');
}

function closeBulkEditModal() {
    ModalManager.hide('bulkEditModal');
}

function closeDeleteModal() {
    ModalManager.hide('deleteConfirmModal');
}

function revertSong(songId) {
    SongEditor.revertSong(songId);
}

document.getElementById('searchInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        searchSongs();
    }
});

document.addEventListener('DOMContentLoaded', async function() {
    await Promise.all([StatsManager.loadStats(), QualityManager.loadQualityCounts()]);
});

document.addEventListener('click', function(event) {
    const searchResults = document.querySelectorAll('.search-results');
    searchResults.forEach(result => {
        if (!result.closest('.search-dropdown').contains(event.target)) {
            result.style.display = 'none';
        }
    });
});

window.onclick = function(event) {
    const modals = ['saveModal', 'bulkModal', 'bulkEditModal', 'deleteConfirmModal', 'linkTokenModal', 'fixTokenModal'];
    modals.forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (modal && event.target === modal) {
            modal.style.display = 'none';
        }
    });
}