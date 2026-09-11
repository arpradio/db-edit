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

// Runs a set of zero-arg refresh callbacks without letting a refresh failure
// masquerade as a failure of the action that triggered it.
async function safeRefresh(tasks) {
    try {
        await Promise.all(tasks.map(fn => fn()));
    } catch (error) {
        console.error('Post-action refresh failed:', error);
    }
}

// Data quality counts and overall stats can change after almost any edit
// (songs/artists/genres/contributors created, linked, or removed), so this
// is the standard refresh to run after a successful mutation.
function refreshCountsAndStats() {
    return safeRefresh([QualityManager.loadQualityCounts, StatsManager.loadStats]);
}

// Re-fetches the currently open data-quality issue list, if one is open.
function refreshCurrentIssues() {
    if (!currentIssueType) return Promise.resolve();
    return safeRefresh([() => QualityManager.loadDataIssues(currentIssueType)]);
}

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
                <div id="bulkSelectAllContainer" style="display: none;">
                    <label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer;">
                        <input type="checkbox" id="bulkSelectAllSongs" onchange="BulkActionManager.toggleSelectAllSongs()">
                        Select All
                    </label>
                </div>
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

        const hasNoTokens = tokens.length === 0;

        return `
            <div class="song-card ${hasNoTokens ? 'missing-tokens' : ''}" data-song-id="${song.id}">
                <div class="song-header">
                    <div class="song-title">${UIComponents.escapeHtml(song.title)}</div>
                    <div class="song-id">ID: ${song.id}</div>
                    ${hasNoTokens ? '<div class="no-token-badge">⚠️ NO TOKENS</div>' : ''}
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
                                   onchange="StateManager.markSongChanged(${song.id})" data-field="isrc" maxlength="16" placeholder="ISRC code">
                        </div>
                    </div>

                    <div class="metadata-row">
                        <span class="metadata-label">ISWC:</span>
                        <div class="metadata-value">
                            <input type="text" class="editable-field id-field" value="${song.iswc || ''}"
                                   onchange="StateManager.markSongChanged(${song.id})" data-field="iswc" maxlength="16" placeholder="ISWC code">
                        </div>
                    </div>
                </div>

                <div class="metadata-row">
                    <span class="metadata-label">Explicit Content:</span>
                    <div class="metadata-value">
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" class="editable-field" ${song.is_explicit ? 'checked' : ''}
                                   onchange="StateManager.markSongChanged(${song.id})" data-field="is_explicit"
                                   style="width: auto; cursor: pointer;">
                            <span style="font-size: 13px; color: #888;">This song contains explicit content</span>
                        </label>
                    </div>
                </div>

                <div class="metadata-row">
                    <span class="metadata-label">AI Generated:</span>
                    <div class="metadata-value">
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" class="editable-field" ${song.is_ai_generated ? 'checked' : ''}
                                   onchange="StateManager.markSongChanged(${song.id})" data-field="is_ai_generated"
                                   style="width: auto; cursor: pointer;">
                            <span style="font-size: 13px; color: #888;">This song was generated by AI</span>
                        </label>
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
        const existing = document.getElementById('linkTokenModal');
        if (existing) existing.remove();

        const modal = UIComponents.createModal('linkTokenModal', 'Link Token to Songs', `
            <p>Link "<span id="linkTokenName"></span>" to songs</p>
            <input type="hidden" id="linkTokenId">

            <h5 style="margin-top: 15px; margin-bottom: 10px; font-size: 14px; color: #4CAF50;">Find Song by Title</h5>
            <div class="add-song-form" style="display: flex; gap: 10px; margin-bottom: 15px;">
                <input type="text" id="linkNewSongTitle" class="form-input" placeholder="Song title" style="flex: 1;" onkeypress="if(event.key==='Enter') TokenManager.addSongByTitle('linkTokenModal')" />
                <button class="btn btn-small btn-primary" onclick="TokenManager.addSongByTitle('linkTokenModal')">Search</button>
            </div>
            <p style="color: #888; font-size: 11px; margin-bottom: 15px;">
                Enter a song title to find matching songs. You can select from results or create a new song if needed.
            </p>

            <h5 style="margin-bottom: 10px; font-size: 14px; color: #4CAF50;">Or Browse All Songs</h5>
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
        const existing = document.getElementById('fixTokenModal');
        if (existing) existing.remove();

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

    static createBulkTokenLinkModal() {
        const existing = document.getElementById('bulkTokenLinkModal');
        if (existing) existing.remove();

        const modal = UIComponents.createModal('bulkTokenLinkModal', 'Bulk Link Tokens to Songs', `
            <p><strong>Link multiple tokens to song(s)</strong></p>
            <input type="hidden" id="bulkLinkTokenIds">

            <div class="bulk-token-list">
                <h4>Selected Tokens:</h4>
                <div id="bulkLinkTokenNames" class="token-names-list"></div>
            </div>

            <h5 style="margin-top: 15px; margin-bottom: 10px; font-size: 14px; color: #4CAF50;">Create or Link Song by Title</h5>
            <div class="add-song-form" style="display: flex; gap: 10px; margin-bottom: 15px;">
                <input type="text" id="bulkLinkNewSongTitle" class="form-input" placeholder="Song title" style="flex: 1;" onkeypress="if(event.key==='Enter') TokenManager.addSongByTitle('bulkTokenLinkModal')" />
                <button class="btn btn-small btn-primary" onclick="TokenManager.addSongByTitle('bulkTokenLinkModal')">Add Song</button>
            </div>
            <p style="color: #888; font-size: 11px; margin-bottom: 15px;">
                If song exists, it will be added to selection. If not, a new song will be created.
            </p>

            <h5 style="margin-bottom: 10px; font-size: 14px; color: #4CAF50;">Or Search Existing Songs</h5>
            <div class="search-section">
                <input type="text" id="bulkLinkSongSearchInput" class="search-bar" placeholder="Search songs to link..."
                       oninput="TokenManager.searchSongsForBulkLink(this.value)">
                <div id="bulkLinkSongSearchResults" class="search-results-modal"></div>
            </div>

            <div id="bulkLinkSelectedSongsList" class="selected-songs-list"></div>
        `, `
            <button class="btn btn-success" onclick="TokenManager.bulkLinkTokensToSongs()">Link All Tokens to Selected Songs</button>
            <button class="btn btn-secondary" onclick="TokenManager.closeBulkLinkModal()">Cancel</button>
        `);
    }

    static createEditTokenModal(tokenData) {
        const existing = document.getElementById('editTokenModal');
        if (existing) existing.remove();

        const metadataSection = tokenData ? `
            <div class="metadata-section" style="margin-bottom: 20px;">
                <h4>Token Metadata (Read-Only)</h4>
                <div class="metadata-row">
                    <span class="metadata-label">Token ID:</span>
                    <span>${tokenData.id}</span>
                </div>

                ${tokenData.name ? `
                <div class="metadata-row">
                    <span class="metadata-label">Name:</span>
                    <span>${UIComponents.escapeHtml(tokenData.name)}</span>
                </div>
                ` : ''}

                ${tokenData.asset_fingerprint ? `
                <div class="metadata-row">
                    <span class="metadata-label">Fingerprint:</span>
                    <span style="font-family: monospace; font-size: 11px;">${UIComponents.escapeHtml(tokenData.asset_fingerprint)}</span>
                </div>
                ` : ''}

                ${tokenData.data_label ? `
                <div class="metadata-row">
                    <span class="metadata-label">Standard:</span>
                    <span>${tokenData.data_label === 721 ? 'CIP-25 (NFT)' : tokenData.data_label === 100 ? 'CIP-68 (Datum)' : tokenData.data_label}</span>
                </div>
                ` : ''}

                ${tokenData.release_type ? `
                <div class="metadata-row">
                    <span class="metadata-label">Release Type:</span>
                    <span>${UIComponents.escapeHtml(tokenData.release_type)}</span>
                </div>
                ` : ''}

                ${tokenData.image_urls && tokenData.image_urls.length > 0 ? `
                <div class="metadata-row">
                    <span class="metadata-label">Metadata Images:</span>
                    <div style="flex: 1;">
                        ${tokenData.image_urls.map(url => `<div style="font-size: 11px; margin-bottom: 4px; word-break: break-all;">${UIComponents.escapeHtml(url)}</div>`).join('')}
                    </div>
                </div>
                ` : ''}

                ${tokenData.metadata ? `
                <div class="metadata-row" style="flex-direction: column; align-items: stretch;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span class="metadata-label" style="margin: 0;">Full Metadata (JSON):</span>
                        <button class="btn btn-small btn-secondary" onclick="TokenManager.toggleTokenMetadataJson()" id="toggleTokenMetadataBtn">Show</button>
                    </div>
                    <pre id="tokenMetadataJson" style="display: none; background: #1a1a1a; padding: 12px; border-radius: 4px; overflow-x: auto; max-height: 400px; margin: 0;"><code>${UIComponents.escapeHtml(JSON.stringify(tokenData.metadata, null, 2))}</code></pre>
                </div>
                ` : ''}
            </div>
        ` : '';

        const modal = UIComponents.createModal('editTokenModal', 'Edit Token Details', `
            <input type="hidden" id="editTokenId">

            ${metadataSection}

            <div class="form-section">
                <h4>Editable Fields</h4>
                <div class="metadata-row">
                    <span class="metadata-label">Policy ID:</span>
                    <div class="metadata-value">
                        <input type="text" id="editTokenPolicyId" class="editable-field" placeholder="Policy ID">
                    </div>
                </div>

                <div class="metadata-row">
                    <span class="metadata-label">Asset Name:</span>
                    <div class="metadata-value">
                        <input type="text" id="editTokenAssetName" class="editable-field" placeholder="Asset name">
                    </div>
                </div>
            </div>
        `, `
            <button class="btn btn-primary" onclick="TokenManager.saveTokenDetails()">Save Changes</button>
            <button class="btn btn-secondary" onclick="TokenManager.closeEditTokenModal()">Cancel</button>
        `);
    }

    static createBulkEditTokensModal() {
        const existing = document.getElementById('bulkEditTokensModal');
        if (existing) existing.remove();

        const modal = UIComponents.createModal('bulkEditTokensModal', 'Bulk Edit Token Details', `
            <p><strong>Edit multiple tokens at once</strong></p>
            <input type="hidden" id="bulkEditTokenIds">

            <div class="bulk-token-list">
                <h4>Selected Tokens:</h4>
                <div id="bulkEditTokenNames" class="token-names-list"></div>
            </div>

            <p class="bulk-edit-note">Only filled fields will be updated. Leave blank to keep existing values.</p>

            <h4 style="margin-top: 20px; margin-bottom: 10px; font-size: 14px; border-bottom: 1px solid #ddd; padding-bottom: 5px;">Token Metadata</h4>

            <div class="metadata-row">
                <span class="metadata-label">Token Name:</span>
                <div class="metadata-value">
                    <input type="text" id="bulkEditTokenName" class="editable-field" placeholder="New token name (optional)">
                </div>
            </div>

            <div class="metadata-row">
                <span class="metadata-label">Policy ID:</span>
                <div class="metadata-value">
                    <input type="text" id="bulkEditTokenPolicyId" class="editable-field" placeholder="New policy ID (optional)">
                </div>
            </div>

            <div class="metadata-row">
                <span class="metadata-label">Asset Name:</span>
                <div class="metadata-value">
                    <input type="text" id="bulkEditTokenAssetName" class="editable-field" placeholder="New asset name (optional)">
                </div>
            </div>

            <h4 style="margin-top: 20px; margin-bottom: 10px; font-size: 14px; border-bottom: 1px solid #ddd; padding-bottom: 5px;">Image</h4>

            <div class="metadata-row">
                <span class="metadata-label">Image URL:</span>
                <div class="metadata-value">
                    <input type="text" id="bulkEditTokenImageUrl" class="editable-field" placeholder="Image URL (optional)">
                </div>
            </div>

            <div class="metadata-row">
                <span class="metadata-label">Image Type:</span>
                <div class="metadata-value">
                    <select id="bulkEditTokenImageType" class="editable-field">
                        <option value="">Don't add image</option>
                        <option value="cover">Cover</option>
                        <option value="thumbnail">Thumbnail</option>
                        <option value="banner">Banner</option>
                    </select>
                </div>
            </div>

            <div class="metadata-row">
                <label style="display: flex; align-items: center; gap: 8px;">
                    <input type="checkbox" id="bulkEditTokenImagePrimary">
                    <span>Set as Primary Image</span>
                </label>
            </div>

            <h4 style="margin-top: 20px; margin-bottom: 10px; font-size: 14px; border-bottom: 1px solid #ddd; padding-bottom: 5px;">Audio File</h4>
            <p style="color: #888; font-size: 12px; margin-bottom: 10px;">
                Audio files will be added to the song linked to each token (creates and links a song if needed)
            </p>

            <div class="metadata-row">
                <span class="metadata-label">Audio URL:</span>
                <div class="metadata-value">
                    <input type="text" id="bulkEditTokenAudioUrl" class="editable-field" placeholder="Audio file URL (optional)">
                </div>
            </div>

            <div class="metadata-row">
                <span class="metadata-label">Audio Type:</span>
                <div class="metadata-value">
                    <select id="bulkEditTokenAudioType" class="editable-field">
                        <option value="">Don't add audio</option>
                        <option value="mp3">MP3</option>
                        <option value="wav">WAV</option>
                        <option value="flac">FLAC</option>
                        <option value="m4a">M4A</option>
                    </select>
                </div>
            </div>

            <div class="metadata-row">
                <span class="metadata-label">IPFS CID:</span>
                <div class="metadata-value">
                    <input type="text" id="bulkEditTokenAudioCid" class="editable-field" placeholder="IPFS CID (optional)">
                </div>
            </div>
        `, `
            <button class="btn btn-primary" onclick="TokenManager.bulkSaveTokenDetails()">Update All Tokens</button>
            <button class="btn btn-secondary" onclick="TokenManager.closeBulkEditTokensModal()">Cancel</button>
        `);
    }

    static createBulkAddImageModal() {
        const existing = document.getElementById('bulkAddImageModal');
        if (existing) existing.remove();

        const modal = UIComponents.createModal('bulkAddImageModal', 'Bulk Add Image to Tokens', `
            <p><strong>Add image to multiple tokens at once</strong></p>
            <input type="hidden" id="bulkAddImageTokenIds">

            <div class="bulk-token-list">
                <h4>Selected Tokens:</h4>
                <div id="bulkAddImageTokenNames" class="token-names-list"></div>
            </div>

            <div class="metadata-row">
                <span class="metadata-label">Image URL:</span>
                <div class="metadata-value">
                    <input type="text" id="bulkAddImageUrl" class="editable-field" placeholder="Image URL">
                </div>
            </div>

            <div class="metadata-row">
                <span class="metadata-label">Image Type:</span>
                <div class="metadata-value">
                    <select id="bulkAddImageType" class="editable-field">
                        <option value="cover">Cover</option>
                        <option value="thumbnail">Thumbnail</option>
                        <option value="banner">Banner</option>
                    </select>
                </div>
            </div>

            <div class="metadata-row">
                <span class="metadata-label">
                    <input type="checkbox" id="bulkAddImagePrimary">
                    Set as Primary Image
                </span>
            </div>
        `, `
            <button class="btn btn-primary" onclick="TokenManager.bulkAddImage()">Add Image to All Tokens</button>
            <button class="btn btn-secondary" onclick="TokenManager.closeBulkAddImageModal()">Cancel</button>
        `);
    }

    static createBulkAddAudioModal() {
        const existing = document.getElementById('bulkAddAudioModal');
        if (existing) existing.remove();

        const modal = UIComponents.createModal('bulkAddAudioModal', 'Bulk Add Audio to Tokens', `
            <p><strong>Add audio file to multiple tokens</strong></p>
            <p style="color: #888; font-size: 12px; margin-bottom: 15px;">
                This will create a song for each token (if needed), link the token to that song, and add the audio file.
            </p>
            <input type="hidden" id="bulkAddAudioTokenIds">

            <div class="bulk-token-list">
                <h4>Selected Tokens:</h4>
                <div id="bulkAddAudioTokenNames" class="token-names-list"></div>
            </div>

            <div class="metadata-row">
                <span class="metadata-label">Audio File URL:</span>
                <div class="metadata-value">
                    <input type="text" id="bulkAddAudioUrl" class="editable-field" placeholder="Audio file URL">
                </div>
            </div>

            <div class="metadata-row">
                <span class="metadata-label">File Type:</span>
                <div class="metadata-value">
                    <select id="bulkAddAudioType" class="editable-field">
                        <option value="mp3">MP3</option>
                        <option value="wav">WAV</option>
                        <option value="flac">FLAC</option>
                        <option value="m4a">M4A</option>
                    </select>
                </div>
            </div>

            <div class="metadata-row">
                <span class="metadata-label">IPFS CID (optional):</span>
                <div class="metadata-value">
                    <input type="text" id="bulkAddAudioCid" class="editable-field" placeholder="IPFS CID (optional)">
                </div>
            </div>
        `, `
            <button class="btn btn-primary" onclick="TokenManager.bulkAddAudio()">Add Audio to All Tokens</button>
            <button class="btn btn-secondary" onclick="TokenManager.closeBulkAddAudioModal()">Cancel</button>
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
                'artistsNoIsniCount': counts.artists_no_isni || 0,
                'noContributorsCount': counts.no_contributors || 0
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

    // Issue types that list individual songs (as opposed to orphaned
    // artists/genres/contributors/tokens/images) and can be bulk-deleted
    // straight through the songs bulk-delete endpoint.
    static isSongIssueType(issueType) {
        const songIssueTypes = [
            'no-artists', 'no-genres', 'no-audio', 'no-duration', 'no-isrc',
            'no-iswc', 'no-tokens', 'no-copyright', 'no-contributors'
        ];
        return songIssueTypes.includes(issueType);
    }

    static shouldShowBulkActions(issueType) {
        return issueType.includes('orphan') || issueType.includes('unprocessed') ||
               issueType.includes('failed') || issueType.includes('artists-no-isni') ||
               QualityManager.isSongIssueType(issueType);
    }

    static getEntityTypeLabel(issueType) {
        if (QualityManager.isSongIssueType(issueType)) return 'songs';
        if (issueType.includes('artists')) return 'artists';
        if (issueType.includes('genres')) return 'genres';
        if (issueType.includes('contributors')) return 'contributors';
        if (issueType.includes('tokens')) return 'tokens';
        if (issueType.includes('images')) return 'images';
        return 'items';
    }

    static createBulkActionsHTML(issueType) {
        const entityMap = {
            'orphan-artists': 'artists',
            'orphan-genres': 'genres',
            'orphan-contributors': 'contributors',
            'orphan-tokens': 'tokens',
            'orphan-images': 'images'
        };

        const entityType = QualityManager.isSongIssueType(issueType) ? 'songs' : (entityMap[issueType] || 'items');

        let bulkButtons = `
            <button class="btn btn-small btn-danger" onclick="BulkActionManager.bulkDeleteSelected()">Delete Selected</button>
            <button class="btn btn-small btn-danger" onclick="BulkActionManager.bulkDeleteAll('${issueType}')">Delete All ${entityType}</button>
        `;
        
        if (issueType === 'orphan-tokens') {
            bulkButtons = `
                <button class="btn btn-small btn-success" onclick="TokenManager.showBulkLinkModal()">Bulk Link to Song(s)</button>
                <button class="btn btn-small btn-primary" onclick="TokenManager.showBulkEditTokensModal()">Bulk Edit Details</button>
            ` + bulkButtons;
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
        // Special handling for asset-related issues
        if (issueType === 'no-images') {
            return `
                <div class="issue-item">
                    <div class="issue-content">
                        <span class="issue-title">${UIComponents.escapeHtml(issue.asset_name)}</span>
                        <span class="issue-id">Asset ID: ${issue.asset_id}</span>
                        <span class="issue-meta">Policy: ${UIComponents.escapeHtml(issue.policy_id.substring(0, 8))}...</span>
                    </div>
                    <div class="issue-actions">
                        <button class="btn btn-small btn-primary" onclick="AssetManager.editAsset(${issue.asset_id})">Edit Asset</button>
                    </div>
                </div>
            `;
        } else if (QualityManager.isSongIssueType(issueType)) {
            const showCheckbox = true;
            return `
                <div class="issue-item" data-item-id="${issue.id}" ${showCheckbox ? '' : `onclick="SearchManager.editSongFromIssue(${issue.id})"`}>
                    <div class="issue-content">
                        ${showCheckbox ? `<input type="checkbox" class="issue-checkbox" data-item-id="${issue.id}" onchange="BulkActionManager.toggleItemSelection(${issue.id})">` : ''}
                        <span class="issue-title" ${showCheckbox ? `style="cursor: pointer;" onclick="SearchManager.editSongFromIssue(${issue.id})"` : ''}>${UIComponents.escapeHtml(issue.title || issue.name)}</span>
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
                actionButtons = `
                    <button class="btn btn-small btn-success" onclick="TokenManager.showLinkTokenModal(${issue.id}, '${UIComponents.escapeHtml(issue.name)}')">Link to Songs</button>
                    <button class="btn btn-small btn-primary" onclick="TokenManager.editTokenDetails(${issue.id}, '${UIComponents.escapeHtml(issue.name)}', '${issue.policy_id}', '${UIComponents.escapeHtml(issue.asset_name)}')">Edit Details</button>
                ` + actionButtons;
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
            'no-contributors': 'Songs Without Contributors',
            'no-copyright': 'Songs Without Copyright',
            'no-images': 'Assets Without Images',
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
            await refreshCurrentIssues();
            await refreshCountsAndStats();
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
            await refreshCurrentIssues();
            await refreshCountsAndStats();
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
        const selectAllContainer = document.getElementById('bulkSelectAllContainer');

        if (bulkEditMode) {
            button.textContent = 'Exit Bulk Edit';
            button.className = 'btn btn-secondary';
            selectedSongs.clear();
            if (selectAllContainer) selectAllContainer.style.display = 'block';
            const selectAllCheckbox = document.getElementById('bulkSelectAllSongs');
            if (selectAllCheckbox) selectAllCheckbox.checked = false;
            BulkActionManager.updateBulkEditControls();
            BulkActionManager.addSongCheckboxes();
        } else {
            button.textContent = 'Bulk Edit Mode';
            button.className = 'btn btn-primary';
            selectedSongs.clear();
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

        const entityType = QualityManager.getEntityTypeLabel(currentIssueType);
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
            selectedItems.clear();
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

            await refreshCountsAndStats();

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

            await refreshCountsAndStats();

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

        const isExplicitCheckbox = card.querySelector('[data-field="is_explicit"]');
        if (isExplicitCheckbox && isExplicitCheckbox.checked !== (originalData[songId].is_explicit || false)) {
            changes.is_explicit = isExplicitCheckbox.checked;
        }

        const isAiGeneratedCheckbox = card.querySelector('[data-field="is_ai_generated"]');
        if (isAiGeneratedCheckbox && isAiGeneratedCheckbox.checked !== (originalData[songId].is_ai_generated || false)) {
            changes.is_ai_generated = isAiGeneratedCheckbox.checked;
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

            await refreshCountsAndStats();

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

            await refreshCountsAndStats();

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
                
                <div class="relations-title ${tokens.length === 0 ? 'missing-relation' : ''}" style="margin-top: 16px;">
                    Blockchain Tokens (${tokens.length})
                    <button class="btn btn-small ${tokens.length === 0 ? 'btn-warning' : 'btn-primary'}" onclick="RelationshipManager.toggleAddTokenForm(${song.id})">
                        ${tokens.length === 0 ? '⚠️ Link Token (Required)' : 'Link Token'}
                    </button>
                </div>

                ${tokens.length === 0 ? '<div class="missing-relation-warning">⚠️ <strong>WARNING:</strong> This song has no blockchain tokens associated. Every song should have at least one token.</div>' : ''}

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
            refreshCountsAndStats();
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
            refreshCountsAndStats();
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
            refreshCountsAndStats();
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
            refreshCountsAndStats();
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
            await refreshCurrentIssues();
            await refreshCountsAndStats();
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
            await refreshCurrentIssues();
            await refreshCountsAndStats();
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
        if (alreadyLinked && !resultsContainerId.includes('bulk')) {
            UIComponents.showMessage('Song is already linked to this token', 'info');
            return;
        }

        const selectedSet = resultsContainerId.includes('fix') ? selectedSongsForFix :
                           resultsContainerId.includes('bulk') ? selectedSongsForLink : selectedSongsForLink;
        const listContainerId = resultsContainerId.includes('fix') ? 'fixSelectedSongsList' :
                               resultsContainerId.includes('bulk') ? 'bulkLinkSelectedSongsList' : 'selectedSongsList';

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
        const searchInputId = resultsContainerId.includes('fix') ? 'fixSongSearchInput' :
                             resultsContainerId.includes('bulk') ? 'bulkLinkSongSearchInput' : 'songSearchInput';
        document.getElementById(searchInputId).value = '';
    }

    static async createAndSelectNewSong(title, tokenId, resultsContainerId) {
        UIComponents.showLoading();

        try {
            // Create the new song and link it to the token
            const result = await APIClient.post(`/api/tokens/${tokenId}/link-song`, { title });

            // Add the newly created song to selection
            const songId = result.song_id;
            const songTitle = title;
            const artists = 'No artists';

            const selectedSet = selectedSongsForLink;
            const listContainerId = 'selectedSongsList';

            if (selectedSet.has(songId)) {
                UIComponents.showMessage('Song already selected', 'info');
            } else {
                selectedSet.add(songId);

                const selectedList = document.getElementById(listContainerId);
                const songItem = document.createElement('div');
                songItem.className = 'selected-song-item';
                songItem.innerHTML = `
                    <span>${UIComponents.escapeHtml(songTitle)} - ${UIComponents.escapeHtml(artists)}</span>
                    <button class="btn btn-small btn-danger" onclick="TokenManager.removeSongFromSelection(${songId}, '${listContainerId}')">Remove</button>
                `;
                selectedList.appendChild(songItem);

                UIComponents.showMessage(`New song "${title}" created and added to selection`, 'success');
            }

            // Clear search results and input
            document.getElementById(resultsContainerId).innerHTML = '';
            document.getElementById('linkNewSongTitle').value = '';

            refreshCountsAndStats();
        } catch (error) {
            console.error('Create song error:', error);
            UIComponents.showMessage(`Failed to create song: ${error.message}`, 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }

    static async searchSongsForBulkLink(query) {
        if (searchTimeout) {
            clearTimeout(searchTimeout);
        }

        const resultsContainer = document.getElementById('bulkLinkSongSearchResults');

        if (!query || query.length < 2) {
            resultsContainer.innerHTML = '';
            return;
        }

        searchTimeout = setTimeout(async () => {
            try {
                const songs = await APIClient.get(`/api/songs/search?q=${encodeURIComponent(query)}`);

                if (songs.length > 0) {
                    resultsContainer.innerHTML = songs.map(song => {
                        const artists = song.artists || [];
                        const artistNames = artists.map(a => typeof a === 'object' ? a.name : a).join(', ');
                        return `
                            <div class="search-result-item"
                                 onclick="TokenManager.selectSongForToken(${song.id}, '${UIComponents.escapeHtml(song.title)}', '${UIComponents.escapeHtml(artistNames)}', false, 'bulkLinkSongSearchResults')">
                                <div><strong>${UIComponents.escapeHtml(song.title)}</strong></div>
                                <div style="font-size: 12px; color: #888;">${UIComponents.escapeHtml(artistNames || 'No artists')}</div>
                            </div>
                        `;
                    }).join('');
                } else {
                    resultsContainer.innerHTML = '<div class="search-result-item">No songs found</div>';
                }
            } catch (error) {
                console.error('Search error:', error);
                resultsContainer.innerHTML = '<div class="search-result-item">Search failed</div>';
            }
        }, 300);
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
            await refreshCurrentIssues();
            await refreshCountsAndStats();
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
            await refreshCurrentIssues();
            await refreshCountsAndStats();
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

    static async showBulkLinkModal() {
        if (selectedItems.size === 0) {
            UIComponents.showMessage('No tokens selected', 'info');
            return;
        }

        ModalManager.createBulkTokenLinkModal();

        const selectedTokenIds = Array.from(selectedItems);
        const tokenNames = selectedTokenIds.map(id => {
            const issueItem = document.querySelector(`div[data-item-id="${id}"] .issue-title`);
            return issueItem ? issueItem.textContent : `Token ${id}`;
        });

        document.getElementById('bulkLinkTokenIds').value = JSON.stringify(selectedTokenIds);
        document.getElementById('bulkLinkTokenNames').innerHTML = tokenNames.map(name =>
            `<div class="token-name-item">${UIComponents.escapeHtml(name)}</div>`
        ).join('');
        document.getElementById('bulkLinkSongSearchInput').value = '';
        document.getElementById('bulkLinkSongSearchResults').innerHTML = '';
        document.getElementById('bulkLinkSelectedSongsList').innerHTML = '';
        selectedSongsForLink.clear();

        ModalManager.show('bulkTokenLinkModal');
    }

    static async editTokenDetails(tokenId, tokenName, policyId, assetName) {
        try {
            UIComponents.showLoading();

            // Fetch full token metadata
            const tokenData = await APIClient.get(`/api/tokens/${tokenId}`);

            // Create modal with full metadata
            ModalManager.createEditTokenModal(tokenData);

            document.getElementById('editTokenId').value = tokenId;
            document.getElementById('editTokenPolicyId').value = tokenData.policy_id || policyId || '';
            document.getElementById('editTokenAssetName').value = tokenData.asset_name || assetName || '';

            ModalManager.show('editTokenModal');
        } catch (error) {
            console.error('Failed to load token details:', error);
            // Fall back to basic modal if fetch fails
            ModalManager.createEditTokenModal(null);

            document.getElementById('editTokenId').value = tokenId;
            document.getElementById('editTokenPolicyId').value = policyId || '';
            document.getElementById('editTokenAssetName').value = assetName || '';

            ModalManager.show('editTokenModal');
            UIComponents.showMessage('Failed to load full token metadata', 'warning');
        } finally {
            UIComponents.hideLoading();
        }
    }

    static async saveTokenDetails() {
        const tokenId = document.getElementById('editTokenId').value;
        const policyId = document.getElementById('editTokenPolicyId').value.trim();
        const assetName = document.getElementById('editTokenAssetName').value.trim();

        if (!policyId || !assetName) {
            UIComponents.showMessage('Policy ID and Asset Name are required', 'error');
            return;
        }

        UIComponents.showLoading();

        try {
            const result = await APIClient.put(`/api/tokens/${tokenId}`, {
                policy_id: policyId,
                asset_name: assetName
            });

            UIComponents.showMessage('Token details updated successfully', 'success');
            TokenManager.closeEditTokenModal();
            await refreshCurrentIssues();
            await refreshCountsAndStats();
        } catch (error) {
            console.error('Update token error:', error);
            UIComponents.showMessage(`Failed to update token: ${error.message}`, 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }

    static closeEditTokenModal() {
        ModalManager.hide('editTokenModal');
    }

    static toggleTokenMetadataJson() {
        const metadataElement = document.getElementById('tokenMetadataJson');
        const buttonElement = document.getElementById('toggleTokenMetadataBtn');

        if (metadataElement && buttonElement) {
            if (metadataElement.style.display === 'none') {
                metadataElement.style.display = 'block';
                buttonElement.textContent = 'Hide';
            } else {
                metadataElement.style.display = 'none';
                buttonElement.textContent = 'Show';
            }
        }
    }

    static async bulkLinkTokensToSongs() {
        const tokenIds = JSON.parse(document.getElementById('bulkLinkTokenIds').value);
        const songIds = Array.from(selectedSongsForLink);

        if (songIds.length === 0) {
            UIComponents.showMessage('Please select at least one song', 'error');
            return;
        }

        UIComponents.showLoading();

        try {
            const promises = tokenIds.map(tokenId =>
                APIClient.post(`/api/tokens/${tokenId}/bulk-link-songs`, { songIds })
            );

            await Promise.all(promises);

            UIComponents.showMessage(`Successfully linked ${tokenIds.length} tokens to ${songIds.length} song(s)`, 'success');
            TokenManager.closeBulkLinkModal();
            selectedItems.clear();
            await refreshCurrentIssues();
            await refreshCountsAndStats();
        } catch (error) {
            console.error('Bulk link tokens error:', error);
            UIComponents.showMessage(`Failed to link tokens: ${error.message}`, 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }

    static closeBulkLinkModal() {
        ModalManager.hide('bulkTokenLinkModal');
        selectedSongsForLink.clear();
    }

    static async addSongByTitle(modalType) {
        const isLinkModal = modalType === 'linkTokenModal';
        const isBulkLinkModal = modalType === 'bulkTokenLinkModal';

        const inputId = isLinkModal ? 'linkNewSongTitle' : 'bulkLinkNewSongTitle';
        const titleInput = document.getElementById(inputId);
        const title = titleInput.value.trim();

        if (!title) {
            UIComponents.showMessage('Please enter a song title', 'error');
            return;
        }

        UIComponents.showLoading();

        try {
            if (isLinkModal) {
                // For single link modal, search for songs and display matches for selection
                const tokenId = document.getElementById('linkTokenId').value;
                const songs = await APIClient.get(`/api/songs/search-for-token?q=${encodeURIComponent(title)}&tokenId=${tokenId}`);

                const resultsContainer = document.getElementById('songSearchResults');

                if (songs.length > 0) {
                    // Display all matching songs for user to select
                    resultsContainer.innerHTML = songs.map(song => `
                        <div class="search-result-item ${song.already_linked ? 'already-linked' : ''}"
                             onclick="TokenManager.selectSongForToken(${song.id}, '${UIComponents.escapeHtml(song.title)}', '${UIComponents.escapeHtml(song.artists || '')}', ${song.already_linked}, 'songSearchResults')">
                            <div><strong>${UIComponents.escapeHtml(song.title)}</strong></div>
                            <div style="font-size: 12px; color: #888;">${UIComponents.escapeHtml(song.artists || 'No artists')}</div>
                            ${song.already_linked ? '<div style="font-size: 11px; color: #66b2ff;">Already linked</div>' : ''}
                        </div>
                    `).join('');

                    // Add option to create new song if no exact match
                    const hasExactMatch = songs.some(s => s.title.toLowerCase() === title.toLowerCase());
                    if (!hasExactMatch) {
                        resultsContainer.innerHTML += `
                            <div class="search-result-item" style="border-top: 2px solid #4CAF50; margin-top: 8px; padding-top: 8px;"
                                 onclick="TokenManager.createAndSelectNewSong('${UIComponents.escapeHtml(title)}', ${tokenId}, 'songSearchResults')">
                                <div style="color: #4CAF50;"><strong>+ Create new song: "${UIComponents.escapeHtml(title)}"</strong></div>
                                <div style="font-size: 12px; color: #888;">Create a new song with this title</div>
                            </div>
                        `;
                    }

                    UIComponents.showMessage(`Found ${songs.length} matching song(s). Select one to add.`, 'info');
                } else {
                    // No matches found, offer to create new song
                    resultsContainer.innerHTML = `
                        <div class="search-result-item" style="border: 2px solid #4CAF50;"
                             onclick="TokenManager.createAndSelectNewSong('${UIComponents.escapeHtml(title)}', ${tokenId}, 'songSearchResults')">
                            <div style="color: #4CAF50;"><strong>+ Create new song: "${UIComponents.escapeHtml(title)}"</strong></div>
                            <div style="font-size: 12px; color: #888;">No existing songs found. Click to create and select.</div>
                        </div>
                    `;
                    UIComponents.showMessage(`No songs found with title "${title}". Click result to create new song.`, 'info');
                }

                // Don't clear input yet - let user modify search if needed
                titleInput.select();
            } else if (isBulkLinkModal) {
                // For bulk link modal, create song and add to selection
                // First search for existing song
                const songs = await APIClient.get(`/api/songs/search?q=${encodeURIComponent(title)}`);
                let songId;
                let songTitle = title;
                let artists = '';

                if (songs.length > 0 && songs[0].title.toLowerCase() === title.toLowerCase()) {
                    // Exact match found
                    songId = songs[0].id;
                    songTitle = songs[0].title;
                    const artistsArray = songs[0].artists || [];
                    artists = artistsArray.map(a => typeof a === 'object' ? a.name : a).join(', ');
                } else {
                    // Create new song - use the first token in the bulk selection
                    const tokenIds = JSON.parse(document.getElementById('bulkLinkTokenIds').value);
                    if (tokenIds.length === 0) {
                        UIComponents.showMessage('No tokens selected', 'error');
                        return;
                    }

                    const result = await APIClient.post(`/api/tokens/${tokenIds[0]}/link-song`, { title });
                    songId = result.song_id;
                    songTitle = title;
                    artists = 'No artists';
                    refreshCountsAndStats();
                }

                // Add to selection
                if (selectedSongsForLink.has(songId)) {
                    UIComponents.showMessage('Song already selected', 'info');
                } else {
                    selectedSongsForLink.add(songId);

                    const selectedList = document.getElementById('bulkLinkSelectedSongsList');
                    const songItem = document.createElement('div');
                    songItem.className = 'selected-song-item';
                    songItem.innerHTML = `
                        <span>${UIComponents.escapeHtml(songTitle)} - ${UIComponents.escapeHtml(artists)}</span>
                        <button class="btn btn-small btn-danger" onclick="TokenManager.removeSongFromSelection(${songId}, 'bulkLinkSelectedSongsList')">Remove</button>
                    `;
                    selectedList.appendChild(songItem);

                    UIComponents.showMessage(`Song "${title}" added to selection`, 'success');
                }

                // Clear input
                titleInput.value = '';
            }
        } catch (error) {
            console.error('Add song error:', error);
            UIComponents.showMessage(`Failed to add song: ${error.message}`, 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }

    static async showBulkEditTokensModal() {
        if (selectedItems.size === 0) {
            UIComponents.showMessage('No tokens selected', 'info');
            return;
        }

        ModalManager.createBulkEditTokensModal();

        const selectedTokenIds = Array.from(selectedItems);
        const tokenData = selectedTokenIds.map(id => {
            const issueItem = document.querySelector(`div[data-item-id="${id}"]`);
            const nameElement = issueItem ? issueItem.querySelector('.issue-title') : null;
            return {
                id,
                name: nameElement ? nameElement.textContent : `Token ${id}`
            };
        });

        document.getElementById('bulkEditTokenIds').value = JSON.stringify(selectedTokenIds);
        document.getElementById('bulkEditTokenNames').innerHTML = tokenData.map(token =>
            `<div class="token-name-item">${UIComponents.escapeHtml(token.name)}</div>`
        ).join('');

        // Clear all input fields
        document.getElementById('bulkEditTokenName').value = '';
        document.getElementById('bulkEditTokenPolicyId').value = '';
        document.getElementById('bulkEditTokenAssetName').value = '';
        document.getElementById('bulkEditTokenImageUrl').value = '';
        document.getElementById('bulkEditTokenImageType').value = '';
        document.getElementById('bulkEditTokenImagePrimary').checked = false;
        document.getElementById('bulkEditTokenAudioUrl').value = '';
        document.getElementById('bulkEditTokenAudioType').value = '';
        document.getElementById('bulkEditTokenAudioCid').value = '';

        ModalManager.show('bulkEditTokensModal');
    }

    static async bulkSaveTokenDetails() {
        const tokenIds = JSON.parse(document.getElementById('bulkEditTokenIds').value);
        const name = document.getElementById('bulkEditTokenName').value.trim();
        const policyId = document.getElementById('bulkEditTokenPolicyId').value.trim();
        const assetName = document.getElementById('bulkEditTokenAssetName').value.trim();
        const imageUrl = document.getElementById('bulkEditTokenImageUrl').value.trim();
        const imageType = document.getElementById('bulkEditTokenImageType').value;
        const imagePrimary = document.getElementById('bulkEditTokenImagePrimary').checked;
        const audioUrl = document.getElementById('bulkEditTokenAudioUrl').value.trim();
        const audioType = document.getElementById('bulkEditTokenAudioType').value;
        const audioCid = document.getElementById('bulkEditTokenAudioCid').value.trim();

        // Build the updates object - only include fields that have values
        const updates = {};
        if (name) updates.name = name;
        if (policyId) updates.policy_id = policyId;
        if (assetName) updates.asset_name = assetName;

        const hasTokenUpdates = Object.keys(updates).length > 0;
        const hasImageUpdates = imageUrl && imageType;
        const hasAudioUpdates = audioUrl && audioType;

        if (!hasTokenUpdates && !hasImageUpdates && !hasAudioUpdates) {
            UIComponents.showMessage('Please fill in at least one field to update', 'error');
            return;
        }

        UIComponents.showLoading();

        try {
            const promises = [];

            // Update token metadata
            if (hasTokenUpdates) {
                tokenIds.forEach(tokenId => {
                    promises.push(APIClient.put(`/api/tokens/${tokenId}`, updates));
                });
            }

            // Add images
            if (hasImageUpdates) {
                tokenIds.forEach(tokenId => {
                    promises.push(APIClient.post(`/api/tokens/${tokenId}/images`, {
                        image_url: imageUrl,
                        image_type: imageType,
                        is_primary: imagePrimary
                    }));
                });
            }

            // Add audio files
            if (hasAudioUpdates) {
                promises.push(APIClient.post('/api/tokens/bulk-add-audio', {
                    tokenIds,
                    audioUrl,
                    audioType,
                    ipfsCid: audioCid
                }));
            }

            await Promise.all(promises);

            const updatedItems = [];
            if (hasTokenUpdates) updatedItems.push('metadata');
            if (hasImageUpdates) updatedItems.push('images');
            if (hasAudioUpdates) updatedItems.push('audio files');

            UIComponents.showMessage(`Successfully updated ${updatedItems.join(', ')} for ${tokenIds.length} tokens`, 'success');
            TokenManager.closeBulkEditTokensModal();
            selectedItems.clear();
            await refreshCurrentIssues();
            await refreshCountsAndStats();
        } catch (error) {
            console.error('Bulk update tokens error:', error);
            UIComponents.showMessage(`Failed to update tokens: ${error.message}`, 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }

    static closeBulkEditTokensModal() {
        ModalManager.hide('bulkEditTokensModal');
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
            await refreshCurrentIssues();
            await refreshCountsAndStats();
        } catch (error) {
            console.error('Bulk fix tokens error:', error);
            UIComponents.showMessage(`Failed to fix tokens: ${error.message}`, 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }

    static async showBulkAddImageModal() {
        if (selectedItems.size === 0) {
            UIComponents.showMessage('No tokens selected', 'info');
            return;
        }

        ModalManager.createBulkAddImageModal();

        const selectedTokenIds = Array.from(selectedItems);
        const tokenData = selectedTokenIds.map(id => {
            const issueItem = document.querySelector(`div[data-item-id="${id}"]`);
            const nameElement = issueItem ? issueItem.querySelector('.issue-title') : null;
            return {
                id,
                name: nameElement ? nameElement.textContent : `Token ${id}`
            };
        });

        document.getElementById('bulkAddImageTokenIds').value = JSON.stringify(selectedTokenIds);
        document.getElementById('bulkAddImageTokenNames').innerHTML = tokenData.map(token =>
            `<div class="token-name-item">${UIComponents.escapeHtml(token.name)}</div>`
        ).join('');

        document.getElementById('bulkAddImageUrl').value = '';
        document.getElementById('bulkAddImageType').value = 'cover';
        document.getElementById('bulkAddImagePrimary').checked = false;

        ModalManager.show('bulkAddImageModal');
    }

    static async bulkAddImage() {
        const tokenIds = JSON.parse(document.getElementById('bulkAddImageTokenIds').value);
        const imageUrl = document.getElementById('bulkAddImageUrl').value.trim();
        const imageType = document.getElementById('bulkAddImageType').value;
        const isPrimary = document.getElementById('bulkAddImagePrimary').checked;

        if (!imageUrl) {
            UIComponents.showMessage('Please enter an image URL', 'error');
            return;
        }

        UIComponents.showLoading();

        try {
            const promises = tokenIds.map(tokenId =>
                APIClient.post(`/api/tokens/${tokenId}/images`, {
                    image_url: imageUrl,
                    image_type: imageType,
                    is_primary: isPrimary
                })
            );

            await Promise.all(promises);

            UIComponents.showMessage(`Successfully added image to ${tokenIds.length} tokens`, 'success');
            TokenManager.closeBulkAddImageModal();
            selectedItems.clear();
            await refreshCurrentIssues();
            await refreshCountsAndStats();
        } catch (error) {
            console.error('Bulk add image error:', error);
            UIComponents.showMessage(`Failed to add image: ${error.message}`, 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }

    static closeBulkAddImageModal() {
        ModalManager.hide('bulkAddImageModal');
    }

    static async showBulkAddAudioModal() {
        if (selectedItems.size === 0) {
            UIComponents.showMessage('No tokens selected', 'info');
            return;
        }

        ModalManager.createBulkAddAudioModal();

        const selectedTokenIds = Array.from(selectedItems);
        const tokenData = selectedTokenIds.map(id => {
            const issueItem = document.querySelector(`div[data-item-id="${id}"]`);
            const nameElement = issueItem ? issueItem.querySelector('.issue-title') : null;
            return {
                id,
                name: nameElement ? nameElement.textContent : `Token ${id}`
            };
        });

        document.getElementById('bulkAddAudioTokenIds').value = JSON.stringify(selectedTokenIds);
        document.getElementById('bulkAddAudioTokenNames').innerHTML = tokenData.map(token =>
            `<div class="token-name-item">${UIComponents.escapeHtml(token.name)}</div>`
        ).join('');

        document.getElementById('bulkAddAudioUrl').value = '';
        document.getElementById('bulkAddAudioType').value = 'mp3';
        document.getElementById('bulkAddAudioCid').value = '';

        ModalManager.show('bulkAddAudioModal');
    }

    static async bulkAddAudio() {
        const tokenIds = JSON.parse(document.getElementById('bulkAddAudioTokenIds').value);
        const audioUrl = document.getElementById('bulkAddAudioUrl').value.trim();
        const audioType = document.getElementById('bulkAddAudioType').value;
        const ipfsCid = document.getElementById('bulkAddAudioCid').value.trim();

        if (!audioUrl) {
            UIComponents.showMessage('Please enter an audio file URL', 'error');
            return;
        }

        UIComponents.showLoading();

        try {
            const result = await APIClient.post('/api/tokens/bulk-add-audio', {
                tokenIds,
                audioUrl,
                audioType,
                ipfsCid
            });

            UIComponents.showMessage(result.message || `Successfully added audio to ${tokenIds.length} tokens`, 'success');
            TokenManager.closeBulkAddAudioModal();
            selectedItems.clear();
            await refreshCurrentIssues();
            await refreshCountsAndStats();
        } catch (error) {
            console.error('Bulk add audio error:', error);
            UIComponents.showMessage(`Failed to add audio: ${error.message}`, 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }

    static closeBulkAddAudioModal() {
        ModalManager.hide('bulkAddAudioModal');
    }
}

class AssetManager {
    static async editAsset(assetId) {
        try {
            UIComponents.showLoading();
            const asset = await APIClient.get(`/api/assets/${assetId}`);

            // Get existing images for this asset
            const images = await APIClient.get(`/api/assets/${assetId}/images`);

            AssetManager.showAssetModal(asset, images);
        } catch (error) {
            console.error('Failed to load asset:', error);
            UIComponents.showMessage('Failed to load asset', 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }

    static showAssetModal(asset, images) {
        const existingModal = document.getElementById('assetEditModal');
        if (existingModal) {
            existingModal.remove();
        }

        const songs = asset.songs || [];
        const songsHtml = songs.length > 0
            ? songs.map(s => `
                <div class="relation-item" id="asset-song-${s.id}">
                    <div class="relation-info">
                        <div class="relation-name">${UIComponents.escapeHtml(s.title)}</div>
                        <div class="relation-meta">Song ID: ${s.id}</div>
                    </div>
                    <div class="relation-actions">
                        <button class="btn btn-small btn-primary" onclick="SongEditor.editSong(${s.id})">Edit Song</button>
                        <button class="btn btn-small btn-danger" onclick="AssetManager.unlinkSong(${asset.id}, ${s.id})">Unlink</button>
                    </div>
                </div>
            `).join('')
            : '<div class="empty-state">No songs linked to this asset</div>';

        const imagesHtml = images.length > 0
            ? images.map(img => `
                <div class="relation-item" id="asset-image-${img.id}">
                    <div class="relation-info">
                        <div class="relation-type">${img.image_type || 'Unknown'}</div>
                        <div class="relation-name">${UIComponents.escapeHtml(img.image_url?.substring(0, 50) || 'No URL')}...</div>
                        ${img.is_primary ? '<span class="primary-badge">Primary</span>' : ''}
                        ${img.ipfs_cid ? `<div class="relation-meta">CID: ${img.ipfs_cid.substring(0, 20)}...</div>` : ''}
                    </div>
                    <div class="relation-actions">
                        <button class="btn btn-small btn-danger" onclick="AssetManager.unlinkImage(${asset.id}, ${img.id})">Unlink</button>
                    </div>
                </div>
            `).join('')
            : '<div class="empty-state">No images linked to this asset</div>';

        const modalHtml = `
            <div id="assetEditModal" class="modal" style="display: block;">
                <div class="modal-content" style="max-width: 900px; max-height: 90vh; overflow-y: auto;">
                    <span class="close" onclick="AssetManager.closeModal()">&times;</span>
                    <h3>Edit Asset: ${UIComponents.escapeHtml(asset.asset_name)}</h3>

                    <div class="metadata-section">
                        <h4>Asset Metadata</h4>
                        <div class="metadata-row">
                            <span class="metadata-label">Asset ID:</span>
                            <span>${asset.id}</span>
                        </div>

                        <div class="metadata-row">
                            <span class="metadata-label">Policy ID:</span>
                            <span style="font-family: monospace; font-size: 11px;">${UIComponents.escapeHtml(asset.policy_id)}</span>
                        </div>

                        <div class="metadata-row">
                            <span class="metadata-label">Asset Name:</span>
                            <span style="font-family: monospace; font-size: 11px;">${UIComponents.escapeHtml(asset.asset_name)}</span>
                        </div>

                        ${asset.name ? `
                        <div class="metadata-row">
                            <span class="metadata-label">Name:</span>
                            <span>${UIComponents.escapeHtml(asset.name)}</span>
                        </div>
                        ` : ''}

                        ${asset.asset_fingerprint ? `
                        <div class="metadata-row">
                            <span class="metadata-label">Fingerprint:</span>
                            <span style="font-family: monospace; font-size: 11px;">${UIComponents.escapeHtml(asset.asset_fingerprint)}</span>
                        </div>
                        ` : ''}

                        ${asset.data_label ? `
                        <div class="metadata-row">
                            <span class="metadata-label">Standard:</span>
                            <span>${asset.data_label === 721 ? 'CIP-25 (NFT)' : asset.data_label === 100 ? 'CIP-68 (Datum)' : asset.data_label}</span>
                        </div>
                        ` : ''}

                        ${asset.release_type ? `
                        <div class="metadata-row">
                            <span class="metadata-label">Release Type:</span>
                            <span>${UIComponents.escapeHtml(asset.release_type)}</span>
                        </div>
                        ` : ''}

                        ${asset.image_urls && asset.image_urls.length > 0 ? `
                        <div class="metadata-row">
                            <span class="metadata-label">Metadata Images:</span>
                            <div style="flex: 1;">
                                ${asset.image_urls.map(url => `<div style="font-size: 11px; margin-bottom: 4px; word-break: break-all;">${UIComponents.escapeHtml(url)}</div>`).join('')}
                            </div>
                        </div>
                        ` : ''}

                        ${asset.metadata ? `
                        <div class="metadata-row" style="flex-direction: column; align-items: stretch;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                <span class="metadata-label" style="margin: 0;">Full Metadata (JSON):</span>
                                <button class="btn btn-small btn-secondary" onclick="AssetManager.toggleMetadataJson(${asset.id})" id="toggleMetadataBtn-${asset.id}">Show</button>
                            </div>
                            <pre id="metadataJson-${asset.id}" style="display: none; background: #1a1a1a; padding: 12px; border-radius: 4px; overflow-x: auto; max-height: 400px; margin: 0;"><code>${UIComponents.escapeHtml(JSON.stringify(asset.metadata, null, 2))}</code></pre>
                        </div>
                        ` : ''}
                    </div>

                    <div class="relations-section" style="margin-top: 20px;">
                        <div class="relations-title ${songs.length === 0 ? 'missing-relation' : ''}">
                            Linked Songs (${songs.length})
                            <button class="btn btn-small ${songs.length === 0 ? 'btn-warning' : 'btn-primary'}"
                                    onclick="AssetManager.toggleAddSongForm(${asset.id})">
                                ${songs.length === 0 ? '⚠️ Add Song' : 'Add Song'}
                            </button>
                        </div>

                        ${songs.length === 0 ? '<div class="missing-relation-warning">⚠️ <strong>INFO:</strong> This asset has no songs linked.</div>' : ''}

                        <div id="addSongForm-${asset.id}" class="add-form" style="display: none;">
                            <div class="form-row">
                                <div class="search-dropdown">
                                    <input type="text" placeholder="Search songs by title or artist..." id="songSearch-${asset.id}"
                                           oninput="AssetManager.searchSongs(${asset.id}, this.value)" autocomplete="off">
                                    <div class="search-results" id="songResults-${asset.id}"></div>
                                </div>
                            </div>
                            <div class="form-row" style="margin-top: 10px;">
                                <span style="color: #888; font-size: 12px;">Or create a new song:</span>
                            </div>
                            <div class="form-row">
                                <input type="text" placeholder="New song title" id="newSongTitle-${asset.id}" class="form-input">
                                <button class="btn btn-small btn-primary" onclick="AssetManager.createAndLinkSong(${asset.id})">Create & Link</button>
                            </div>
                            <div class="form-row">
                                <button class="btn btn-small btn-secondary" onclick="AssetManager.toggleAddSongForm(${asset.id})">Cancel</button>
                            </div>
                        </div>

                        <div id="assetSongsList-${asset.id}">
                            ${songsHtml}
                        </div>
                    </div>

                    <div class="relations-section" style="margin-top: 20px;">
                        <div class="relations-title ${images.length === 0 ? 'missing-relation' : ''}">
                            Images (${images.length})
                            <button class="btn btn-small ${images.length === 0 ? 'btn-warning' : 'btn-primary'}"
                                    onclick="AssetManager.toggleAddImageForm(${asset.id})">
                                ${images.length === 0 ? '⚠️ Add Image (Required)' : 'Add Image'}
                            </button>
                        </div>

                        ${images.length === 0 ? '<div class="missing-relation-warning">⚠️ <strong>WARNING:</strong> This asset has no images. Please add at least one image.</div>' : ''}

                        <div id="addImageForm-${asset.id}" class="add-form" style="display: none;">
                            <div class="form-row">
                                <span style="color: #888; font-size: 12px;">Search existing images:</span>
                            </div>
                            <div class="form-row">
                                <div class="search-dropdown">
                                    <input type="text" placeholder="Search images by URL or CID..." id="imageSearch-${asset.id}"
                                           oninput="AssetManager.searchImages(${asset.id}, this.value)" autocomplete="off">
                                    <div class="search-results" id="imageResults-${asset.id}"></div>
                                </div>
                            </div>
                            <div class="form-row" style="margin-top: 15px;">
                                <span style="color: #888; font-size: 12px;">Or create a new image:</span>
                            </div>
                            <div class="form-row">
                                <input type="text" placeholder="Image URL" id="newImageUrl-${asset.id}" class="form-input">
                            </div>
                            <div class="form-row">
                                <select id="newImageType-${asset.id}" class="form-input">
                                    <option value="cover">Cover</option>
                                    <option value="thumbnail">Thumbnail</option>
                                    <option value="banner">Banner</option>
                                    <option value="artwork">Artwork</option>
                                </select>
                                <input type="text" placeholder="IPFS CID (optional)" id="newImageCid-${asset.id}" class="form-input">
                            </div>
                            <div class="form-row">
                                <label><input type="checkbox" id="imagePrimary-${asset.id}"> Primary Image</label>
                                <button class="btn btn-small btn-primary" onclick="AssetManager.createAndLinkImage(${asset.id})">Create & Link</button>
                                <button class="btn btn-small btn-secondary" onclick="AssetManager.toggleAddImageForm(${asset.id})">Cancel</button>
                            </div>
                        </div>

                        <div id="assetImagesList-${asset.id}">
                            ${imagesHtml}
                        </div>
                    </div>

                    <div class="actions" style="margin-top: 20px;">
                        <button class="btn btn-secondary" onclick="AssetManager.closeModal()">Close</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    static toggleAddImageForm(assetId) {
        const form = document.getElementById(`addImageForm-${assetId}`);
        form.style.display = form.style.display === 'none' ? 'block' : 'none';

        if (form.style.display === 'block') {
            document.getElementById(`imageSearch-${assetId}`).focus();
        }
    }

    static async searchImages(assetId, query) {
        const resultsContainer = document.getElementById(`imageResults-${assetId}`);

        if (!query || query.length < 2) {
            resultsContainer.style.display = 'none';
            return;
        }

        try {
            const images = await APIClient.get(`/api/images/search?q=${encodeURIComponent(query)}`);

            if (images.length > 0) {
                resultsContainer.innerHTML = images.map(img => `
                    <div class="search-result-item" onclick="AssetManager.selectImage(${assetId}, ${img.id}, '${UIComponents.escapeHtml(img.image_url || '')}')">
                        <div><strong>${UIComponents.escapeHtml(img.image_url?.substring(0, 60) || 'No URL')}...</strong></div>
                        <div style="font-size: 11px; color: #6c757d;">
                            ${img.image_type ? `Type: ${img.image_type}` : ''}
                            ${img.ipfs_cid ? `| CID: ${img.ipfs_cid.substring(0, 16)}...` : ''}
                        </div>
                    </div>
                `).join('');
                resultsContainer.style.display = 'block';
            } else {
                resultsContainer.innerHTML = '<div class="search-result-item">No images found</div>';
                resultsContainer.style.display = 'block';
            }
        } catch (error) {
            console.error('Image search error:', error);
        }
    }

    static async selectImage(assetId, imageId, imageUrl) {
        const isPrimary = document.getElementById(`imagePrimary-${assetId}`).checked;

        try {
            await APIClient.post(`/api/assets/${assetId}/images`, {
                imageId,
                isPrimary
            });

            UIComponents.showMessage('Image linked successfully', 'success');

            // Close search dropdown
            document.getElementById(`imageResults-${assetId}`).style.display = 'none';
            document.getElementById(`imageSearch-${assetId}`).value = '';
            document.getElementById(`imagePrimary-${assetId}`).checked = false;

            // Reload the modal
            AssetManager.closeModal();
            AssetManager.editAsset(assetId);

            // Refresh the issues list if we're on that view, and counts/stats regardless
            if (currentIssueType === 'no-images') {
                await refreshCurrentIssues();
            }
            await refreshCountsAndStats();
        } catch (error) {
            console.error('Link image error:', error);
            UIComponents.showMessage('Failed to link image', 'error');
        }
    }

    static async unlinkImage(assetId, imageId) {
        if (!confirm('Are you sure you want to unlink this image from the asset?')) {
            return;
        }

        try {
            await APIClient.delete(`/api/assets/${assetId}/images/${imageId}`);
            UIComponents.showMessage('Image unlinked successfully', 'success');

            // Reload the modal
            AssetManager.closeModal();
            AssetManager.editAsset(assetId);

            // Refresh the issues list if we're on that view, and counts/stats regardless
            if (currentIssueType === 'no-images') {
                await refreshCurrentIssues();
            }
            await refreshCountsAndStats();
        } catch (error) {
            console.error('Unlink image error:', error);
            UIComponents.showMessage('Failed to unlink image', 'error');
        }
    }

    static toggleAddSongForm(assetId) {
        const form = document.getElementById(`addSongForm-${assetId}`);
        form.style.display = form.style.display === 'none' ? 'block' : 'none';

        if (form.style.display === 'block') {
            document.getElementById(`songSearch-${assetId}`).focus();
        }
    }

    static async searchSongs(assetId, query) {
        const resultsContainer = document.getElementById(`songResults-${assetId}`);

        if (!query || query.length < 2) {
            resultsContainer.style.display = 'none';
            return;
        }

        try {
            const songs = await APIClient.get(`/api/songs/search?q=${encodeURIComponent(query)}`);

            if (songs.length > 0) {
                resultsContainer.innerHTML = songs.map(song => {
                    const artistsStr = song.artists && song.artists.length > 0
                        ? song.artists.map(a => a.name).join(', ')
                        : 'No artists';
                    return `
                        <div class="search-result-item" onclick="AssetManager.selectSong(${assetId}, ${song.id})">
                            <div><strong>${UIComponents.escapeHtml(song.title)}</strong></div>
                            <div style="font-size: 11px; color: #6c757d;">
                                Artists: ${UIComponents.escapeHtml(artistsStr)} | ID: ${song.id}
                            </div>
                        </div>
                    `;
                }).join('');
                resultsContainer.style.display = 'block';
            } else {
                resultsContainer.innerHTML = '<div class="search-result-item">No songs found</div>';
                resultsContainer.style.display = 'block';
            }
        } catch (error) {
            console.error('Song search error:', error);
        }
    }

    static async selectSong(assetId, songId) {
        try {
            await APIClient.post(`/api/songs/${songId}/tokens/${assetId}/link`, {
                is_primary: false
            });

            UIComponents.showMessage('Song linked successfully', 'success');

            // Clear search
            document.getElementById(`songResults-${assetId}`).style.display = 'none';
            document.getElementById(`songSearch-${assetId}`).value = '';

            // Reload the modal
            AssetManager.closeModal();
            AssetManager.editAsset(assetId);

            // Refresh the issues list if we're on that view, and counts/stats regardless
            if (currentIssueType === 'no-images') {
                await refreshCurrentIssues();
            }
            await refreshCountsAndStats();
        } catch (error) {
            console.error('Link song error:', error);
            UIComponents.showMessage('Failed to link song', 'error');
        }
    }

    static async createAndLinkSong(assetId) {
        const title = document.getElementById(`newSongTitle-${assetId}`).value.trim();

        if (!title) {
            UIComponents.showMessage('Please enter a song title', 'error');
            return;
        }

        UIComponents.showLoading();

        try {
            const result = await APIClient.post(`/api/tokens/${assetId}/link-song`, {
                title: title
            });

            UIComponents.showMessage(result.message || 'Song created and linked successfully', 'success');

            // Clear input
            document.getElementById(`newSongTitle-${assetId}`).value = '';

            // Reload the modal
            AssetManager.closeModal();
            AssetManager.editAsset(assetId);

            // Refresh the issues list if we're on that view, and counts/stats regardless
            if (currentIssueType === 'no-images') {
                await refreshCurrentIssues();
            }
            await refreshCountsAndStats();
        } catch (error) {
            console.error('Create and link song error:', error);
            UIComponents.showMessage('Failed to create and link song', 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }

    static async unlinkSong(assetId, songId) {
        if (!confirm('Are you sure you want to unlink this song from the asset?')) {
            return;
        }

        try {
            await APIClient.delete(`/api/songs/${songId}/tokens/${assetId}/unlink`);
            UIComponents.showMessage('Song unlinked successfully', 'success');

            // Reload the modal
            AssetManager.closeModal();
            AssetManager.editAsset(assetId);

            // Refresh the issues list if we're on that view, and counts/stats regardless
            if (currentIssueType === 'no-images') {
                await refreshCurrentIssues();
            }
            await refreshCountsAndStats();
        } catch (error) {
            console.error('Unlink song error:', error);
            UIComponents.showMessage('Failed to unlink song', 'error');
        }
    }

    static async createAndLinkImage(assetId) {
        const imageUrl = document.getElementById(`newImageUrl-${assetId}`).value.trim();
        const imageType = document.getElementById(`newImageType-${assetId}`).value;
        const ipfsCid = document.getElementById(`newImageCid-${assetId}`).value.trim();
        const isPrimary = document.getElementById(`imagePrimary-${assetId}`).checked;

        if (!imageUrl) {
            UIComponents.showMessage('Please enter an image URL', 'error');
            return;
        }

        UIComponents.showLoading();

        try {
            const result = await APIClient.post(`/api/tokens/${assetId}/images`, {
                image_url: imageUrl,
                image_type: imageType,
                ipfs_cid: ipfsCid || null,
                is_primary: isPrimary
            });

            UIComponents.showMessage(result.message || 'Image created and linked successfully', 'success');

            // Clear inputs
            document.getElementById(`newImageUrl-${assetId}`).value = '';
            document.getElementById(`newImageCid-${assetId}`).value = '';
            document.getElementById(`imagePrimary-${assetId}`).checked = false;

            // Reload the modal
            AssetManager.closeModal();
            AssetManager.editAsset(assetId);

            // Refresh the issues list if we're on that view, and counts/stats regardless
            if (currentIssueType === 'no-images') {
                await refreshCurrentIssues();
            }
            await refreshCountsAndStats();
        } catch (error) {
            console.error('Create and link image error:', error);
            UIComponents.showMessage('Failed to create and link image', 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }

    static toggleMetadataJson(assetId) {
        const metadataElement = document.getElementById(`metadataJson-${assetId}`);
        const buttonElement = document.getElementById(`toggleMetadataBtn-${assetId}`);

        if (metadataElement.style.display === 'none') {
            metadataElement.style.display = 'block';
            buttonElement.textContent = 'Hide';
        } else {
            metadataElement.style.display = 'none';
            buttonElement.textContent = 'Show';
        }
    }

    static closeModal() {
        const modal = document.getElementById('assetEditModal');
        if (modal) {
            modal.remove();
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

function addContributorSection(songContainer, song) {
    const contributorSection = document.createElement('div');
    contributorSection.className = 'contributor-section';
    contributorSection.innerHTML = `
        <h4>Contributors</h4>
        <div class="contributors-list" id="contributors-${song.id}">
            ${song.contributors ? song.contributors.map(c => `
                <div class="contributor-tag">
                    <span>${escapeHtml(c.name)} (${escapeHtml(c.role)})</span>
                    <button onclick="removeContributor(${song.id}, ${c.id})" class="remove-tag">×</button>
                </div>
            `).join('') : ''}
        </div>
        <div class="add-contributor">
            <input type="text" 
                   id="contributorSearch-${song.id}" 
                   placeholder="Search contributors..." 
                   onkeyup="searchContributors(this.value, ${song.id})"
                   onkeydown="handleContributorKeyDown(event, ${song.id})">
            <div id="contributorResults-${song.id}" class="search-results"></div>
        </div>
    `;
    return contributorSection;
}

// 3. Add search functionality for contributors
async function searchContributors(query, songId) {
    const resultsContainer = document.getElementById(`contributorResults-${songId}`);
    
    if (!query || query.length < 2) {
        resultsContainer.style.display = 'none';
        return;
    }
    
    try {
        const response = await fetch(`/api/contributors/search?q=${encodeURIComponent(query)}`);
        const contributors = await response.json();
        
        if (contributors.length > 0) {
            resultsContainer.innerHTML = contributors.map(contributor => `
                <div class="search-result-item" onclick="addContributor(${songId}, ${contributor.id}, '${escapeHtml(contributor.name)}')">
                    <div><strong>${escapeHtml(contributor.name)}</strong></div>
                    ${contributor.ipi ? `<div style="font-size: 11px;">IPI: ${contributor.ipi}</div>` : ''}
                    ${contributor.isni ? `<div style="font-size: 11px;">ISNI: ${contributor.isni}</div>` : ''}
                </div>
            `).join('');
            resultsContainer.style.display = 'block';
        } else {
            resultsContainer.innerHTML = `
                <div class="search-result-item" onclick="createNewContributor('${escapeHtml(query)}', ${songId})">
                    <div><strong>Create "${escapeHtml(query)}"</strong></div>
                </div>
            `;
            resultsContainer.style.display = 'block';
        }
    } catch (error) {
        console.error('Search contributors error:', error);
        resultsContainer.style.display = 'none';
    }
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
        const dropdown = result.closest('.search-dropdown');
        if (dropdown && !dropdown.contains(event.target)) {
            result.style.display = 'none';
        }
    });
});

window.onclick = function(event) {
    const modals = ['saveModal', 'bulkModal', 'bulkEditModal', 'deleteConfirmModal', 'linkTokenModal', 'fixTokenModal', 'bulkTokenLinkModal', 'editTokenModal', 'bulkEditTokensModal', 'bulkAddImageModal', 'bulkAddAudioModal'];
    modals.forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (modal && event.target === modal) {
            modal.style.display = 'none';
        }
    });
}