import { APIClient } from './api.js';
import { UIComponents } from './ui.js';
import { ModalManager } from './modals.js';
import { state, refreshCountsAndStats, refreshCurrentIssues } from './state.js';

// CIP-25 splits strings longer than 64 bytes into arrays of chunks.
function metaText(value) {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.every(v => typeof v === 'string') ? value.join('') : '';
    if (typeof value === 'object') return '';
    return String(value).trim();
}

// Artists/genres appear as strings, {name} objects, or objects keyed by name.
function metaList(value) {
    if (!value) return [];
    const items = Array.isArray(value) ? value : [value];
    return items.map(item => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
            return metaText(item.name) || Object.keys(item)[0] || '';
        }
        return metaText(item);
    }).filter(Boolean);
}

function metaBool(value) {
    return value === true || value === 1 || String(value).toLowerCase() === 'true';
}

const AUDIO_TYPES = {
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
    'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
    'audio/flac': 'flac', 'audio/x-flac': 'flac',
    'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'm4a'
};

// Every object carrying a `files` array is treated as an asset/release node,
// regardless of how deep the policy/asset-name wrapping goes.
function findAssetNodes(node, found = []) {
    if (!node || typeof node !== 'object') return found;
    if (Array.isArray(node)) {
        node.forEach(child => findAssetNodes(child, found));
        return found;
    }
    if (Array.isArray(node.files)) found.push(node);
    Object.entries(node).forEach(([key, child]) => {
        if (key !== 'files') findAssetNodes(child, found);
    });
    return found;
}

// Turns CIP-60 token metadata into one song-form prefill per audio track.
function parseTokenTracks(metadata, fallbackTitle) {
    const tracks = [];

    findAssetNodes(metadata).forEach(asset => {
        const release = (asset.release && typeof asset.release === 'object') ? asset.release : {};
        const releaseArtists = metaList(asset.artists || release.artists);
        const releaseGenres = metaList(release.genres || asset.genres);

        asset.files.forEach(file => {
            if (!file || typeof file !== 'object') return;
            const mediaType = metaText(file.mediaType).toLowerCase();
            const song = (file.song && typeof file.song === 'object') ? file.song : file;
            if (!mediaType.startsWith('audio') && !song.song_title) return;

            const src = metaText(file.src);
            const cidMatch = src.match(/^ipfs:\/\/(?:ipfs\/)?(.+)$/i);
            const songArtists = metaList(song.artists);
            const songGenres = metaList(song.genres);

            tracks.push({
                title: metaText(song.song_title) || metaText(file.name) || metaText(release.release_title) || metaText(asset.name),
                artists: songArtists.length ? songArtists : releaseArtists,
                genres: songGenres.length ? songGenres : releaseGenres,
                duration: metaText(song.song_duration || song.duration),
                isrc: metaText(song.isrc),
                iswc: metaText(song.iswc),
                explicit: metaBool(song.explicit || song.parental_advisory),
                ai: metaBool(song.ai_generated || song.is_ai_generated),
                audioUrl: src,
                audioType: AUDIO_TYPES[mediaType] || 'unknown',
                audioCid: cidMatch ? cidMatch[1] : ''
            });
        });
    });

    if (tracks.length === 0) {
        tracks.push({
            title: fallbackTitle || '', artists: [], genres: [], duration: '', isrc: '', iswc: '',
            explicit: false, ai: false, audioUrl: '', audioType: 'mp3', audioCid: ''
        });
    }

    return tracks;
}

// Parsed tracks for the currently open create-song form, keyed by modal prefix.
const metadataTracks = {};

export class TokenManager {
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
        if (state.selectedItems.size === 0) {
            UIComponents.showMessage('No tokens selected', 'info');
            return;
        }
        
        UIComponents.showLoading();
        
        try {
            const promises = Array.from(state.selectedItems).map(tokenId => 
                APIClient.post(`/api/tokens/${tokenId}/process`)
            );
            
            await Promise.all(promises);
            
            UIComponents.showMessage(`Successfully processed ${state.selectedItems.size} tokens`, 'success');
            state.selectedItems.clear();
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
        state.selectedSongsForLink.clear();
        
        ModalManager.show('linkTokenModal');
        TokenManager.loadCreateSongForm('link', tokenId, tokenName);
    }

    static async showFixTokenModal(tokenId, tokenName) {
        ModalManager.createFixTokenModal();
        
        document.getElementById('fixTokenId').value = tokenId;
        document.getElementById('fixTokenName').textContent = tokenName;
        document.getElementById('fixSongSearchInput').value = '';
        document.getElementById('fixSongSearchResults').innerHTML = '';
        document.getElementById('fixSelectedSongsList').innerHTML = '';
        document.getElementById('markProcessedCheck').checked = true;
        state.selectedSongsForFix.clear();
        
        ModalManager.show('fixTokenModal');
        TokenManager.loadCreateSongForm('fix', tokenId, tokenName);
    }

