let originalData = {};
let currentChanges = {};
let lastSearchQuery = '';
let selectedSongs = new Set();
let bulkEditMode = false;

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
        loadQualityCounts();
    } else if (tabName === 'stats') {
        loadStats();
    }
}

async function searchSongs() {
    const query = document.getElementById('searchInput').value;
    if (!query.trim()) {
        showMessage('Please enter a search term', 'info');
        return;
    }
    
    lastSearchQuery = query;
    showLoading();
    
    try {
        const response = await fetch(`/api/songs/search?q=${encodeURIComponent(query)}`);
        const songs = await response.json();
        
        showTabByName('search');
        displaySongs(songs);
    } catch (error) {
        console.error('Search error:', error);
        showError('Failed to search songs');
    } finally {
        hideLoading();
    }
}

function showTabByName(tabName) {
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.querySelectorAll('.tab-button').forEach(button => {
        button.classList.remove('active');
    });
    
    document.getElementById(tabName + 'Tab').classList.add('active');
    document.querySelector(`[onclick="showTab('${tabName}')"]`).classList.add('active');
}

function clearResults() {
    const container = document.getElementById('songsContainer');
    const emptyState = document.getElementById('emptyState');
    
    container.innerHTML = '';
    container.appendChild(emptyState);
    emptyState.style.display = 'block';
    
    document.getElementById('searchInput').value = '';
    lastSearchQuery = '';
    originalData = {};
    selectedSongs.clear();
    updateBulkEditControls();
}

async function refreshSearch() {
    if (lastSearchQuery) {
        document.getElementById('searchInput').value = lastSearchQuery;
        await searchSongs();
    }
}

let selectedItems = new Set();
let currentIssueType = '';

async function loadQualityCounts() {
    try {
        const response = await fetch('/api/quality/counts');
        const counts = await response.json();
        
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
        showMessage('Failed to load data quality information', 'error');
    }
}

async function loadDataIssues(issueType) {
    currentIssueType = issueType;
    selectedItems.clear();
    showLoading();
    
    try {
        const response = await fetch(`/api/quality/issues/${issueType}`);
        const issues = await response.json();
        
        displayIssues(issues, issueType);
    } catch (error) {
        console.error('Failed to load issues:', error);
        showMessage('Failed to load data issues', 'error');
    } finally {
        hideLoading();
    }
}

function displayIssues(issues, issueType) {
    const container = document.getElementById('issuesContainer');
    
    if (issues.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No issues found! 🎉</p></div>';
        return;
    }
    
    const issueTitle = getIssueTitle(issueType);
    const showBulkActions = issueType.includes('orphan');
    
    container.innerHTML = `
        <h4>${issueTitle} (${issues.length} found)</h4>
        ${showBulkActions ? createBulkActionsHTML(issueType) : ''}
        <div class="issues-list">
            ${showBulkActions ? createSelectAllHTML() : ''}
            ${issues.map(issue => createIssueItem(issue, issueType)).join('')}
        </div>
    `;
    
    updateBulkActionsVisibility();
}

function createBulkActionsHTML(issueType) {
    const entityMap = {
        'orphan-artists': 'artists',
        'orphan-genres': 'genres', 
        'orphan-contributors': 'contributors',
        'orphan-tokens': 'tokens',
        'orphan-images': 'images'
    };
    
    const entityType = entityMap[issueType] || 'items';
    
    return `
        <div class="bulk-actions" id="bulkActions">
            <div class="bulk-actions-header">
                <span class="selection-info" id="selectionInfo">0 items selected</span>
                <div class="bulk-buttons">
                    <button class="btn btn-small btn-danger" onclick="bulkDeleteSelected()">Delete Selected</button>
                    <button class="btn btn-small btn-danger" onclick="bulkDeleteAll('${issueType}')">Delete All ${entityType}</button>
                    ${issueType === 'unprocessed-tokens' ? '<button class="btn btn-small btn-primary" onclick="bulkProcessTokens()">Process Selected</button>' : ''}
                    ${issueType === 'artists-no-isni' ? '<button class="btn btn-small btn-primary" onclick="bulkEditIsni()">Add ISNI</button>' : ''}
                </div>
            </div>
        </div>
    `;
}

