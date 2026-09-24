import { APIClient } from './api.js';
import { UIComponents } from './ui.js';
import { state, refreshCountsAndStats, refreshCurrentIssues } from './state.js';

export class AssetManager {
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
            if (state.currentIssueType === 'no-images') {
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
            if (state.currentIssueType === 'no-images') {
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
            if (state.currentIssueType === 'no-images') {
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
            if (state.currentIssueType === 'no-images') {
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
            if (state.currentIssueType === 'no-images') {
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
            if (state.currentIssueType === 'no-images') {
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