    static async loadCreateSongForm(prefix, tokenId, tokenName) {
        const status = document.getElementById(`${prefix}CreateStatus`);
        let metadata = null;

        try {
            const tokenData = await APIClient.get(`/api/tokens/${tokenId}`);
            metadata = tokenData.metadata;
        } catch (error) {
            console.error('Failed to load token metadata:', error);
        }

        const tracks = parseTokenTracks(metadata, tokenName);
        metadataTracks[prefix] = tracks;

        if (!metadata) {
            status.textContent = 'No metadata available for this token. Enter song details manually.';
        } else if (!tracks.some(t => t.audioUrl)) {
            status.textContent = 'No audio tracks could be parsed from the metadata. Check the JSON below and enter details manually.';
        } else {
            status.textContent = `Parsed ${tracks.length} track(s) from token metadata. Review and edit before creating.`;
        }

        document.getElementById(`${prefix}CreateTrack`).innerHTML = tracks.map((t, i) =>
            `<option value="${i}">${i + 1}. ${UIComponents.escapeHtml(t.title || 'Untitled')}</option>`
        ).join('');
        document.getElementById(`${prefix}CreateTrackRow`).style.display = tracks.length > 1 ? '' : 'none';

        const allBtn = document.getElementById(`${prefix}CreateAllBtn`);
        allBtn.style.display = tracks.length > 1 ? '' : 'none';
        allBtn.textContent = `Create All ${tracks.length} Tracks`;

        document.querySelector(`#${prefix}CreateJson code`).textContent =
            metadata ? JSON.stringify(metadata, null, 2) : 'No metadata';

        TokenManager.prefillCreateSongForm(prefix, 0);
    }

    static prefillCreateSongForm(prefix, index) {
        const track = (metadataTracks[prefix] || [])[index];
        if (!track) return;

        const set = (name, value) => { document.getElementById(`${prefix}Create${name}`).value = value; };
        set('Title', track.title);
        set('Artists', track.artists.join(', '));
        set('Genres', track.genres.join(', '));
        set('Duration', track.duration);
        set('Isrc', track.isrc);
        set('Iswc', track.iswc);
        set('AudioUrl', track.audioUrl);
        set('AudioType', track.audioType);
        set('AudioCid', track.audioCid);
        document.getElementById(`${prefix}CreateExplicit`).checked = track.explicit;
        document.getElementById(`${prefix}CreateAi`).checked = track.ai;
    }

    static toggleCreateSongMetadata(prefix, button) {
        const pre = document.getElementById(`${prefix}CreateJson`);
        const hidden = pre.style.display === 'none';
        pre.style.display = hidden ? 'block' : 'none';
        button.textContent = hidden ? 'Hide' : 'Show';
    }

    static readCreateSongForm(prefix) {
        const get = name => document.getElementById(`${prefix}Create${name}`).value.trim();
        const split = value => value.split(',').map(v => v.trim()).filter(Boolean);
        return {
            title: get('Title'),
            artists: split(get('Artists')),
            genres: split(get('Genres')),
            duration: get('Duration'),
            isrc: get('Isrc'),
            iswc: get('Iswc'),
            explicit: document.getElementById(`${prefix}CreateExplicit`).checked,
            ai: document.getElementById(`${prefix}CreateAi`).checked,
            audioUrl: get('AudioUrl'),
            audioType: get('AudioType'),
            audioCid: get('AudioCid')
        };
    }

    // Creates the song server-side (already linked to the token) and adds it to
    // the host modal's selection so the modal's main action treats it like any
    // other chosen song.
    static async createSongForToken(prefix, track, isPrimary) {
        const tokenId = document.getElementById(`${prefix}TokenId`).value;
        const result = await APIClient.post(`/api/tokens/${tokenId}/create-song`, {
            title: track.title,
            artists: track.artists,
            genres: track.genres,
            duration: track.duration,
            isrc: track.isrc,
            iswc: track.iswc,
            is_explicit: track.explicit,
            is_ai_generated: track.ai,
            is_primary: isPrimary,
            audio_files: track.audioUrl
                ? [{ file_url: track.audioUrl, file_type: track.audioType, ipfs_cid: track.audioCid }]
                : []
        });

        const isFix = prefix === 'fix';
        const selectedSet = isFix ? state.selectedSongsForFix : state.selectedSongsForLink;
        const listContainerId = isFix ? 'fixSelectedSongsList' : 'selectedSongsList';
        const songId = result.song_id;

        selectedSet.add(songId);
        const songItem = document.createElement('div');
        songItem.className = 'selected-song-item';
        songItem.innerHTML = `
            <span>${UIComponents.escapeHtml(track.title)} - ${UIComponents.escapeHtml(track.artists.join(', ') || 'No artists')} <em style="color: #4CAF50;">(new, linked)</em></span>
            <button class="btn btn-small btn-danger" onclick="TokenManager.removeSongFromSelection(${songId}, '${listContainerId}')">Remove</button>
        `;
        document.getElementById(listContainerId).appendChild(songItem);
        return result;
    }

