import { APIClient } from './api.js';
import { UIComponents } from './ui.js';
import { ModalManager } from './modals.js';
import { state, refreshCountsAndStats, refreshCurrentIssues } from './state.js';

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
