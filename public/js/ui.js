import { RelationshipManager } from './relationships.js';

export class UIComponents {
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