    static async createSongFromForm(prefix) {
        const track = TokenManager.readCreateSongForm(prefix);
        if (!track.title) {
            UIComponents.showMessage('Song title is required', 'error');
            return;
        }

        UIComponents.showLoading();
        try {
            const selectedSet = prefix === 'fix' ? state.selectedSongsForFix : state.selectedSongsForLink;
            await TokenManager.createSongForToken(prefix, track, selectedSet.size === 0);
            UIComponents.showMessage(`Song "${track.title}" created and linked to token`, 'success');
            refreshCountsAndStats();
        } catch (error) {
            console.error('Create song from metadata error:', error);
            UIComponents.showMessage(`Failed to create song: ${error.message}`, 'error');
        } finally {
            UIComponents.hideLoading();
        }
    }

    static async createAllTracksFromMetadata(prefix) {
        const tracks = (metadataTracks[prefix] || []).filter(t => t.title);
        if (tracks.length === 0) return;
        if (!confirm(`Create ${tracks.length} new songs from the token metadata and link them to this token?`)) return;

        UIComponents.showLoading();
        let created = 0;
        try {
            for (const [i, track] of tracks.entries()) {
                await TokenManager.createSongForToken(prefix, track, i === 0);
                created++;
            }
            UIComponents.showMessage(`Created and linked ${created} songs`, 'success');
        } catch (error) {
            console.error('Create all tracks error:', error);
            UIComponents.showMessage(`Created ${created} of ${tracks.length} songs, then failed: ${error.message}`, 'error');
        } finally {
            refreshCountsAndStats();
            UIComponents.hideLoading();
        }
    }

    static async searchSongsForToken(query, tokenId, resultsContainerId) {
        if (state.searchTimeout) {
            clearTimeout(state.searchTimeout);
        }
        
        const resultsContainer = document.getElementById(resultsContainerId);
        
        if (!query || query.length < 2) {
            resultsContainer.innerHTML = '';
            return;
        }
        
        state.searchTimeout = setTimeout(async () => {
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

        const selectedSet = resultsContainerId.includes('fix') ? state.selectedSongsForFix :
                           resultsContainerId.includes('bulk') ? state.selectedSongsForLink : state.selectedSongsForLink;
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

            const selectedSet = state.selectedSongsForLink;
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
        if (state.searchTimeout) {
            clearTimeout(state.searchTimeout);
        }

        const resultsContainer = document.getElementById('bulkLinkSongSearchResults');

        if (!query || query.length < 2) {
            resultsContainer.innerHTML = '';
            return;
        }

        state.searchTimeout = setTimeout(async () => {
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
        const selectedSet = listContainerId.includes('fix') ? state.selectedSongsForFix : state.selectedSongsForLink;
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
        const songIds = Array.from(state.selectedSongsForLink);
        
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
        const songIds = Array.from(state.selectedSongsForFix);
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
        state.selectedSongsForLink.clear();
    }

    static closeFixTokenModal() {
        ModalManager.hide('fixTokenModal');
        state.selectedSongsForFix.clear();
    }

    static async showBulkLinkModal() {
        if (state.selectedItems.size === 0) {
            UIComponents.showMessage('No tokens selected', 'info');
            return;
        }

        ModalManager.createBulkTokenLinkModal();

        const selectedTokenIds = Array.from(state.selectedItems);
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
        state.selectedSongsForLink.clear();

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
        const songIds = Array.from(state.selectedSongsForLink);

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
            state.selectedItems.clear();
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
        state.selectedSongsForLink.clear();
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
                if (state.selectedSongsForLink.has(songId)) {
                    UIComponents.showMessage('Song already selected', 'info');
                } else {
                    state.selectedSongsForLink.add(songId);

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
        if (state.selectedItems.size === 0) {
            UIComponents.showMessage('No tokens selected', 'info');
            return;
        }

        ModalManager.createBulkEditTokensModal();

        const selectedTokenIds = Array.from(state.selectedItems);
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
            state.selectedItems.clear();
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
        if (state.selectedItems.size === 0) {
            UIComponents.showMessage('No tokens selected', 'info');
            return;
        }

        UIComponents.showLoading();

        try {
            const promises = Array.from(state.selectedItems).map(tokenId =>
                APIClient.post(`/api/tokens/${tokenId}/fix-relations`, { songIds: [], markProcessed: true })
            );

            await Promise.all(promises);

            UIComponents.showMessage(`Successfully marked ${state.selectedItems.size} tokens as processed`, 'success');
            state.selectedItems.clear();
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
        if (state.selectedItems.size === 0) {
            UIComponents.showMessage('No tokens selected', 'info');
            return;
        }

        ModalManager.createBulkAddImageModal();

        const selectedTokenIds = Array.from(state.selectedItems);
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
            state.selectedItems.clear();
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
        if (state.selectedItems.size === 0) {
            UIComponents.showMessage('No tokens selected', 'info');
            return;
        }

        ModalManager.createBulkAddAudioModal();

        const selectedTokenIds = Array.from(state.selectedItems);
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
            state.selectedItems.clear();
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
