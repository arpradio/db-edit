import { UIComponents } from './ui.js';

export class ModalManager {
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

    // Collapsible "create song" form for a token whose metadata failed to
    // produce songs. Prefilled from the token's parsed metadata, editable by
    // hand. `prefix` namespaces the element ids per host modal (link/fix).
    static createSongFromTokenSection(prefix) {
        const id = name => `${prefix}Create${name}`;
        const field = (label, name, placeholder) => `
            <div class="metadata-row">
                <span class="metadata-label">${label}:</span>
                <div class="metadata-value">
                    <input type="text" id="${id(name)}" class="editable-field" placeholder="${placeholder}">
                </div>
            </div>`;

        return `
            <details id="${id('Section')}" style="margin: 15px 0; border: 1px solid #444; border-radius: 6px; padding: 10px;">
                <summary style="cursor: pointer; font-size: 14px; color: #4CAF50; font-weight: bold;">Create New Song from Token Metadata</summary>
                <div style="margin-top: 12px;">
                    <p id="${id('Status')}" style="color: #888; font-size: 12px; margin-bottom: 10px;">Loading token metadata...</p>

                    <div class="metadata-row" id="${id('TrackRow')}" style="display: none;">
                        <span class="metadata-label">Prefill from:</span>
                        <div class="metadata-value">
                            <select id="${id('Track')}" class="editable-field" onchange="TokenManager.prefillCreateSongForm('${prefix}', this.value)"></select>
                        </div>
                    </div>

                    ${field('Title *', 'Title', 'Song title')}
                    ${field('Artists', 'Artists', 'Comma-separated')}
                    ${field('Genres', 'Genres', 'Comma-separated')}
                    ${field('Duration', 'Duration', 'e.g. PT3M21S')}
                    ${field('ISRC', 'Isrc', 'ISRC')}
                    ${field('ISWC', 'Iswc', 'ISWC')}
                    ${field('Audio URL', 'AudioUrl', 'ipfs://... or https://...')}

                    <div class="metadata-row">
                        <span class="metadata-label">Audio Type:</span>
                        <div class="metadata-value">
                            <select id="${id('AudioType')}" class="editable-field">
                                <option value="mp3">MP3</option>
                                <option value="wav">WAV</option>
                                <option value="flac">FLAC</option>
                                <option value="m4a">M4A</option>
                                <option value="unknown">Unknown</option>
                            </select>
                        </div>
                    </div>

                    ${field('IPFS CID', 'AudioCid', 'IPFS CID (optional)')}

                    <div class="metadata-row" style="gap: 16px;">
                        <label style="display: flex; align-items: center; gap: 6px;"><input type="checkbox" id="${id('Explicit')}"> Explicit</label>
                        <label style="display: flex; align-items: center; gap: 6px;"><input type="checkbox" id="${id('Ai')}"> AI Generated</label>
                    </div>

                    <div style="display: flex; gap: 10px; margin: 10px 0;">
                        <button class="btn btn-small btn-success" onclick="TokenManager.createSongFromForm('${prefix}')">Create &amp; Select Song</button>
                        <button class="btn btn-small btn-primary" id="${id('AllBtn')}" style="display: none;" onclick="TokenManager.createAllTracksFromMetadata('${prefix}')"></button>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span class="metadata-label" style="margin: 0;">Full Metadata (JSON):</span>
                        <button class="btn btn-small btn-secondary" onclick="TokenManager.toggleCreateSongMetadata('${prefix}', this)">Show</button>
                    </div>
                    <pre id="${id('Json')}" style="display: none; background: #1a1a1a; padding: 12px; border-radius: 4px; overflow-x: auto; max-height: 300px; margin: 8px 0 0;"><code></code></pre>
                </div>
            </details>
        `;
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

            ${ModalManager.createSongFromTokenSection('link')}

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

            ${ModalManager.createSongFromTokenSection('fix')}

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