function createSelectAllHTML() {
    return `
        <div class="select-all-container">
            <input type="checkbox" id="selectAllCheckbox" class="issue-checkbox" onchange="toggleSelectAll()">
            <label for="selectAllCheckbox">Select All</label>
        </div>
    `;
}

async function processToken(tokenId, tokenName) {
    try {
        const response = await fetch(`/api/tokens/${tokenId}/process`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showMessage(`Token "${tokenName}" marked as processed`, 'success');
            await loadDataIssues(currentIssueType);
            await loadQualityCounts();
        } else {
            throw new Error(result.error || 'Failed to process token');
        }
    } catch (error) {
        console.error('Process token error:', error);
        showMessage(`Failed to process token: ${error.message}`, 'error');
    }
}

async function bulkProcessTokens() {
    if (selectedItems.size === 0) {
        showMessage('No tokens selected', 'info');
        return;
    }
    
    showLoading();
    
    try {
        const promises = Array.from(selectedItems).map(tokenId => 
            fetch(`/api/tokens/${tokenId}/process`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            })
        );
        
        await Promise.all(promises);
        
        showMessage(`Successfully processed ${selectedItems.size} tokens`, 'success');
        selectedItems.clear();
        await loadDataIssues(currentIssueType);
        await loadQualityCounts();
    } catch (error) {
        console.error('Bulk process error:', error);
        showMessage(`Failed to process tokens: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

async function editArtistIsni(artistId, artistName) {
    const isni = prompt(`Enter ISNI code for "${artistName}":`, '');
    
    if (isni === null || isni.trim() === '') {
        return;
    }
    
    try {
        const response = await fetch(`/api/artists/${artistId}/isni`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ isni: isni.trim() })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showMessage(`ISNI updated for "${artistName}"`, 'success');
            await loadDataIssues(currentIssueType);
            await loadQualityCounts();
        } else {
            throw new Error(result.error || 'Failed to update ISNI');
        }
    } catch (error) {
        console.error('Update ISNI error:', error);
        showMessage(`Failed to update ISNI: ${error.message}`, 'error');
    }
}


function createIssueItem(issue, issueType) {
    if (issueType.includes('songs') || issueType.includes('no-')) {
        return `
            <div class="issue-item" onclick="editSongFromIssue(${issue.id})">
                <div class="issue-content">
                    <span class="issue-title">${escapeHtml(issue.title || issue.name)}</span>
                    <span class="issue-id">ID: ${issue.id}</span>
                </div>
                <div class="issue-actions">
                    <button class="btn btn-small btn-primary" onclick="event.stopPropagation(); editSongFromIssue(${issue.id})">Edit</button>
                </div>
            </div>
        `;
    } else if (issueType.includes('orphan') || issueType.includes('unprocessed') || issueType.includes('failed') || issueType.includes('artists-no-isni')) {
        let actionButtons = `<button class="btn btn-small btn-danger" onclick="deleteOrphan('${issueType}', ${issue.id}, '${escapeHtml(issue.name)}')">Delete</button>`;
        
        if (issueType === 'unprocessed-tokens') {
            actionButtons += `<button class="btn btn-small btn-primary" onclick="processToken(${issue.id}, '${escapeHtml(issue.name)}')">Process</button>`;
        }
        
        if (issueType === 'artists-no-isni') {
            actionButtons = `<button class="btn btn-small btn-primary" onclick="editArtistIsni(${issue.id}, '${escapeHtml(issue.name)}')">Add ISNI</button>` + actionButtons;
        }
        
        return `
            <div class="issue-item" data-item-id="${issue.id}">
                <div class="issue-content">
                    <input type="checkbox" class="issue-checkbox" data-item-id="${issue.id}" onchange="toggleItemSelection(${issue.id})">
                    <span class="issue-title">${escapeHtml(issue.name)}</span>
                    <span class="issue-id">ID: ${issue.id}</span>
                    ${issue.policy_id ? `<span class="issue-meta">Policy: ${escapeHtml(issue.policy_id.substring(0, 8))}...</span>` : ''}
                    ${issue.image_type ? `<span class="issue-meta">Type: ${escapeHtml(issue.image_type)}</span>` : ''}
                </div>
                <div class="issue-actions">
                    ${actionButtons}
                </div>
            </div>
        `;
    }
    
    return '';
}

function toggleItemSelection(itemId) {
    const checkbox = document.querySelector(`input[data-item-id="${itemId}"]`);
    const issueItem = document.querySelector(`div[data-item-id="${itemId}"]`);
    
    if (checkbox.checked) {
        selectedItems.add(itemId);
        issueItem.classList.add('selected');
    } else {
        selectedItems.delete(itemId);
        issueItem.classList.remove('selected');
    }
    
    updateSelectionInfo();
    updateSelectAllCheckbox();
    updateBulkActionsVisibility();
}

function toggleSelectAll() {
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
    
    updateSelectionInfo();
    updateBulkActionsVisibility();
}

function updateSelectionInfo() {
    const selectionInfo = document.getElementById('selectionInfo');
    if (selectionInfo) {
        selectionInfo.textContent = `${selectedItems.size} items selected`;
    }
}

function updateSelectAllCheckbox() {
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    const allCheckboxes = document.querySelectorAll('.issue-checkbox[data-item-id]');
    
    if (selectAllCheckbox && allCheckboxes.length > 0) {
        const checkedCount = Array.from(allCheckboxes).filter(cb => cb.checked).length;
        selectAllCheckbox.checked = checkedCount === allCheckboxes.length;
        selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < allCheckboxes.length;
    }
}

function updateBulkActionsVisibility() {
    const bulkActions = document.getElementById('bulkActions');
    if (bulkActions) {
        if (selectedItems.size > 0) {
            bulkActions.classList.add('visible');
        } else {
            bulkActions.classList.remove('visible');
        }
    }
}

async function bulkDeleteSelected() {
    if (selectedItems.size === 0) {
        showMessage('No items selected', 'info');
        return;
    }
    
    const entityType = currentIssueType.includes('artists') ? 'artists' : 'genres';
    const selectedIds = Array.from(selectedItems);
    
    const selectedNames = selectedIds.map(id => {
        const issueItem = document.querySelector(`div[data-item-id="${id}"] .issue-title`);
        return issueItem ? issueItem.textContent : `ID: ${id}`;
    });
    
    showBulkModal(
        `Delete ${selectedItems.size} selected ${entityType}?`,
        selectedNames,
        () => executeBulkDelete(currentIssueType, selectedIds)
    );
}

async function bulkDeleteAll(issueType) {
    const entityType = issueType.includes('artists') ? 'artists' : 'genres';
    const allItems = document.querySelectorAll('.issue-item[data-item-id]');
    const allIds = Array.from(allItems).map(item => parseInt(item.dataset.itemId));
    const allNames = Array.from(allItems).map(item => item.querySelector('.issue-title').textContent);
    
    showBulkModal(
        `Delete ALL ${allIds.length} ${entityType}?`,
        allNames,
        () => executeBulkDelete(issueType, allIds)
    );
}

function showBulkModal(actionText, itemNames, confirmCallback) {
    document.getElementById('bulkActionText').textContent = actionText;
    
    const itemsList = document.getElementById('bulkItemsList');
    itemsList.innerHTML = itemNames.map(name => 
        `<div class="bulk-item">${escapeHtml(name)}</div>`
    ).join('');
    
    document.getElementById('confirmBulkBtn').onclick = confirmCallback;
    document.getElementById('bulkModal').style.display = 'block';
}

function closeBulkModal() {
    document.getElementById('bulkModal').style.display = 'none';
}

async function executeBulkDelete(issueType, ids) {
    showLoading();
    closeBulkModal();
    
    try {
        const endpointMap = {
            'orphan-artists': 'artists',
            'orphan-genres': 'genres',
            'orphan-contributors': 'contributors',
            'orphan-tokens': 'tokens',
            'orphan-images': 'images'
        };
        
        const endpoint = endpointMap[issueType] || 'items';
        const response = await fetch(`/api/${endpoint}/bulk-delete`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ids })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showMessage(`Successfully deleted ${ids.length} items`, 'success');
            selectedItems.clear();
            await loadDataIssues(currentIssueType);
            await loadQualityCounts();
        } else {
            throw new Error(result.error || 'Failed to delete items');
        }
    } catch (error) {
        console.error('Bulk delete error:', error);
        showMessage(`Failed to delete items: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}


function getIssueTitle(issueType) {
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

async function editSongFromIssue(songId, retryCount = 0) {
    showLoading();
    
    try {
        await new Promise(resolve => setTimeout(resolve, retryCount * 500));
        
        const response = await fetch(`/api/songs/${songId}`);
        if (!response.ok) {
            if (response.status === 404 && retryCount < 3) {
                hideLoading();
                return editSongFromIssue(songId, retryCount + 1);
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const song = await response.json();
        
        showTabByName('search');
        displaySongs([song]);
        
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
            showMessage(`Retrying... (attempt ${retryCount + 1})`, 'info');
            hideLoading();
            return editSongFromIssue(songId, retryCount + 1);
        }
        showMessage(`Failed to load song for editing after ${retryCount + 1} attempts: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

async function deleteOrphan(type, id, name) {
    if (!confirm(`Are you sure you want to delete "${name}"? This action cannot be undone.`)) {
        return;
    }
    
    showLoading();
    
    try {
        const endpoint = type.includes('artists') ? 'artists' : 'genres';
        const response = await fetch(`/api/${endpoint}/${id}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showMessage(`Deleted ${name} successfully`, 'success');
            const currentIssueType = type;
            loadDataIssues(currentIssueType);
            loadQualityCounts();
        } else {
            throw new Error('Failed to delete');
        }
    } catch (error) {
        console.error('Delete error:', error);
        showMessage(`Failed to delete ${name}`, 'error');
    } finally {
        hideLoading();
    }
}

async function deleteSong(songId) {
    const song = originalData[songId];
    if (!song) {
        showMessage('Song data not found', 'error');
        return;
    }
    
    showDeleteConfirmModal(
        `Are you sure you want to delete "${song.title}"? This action cannot be undone and will remove all associated data.`,
        () => executeSingleDelete(songId)
    );
}

async function executeSingleDelete(songId) {
    const song = originalData[songId];
    closeDeleteModal();
    showLoading();
    
    try {
        const response = await fetch(`/api/songs/${songId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showMessage(`Successfully deleted "${song.title}"`, 'success');
            
            const songCard = document.querySelector(`[data-song-id="${songId}"]`);
            if (songCard) {
                songCard.remove();
            }
            
            delete originalData[songId];
            selectedSongs.delete(songId);
            updateBulkEditControls();
            
            const remainingSongs = document.querySelectorAll('.song-card').length;
            if (remainingSongs === 0) {
                const container = document.getElementById('songsContainer');
                const emptyState = document.getElementById('emptyState');
                container.innerHTML = '';
                container.appendChild(emptyState);
                emptyState.style.display = 'block';
            }
            
            setTimeout(() => {
                if (loadQualityCounts) {
                    loadQualityCounts();
                }
                if (loadStats) {
                    loadStats();
                }
            }, 500);
            
        } else {
            throw new Error(result.error || 'Failed to delete song');
        }
    } catch (error) {
        console.error('Delete error:', error);
        showMessage(`Failed to delete song: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

async function bulkDeleteSongs() {
    if (selectedSongs.size === 0) {
        showMessage('No songs selected', 'info');
        return;
    }
    
    const selectedIds = Array.from(selectedSongs);
    const selectedTitles = selectedIds.map(id => {
        const song = originalData[id];
        return song ? song.title : `ID: ${id}`;
    });
    
    showBulkModal(
        `Delete ${selectedSongs.size} selected songs?`,
        selectedTitles,
        () => executeBulkSongDelete(selectedIds)
    );
}

async function executeBulkSongDelete(ids) {
    showLoading();
    closeBulkModal();
    
    try {
        const response = await fetch('/api/songs/bulk-delete', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ids })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showMessage(`Successfully deleted ${ids.length} songs`, 'success');
            
            ids.forEach(id => {
                const songCard = document.querySelector(`[data-song-id="${id}"]`);
                if (songCard) {
                    songCard.remove();
                }
                delete originalData[id];
                selectedSongs.delete(id);
            });
            
            updateBulkEditControls();
            
            const remainingSongs = document.querySelectorAll('.song-card').length;
            if (remainingSongs === 0) {
                const container = document.getElementById('songsContainer');
                const emptyState = document.getElementById('emptyState');
                container.innerHTML = '';
                container.appendChild(emptyState);
                emptyState.style.display = 'block';
            }
            
            if (bulkEditMode) {
                toggleBulkEditMode();
            }
            
            setTimeout(() => {
                if (loadQualityCounts) {
                    loadQualityCounts();
                }
                if (loadStats) {
                    loadStats();
                }
            }, 500);
            
        } else {
            throw new Error(result.error || 'Failed to delete songs');
        }
    } catch (error) {
        console.error('Bulk delete error:', error);
        showMessage(`Failed to delete songs: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

async function loadStats() {
    try {
        const response = await fetch('/api/stats');
        const stats = await response.json();
        
        document.getElementById('totalSongs').textContent = stats.total_songs || 0;
        document.getElementById('totalArtists').textContent = stats.total_artists || 0;
        document.getElementById('totalGenres').textContent = stats.total_genres || 0;
        document.getElementById('verifiedSongs').textContent = stats.verified_songs || 0;
        document.getElementById('unverifiedSongs').textContent = stats.unverified_songs || 0;
        document.getElementById('pendingSongs').textContent = stats.pending_songs || 0;
        
    } catch (error) {
        console.error('Failed to load statistics:', error);
        showMessage('Failed to load statistics', 'error');
    }
}

function toggleBulkEditMode() {
    bulkEditMode = !bulkEditMode;
    const button = document.getElementById('bulkEditToggle');
    
    if (bulkEditMode) {
        button.textContent = 'Exit Bulk Edit';
        button.classList.add('btn-secondary');
        button.classList.remove('btn-primary');
        selectedSongs.clear();
        updateBulkEditControls();
        addSongCheckboxes();
    } else {
        button.textContent = 'Bulk Edit Mode';
        button.classList.add('btn-primary');
        button.classList.remove('btn-secondary');
        selectedSongs.clear();
        updateBulkEditControls();
        removeSongCheckboxes();
    }
}

function addSongCheckboxes() {
    document.querySelectorAll('.song-card').forEach(card => {
        const songId = card.dataset.songId;
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'song-checkbox';
        checkbox.dataset.songId = songId;
        checkbox.onchange = () => toggleSongSelection(songId);
        
        const checkboxContainer = document.createElement('div');
        checkboxContainer.className = 'song-checkbox-container';
        checkboxContainer.appendChild(checkbox);
        
        card.insertBefore(checkboxContainer, card.firstChild);
    });
}

function removeSongCheckboxes() {
    document.querySelectorAll('.song-checkbox-container').forEach(container => {
        container.remove();
    });
}

function toggleSongSelection(songId) {
    const checkbox = document.querySelector(`input[data-song-id="${songId}"]`);
    const card = document.querySelector(`[data-song-id="${songId}"]`);
    
    if (checkbox.checked) {
        selectedSongs.add(parseInt(songId));
        card.classList.add('selected');
    } else {
        selectedSongs.delete(parseInt(songId));
        card.classList.remove('selected');
    }
    
    updateBulkEditControls();
}

function updateBulkEditControls() {
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

function openBulkEditModal() {
    if (selectedSongs.size === 0) {
        showMessage('No songs selected', 'info');
        return;
    }
    
    document.getElementById('bulkTitle').value = '';
    document.getElementById('bulkDuration').value = '';
    document.getElementById('bulkStatus').value = '';
    document.getElementById('bulkArtists').value = '';
    document.getElementById('bulkGenres').value = '';
    
    document.getElementById('bulkEditModal').style.display = 'block';
}

function closeBulkEditModal() {
    document.getElementById('bulkEditModal').style.display = 'none';
}

async function applyBulkChanges() {
    const title = document.getElementById('bulkTitle').value.trim();
    const duration = document.getElementById('bulkDuration').value.trim();
    const status = document.getElementById('bulkStatus').value;
    const artistsText = document.getElementById('bulkArtists').value.trim();
    const genresText = document.getElementById('bulkGenres').value.trim();
    
    const changes = {};
    if (title) changes.title = title;
    if (duration) changes.duration = duration;
    if (status) changes.validation_status = status;
    if (artistsText) changes.artists = artistsText.split(',').map(a => a.trim()).filter(a => a);
    if (genresText) changes.genres = genresText.split(',').map(g => g.trim()).filter(g => g);
    
    if (Object.keys(changes).length === 0) {
        showMessage('No changes specified', 'info');
        return;
    }
    
    showLoading();
    closeBulkEditModal();
    
    try {
        const response = await fetch('/api/songs/bulk-update', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                songs: Array.from(selectedSongs),
                changes: changes
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showMessage(`Successfully updated ${selectedSongs.size} songs`, 'success');
            
            selectedSongs.forEach(songId => {
                if (originalData[songId]) {
                    originalData[songId] = { ...originalData[songId], ...changes };
                }
            });
            
            toggleBulkEditMode();
            
            setTimeout(async () => {
                if (lastSearchQuery) {
                    await refreshSearch();
                }
                if (loadQualityCounts) {
                    loadQualityCounts();
                }
                if (loadStats) {
                    loadStats();
                }
            }, 500);
            
        } else {
            throw new Error(result.error || 'Failed to update songs');
        }
    } catch (error) {
        console.error('Bulk update error:', error);
        showMessage(`Failed to update songs: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

function displaySongs(songs) {
    const container = document.getElementById('songsContainer');
    const emptyState = document.getElementById('emptyState');
    
    if (songs.length === 0) {
        emptyState.style.display = 'block';
        container.innerHTML = '<div class="empty-state"><p>No songs found</p></div>';
        return;
    }
    
    emptyState.style.display = 'none';
    
    container.innerHTML = createBulkEditHeader() + songs.map(song => createSongCard(song)).join('');
    
    songs.forEach(song => {
        originalData[song.id] = { ...song };
    });
    
    if (bulkEditMode) {
        addSongCheckboxes();
    }
}

function createBulkEditHeader() {
    return `
        <div class="bulk-edit-header">
            <button class="btn btn-primary" id="bulkEditToggle" onclick="toggleBulkEditMode()">Bulk Edit Mode</button>
            <div id="bulkEditControls" style="display: none;">
                <span id="selectedCount">0</span> songs selected
                <button class="btn btn-primary" onclick="openBulkEditModal()">Edit Selected</button>
                <button class="btn btn-danger" onclick="bulkDeleteSongs()">Delete Selected</button>
            </div>
        </div>
    `;
}

function createSongCard(song) {
    const artists = song.artists || [];
    const genres = song.genres || [];
    
    return `
        <div class="song-card" data-song-id="${song.id}">
            <div class="song-header">
                <div class="song-title">${escapeHtml(song.title)}</div>
                <div class="song-id">ID: ${song.id}</div>
            </div>
            
            <div class="metadata-row">
                <span class="metadata-label">Title:</span>
                <div class="metadata-value">
                    <input type="text" class="editable-field" value="${escapeHtml(song.title)}" 
                           onchange="markChanged(${song.id})" data-field="title">
                </div>
            </div>
            
            <div class="metadata-row">
                <span class="metadata-label">Artists:</span>
                <div class="metadata-value">
                    <div class="tag-container" id="artists-${song.id}" onchange="markChanged(${song.id})">
                        ${artists.map(artist => `
                            <div class="tag">
                                ${escapeHtml(artist)}
                                <span class="tag-remove" onclick="removeTag(this, ${song.id})">×</span>
                            </div>
                        `).join('')}
                        <input type="text" class="add-tag-input" placeholder="Add artist..." 
                               onkeypress="addTag(event, 'artists-${song.id}', ${song.id})">
                    </div>
                </div>
            </div>
            
            <div class="metadata-row">
                <span class="metadata-label">Genres:</span>
                <div class="metadata-value">
                    <div class="tag-container" id="genres-${song.id}" onchange="markChanged(${song.id})">
                        ${genres.map(genre => `
                            <div class="tag">
                                ${escapeHtml(genre)}
                                <span class="tag-remove" onclick="removeTag(this, ${song.id})">×</span>
                            </div>
                        `).join('')}
                        <input type="text" class="add-tag-input" placeholder="Add genre..." 
                               onkeypress="addTag(event, 'genres-${song.id}', ${song.id})">
                    </div>
                </div>
            </div>
            
            <div class="metadata-row">
                <span class="metadata-label">Duration:</span>
                <div class="metadata-value">
                    <input type="text" class="editable-field" value="${song.duration || ''}" 
                           style="width: 100px;" onchange="markChanged(${song.id})" data-field="duration">
                </div>
            </div>
            
            <div class="metadata-row">
                <span class="metadata-label">Status:</span>
                <div class="metadata-value">
                    <span class="status-indicator status-${song.validation_status}"></span>
                    <select class="editable-field" style="width: 140px;" onchange="markChanged(${song.id})" data-field="validation_status">
                        <option value="unverified" ${song.validation_status === 'unverified' ? 'selected' : ''}>Unverified</option>
                        <option value="verified" ${song.validation_status === 'verified' ? 'selected' : ''}>Verified</option>
                        <option value="pending" ${song.validation_status === 'pending' ? 'selected' : ''}>Pending</option>
                    </select>
                </div>
            </div>
            
            <div class="actions">
                <button class="btn btn-primary" onclick="saveSong(${song.id})" id="save-${song.id}" disabled>
                    Save Changes
                </button>
                <button class="btn btn-secondary" onclick="revertSong(${song.id})">
                    Revert
                </button>
                <button class="btn btn-danger" onclick="deleteSong(${song.id})">
                    Delete Song
                </button>
            </div>
        </div>
    `;
}

function removeTag(element, songId) {
    element.parentElement.remove();
    markChanged(songId);
}

function addTag(event, containerId, songId) {
    if (event.key === 'Enter' && event.target.value.trim()) {
        const container = document.getElementById(containerId);
        const input = event.target;
        
        const tag = document.createElement('div');
        tag.className = 'tag';
        tag.innerHTML = `
            ${escapeHtml(input.value.trim())}
            <span class="tag-remove" onclick="removeTag(this, ${songId})">×</span>
        `;
        
        container.insertBefore(tag, input);
        input.value = '';
        markChanged(songId);
    }
}

function markChanged(songId) {
    const saveButton = document.getElementById(`save-${songId}`);
    if (saveButton) {
        saveButton.disabled = false;
        saveButton.style.background = '#28a745';
        saveButton.textContent = 'Save Changes*';
    }
}

function saveSong(songId) {
    const changes = detectChanges(songId);
    if (Object.keys(changes).length === 0) {
        showMessage('No changes detected', 'info');
        return;
    }
    
    currentChanges = { songId, changes };
    showSaveModal(changes);
}

function detectChanges(songId) {
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
    
    const statusSelect = card.querySelector('[data-field="validation_status"]');
    if (statusSelect && statusSelect.value !== originalData[songId].validation_status) {
        changes.validation_status = statusSelect.value;
    }
    
    const artistsContainer = document.getElementById(`artists-${songId}`);
    const currentArtists = Array.from(artistsContainer.querySelectorAll('.tag'))
        .map(tag => tag.textContent.replace('×', '').trim());
    const originalArtists = originalData[songId].artists || [];
    
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

function showSaveModal(changes) {
    const changesList = document.getElementById('changesList');
    changesList.innerHTML = '';
    
    const tableUpdates = [];
    
    if (changes.title || changes.duration || changes.validation_status) {
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
    
    document.getElementById('saveModal').style.display = 'block';
}

async function confirmSave() {
    const { songId, changes } = currentChanges;
    
    showLoading();
    
    try {
        const response = await fetch(`/api/songs/${songId}/update`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(changes)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showMessage('Changes saved successfully!', 'success');
            
            originalData[songId] = { ...originalData[songId], ...changes };
            
            const saveButton = document.getElementById(`save-${songId}`);
            if (saveButton) {
                saveButton.disabled = true;
                saveButton.style.background = '#007bff';
                saveButton.textContent = 'Save Changes';
            }
            
            closeModal();
            
            setTimeout(() => {
                if (loadQualityCounts) {
                    loadQualityCounts();
                }
                if (loadStats) {
                    loadStats();
                }
            }, 500);
            
        } else {
            throw new Error(result.error || 'Failed to save changes');
        }
    } catch (error) {
        console.error('Save error:', error);
        showMessage('Error saving changes: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

function closeModal() {
    document.getElementById('saveModal').style.display = 'none';
}

function revertSong(songId) {
    const original = originalData[songId];
    if (!original) return;
    
    const card = document.querySelector(`[data-song-id="${songId}"]`);
    
    const titleInput = card.querySelector('[data-field="title"]');
    if (titleInput) titleInput.value = original.title;
    
    const durationInput = card.querySelector('[data-field="duration"]');
    if (durationInput) durationInput.value = original.duration || '';
    
    const statusSelect = card.querySelector('[data-field="validation_status"]');
    if (statusSelect) statusSelect.value = original.validation_status;
    
    const artistsContainer = document.getElementById(`artists-${songId}`);
    rebuildTagContainer(artistsContainer, original.artists || [], songId);
    
    const genresContainer = document.getElementById(`genres-${songId}`);
    rebuildTagContainer(genresContainer, original.genres || [], songId);
    
    const saveButton = document.getElementById(`save-${songId}`);
    if (saveButton) {
        saveButton.disabled = true;
        saveButton.style.background = '#007bff';
        saveButton.textContent = 'Save Changes';
    }
}

function rebuildTagContainer(container, items, songId) {
    const input = container.querySelector('.add-tag-input');
    const placeholder = input.placeholder;
    const isArtists = placeholder.includes('artist');
    const containerId = isArtists ? `artists-${songId}` : `genres-${songId}`;
    
    container.innerHTML = `
        ${items.map(item => `
            <div class="tag">
                ${escapeHtml(item)}
                <span class="tag-remove" onclick="removeTag(this, ${songId})">×</span>
            </div>
        `).join('')}
        <input type="text" class="add-tag-input" placeholder="${placeholder}" 
               onkeypress="addTag(event, '${containerId}', ${songId})">
    `;
}

function showLoading() {
    document.getElementById('loadingSpinner').style.display = 'block';
}

function hideLoading() {
    document.getElementById('loadingSpinner').style.display = 'none';
}

function showMessage(message, type) {
    const existingMessage = document.querySelector('.success-message, .error-message');
    if (existingMessage) {
        existingMessage.remove();
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = type === 'error' ? 'error-message' : 'success-message';
    messageDiv.textContent = message;
    
    const firstContainer = document.querySelector('.container');
    firstContainer.parentNode.insertBefore(messageDiv, firstContainer.nextSibling);
    
    setTimeout(() => {
        messageDiv.remove();
    }, 5000);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

document.getElementById('searchInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        searchSongs();
    }
});

document.addEventListener('DOMContentLoaded', function() {
    loadStats();
    loadQualityCounts();
});

function showDeleteConfirmModal(text, confirmCallback) {
    document.getElementById('deleteConfirmText').textContent = text;
    document.getElementById('confirmDeleteBtn').onclick = confirmCallback;
    document.getElementById('deleteConfirmModal').style.display = 'block';
}

function closeDeleteModal() {
    document.getElementById('deleteConfirmModal').style.display = 'none';
}

function confirmDelete() {
    // This will be set dynamically by showDeleteConfirmModal
}

window.onclick = function(event) {
    const modal = document.getElementById('saveModal');
    const bulkModal = document.getElementById('bulkModal');
    const bulkEditModal = document.getElementById('bulkEditModal');
    const deleteModal = document.getElementById('deleteConfirmModal');
    
    if (event.target === modal) {
        closeModal();
    } else if (event.target === bulkModal) {
        closeBulkModal();
    } else if (event.target === bulkEditModal) {
        closeBulkEditModal();
    } else if (event.target === deleteModal) {
        closeDeleteModal();
    }
}
