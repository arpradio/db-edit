let originalData = {};
let currentChanges = {};
let lastSearchQuery = '';
let selectedSongs = new Set();
let bulkEditMode = false;
let currentTokenId = null;
let selectedSongsForLink = new Set();

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
    } else if (tabName === 'tokens') {
        clearTokenResults();
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

async function searchTokens() {
    const query = document.getElementById('tokenSearchInput').value;
    if (!query.trim()) {
        showMessage('Please enter a search term', 'info');
        return;
    }
    
    showLoading();
    
    try {
        const response = await fetch(`/api/tokens/search?q=${encodeURIComponent(query)}`);
        const tokens = await response.json();
        
        displayTokens(tokens);
    } catch (error) {
        console.error('Token search error:', error);
        showError('Failed to search tokens');
    } finally {
        hideLoading();
    }
}

function displayTokens(tokens) {
    const container = document.getElementById('tokensContainer');
    const emptyState = document.getElementById('tokenEmptyState');
    
    if (tokens.length === 0) {
        emptyState.style.display = 'block';
        container.innerHTML = '<div class="empty-state"><p>No tokens found</p></div>';
        return;
    }
    
    emptyState.style.display = 'none';
    
    container.innerHTML = tokens.map(token => createTokenCard(token)).join('');
}

function createTokenCard(token) {
    return `
        <div class="token-card" data-token-id="${token.id}">
            <div class="token-header">
                <div class="token-title">${escapeHtml(token.asset_name)}</div>
                <div class="token-id">ID: ${token.id}</div>
            </div>
            
            <div class="metadata-row">
                <span class="metadata-label">Policy ID:</span>
                <div class="metadata-value">
                    <span class="policy-id">${escapeHtml(token.policy_id)}</span>
                </div>
            </div>
            
            <div class="metadata-row">
                <span class="metadata-label">Release Title:</span>
                <div class="metadata-value">
                    <span>${escapeHtml(token.release_title || 'N/A')}</span>
                </div>
            </div>
            
            <div class="actions">
                <button class="btn btn-primary" onclick="linkTokenToSongs(${token.id})">
                    Link to Songs
                </button>
                <button class="btn btn-secondary" onclick="viewTokenDetails(${token.id})">
                    View Details
                </button>
                <button class="btn btn-danger" onclick="deleteToken(${token.id})">
                    Delete Token
                </button>
            </div>
        </div>
    `;
}

function clearTokenResults() {
    const container = document.getElementById('tokensContainer');
    const emptyState = document.getElementById('tokenEmptyState');
    
    container.innerHTML = '';
    container.appendChild(emptyState);
    emptyState.style.display = 'block';
    
    document.getElementById('tokenSearchInput').value = '';
}

async function linkTokenToSongs(tokenId) {
    currentTokenId = tokenId;
    selectedSongsForLink.clear();
    
    document.getElementById('linkSongSearch').value = '';
    document.getElementById('linkSongResults').innerHTML = '<div class="empty-state"><p>Search for songs to link</p></div>';
    document.getElementById('tokenLinkModal').style.display = 'block';
}

async function searchSongsForLink() {
    const query = document.getElementById('linkSongSearch').value;
    if (!query.trim()) {
        showMessage('Please enter a search term', 'info');
        return;
    }
    
    try {
        const response = await fetch(`/api/songs/search?q=${encodeURIComponent(query)}`);
        const songs = await response.json();
        
        displayLinkSongResults(songs);
    } catch (error) {
        console.error('Song search for link error:', error);
        showMessage('Failed to search songs', 'error');
    }
}

function displayLinkSongResults(songs) {
    const container = document.getElementById('linkSongResults');
    
    if (songs.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No songs found</p></div>';
        return;
    }
    
    container.innerHTML = songs.map(song => `
        <div class="link-song-item" data-song-id="${song.id}">
            <input type="checkbox" class="song-link-checkbox" data-song-id="${song.id}" onchange="toggleSongForLink(${song.id})">
            <div class="song-info">
                <span class="song-title">${escapeHtml(song.title)}</span>
                <span class="song-artists">${(song.artists || []).join(', ')}</span>
            </div>
        </div>
    `).join('');
}

function toggleSongForLink(songId) {
    const checkbox = document.querySelector(`input[data-song-id="${songId}"]`);
    const item = document.querySelector(`div[data-song-id="${songId}"]`);
    
    if (checkbox.checked) {
        selectedSongsForLink.add(songId);
        item.classList.add('selected');
    } else {
        selectedSongsForLink.delete(songId);
        item.classList.remove('selected');
    }
    
    const confirmBtn = document.getElementById('confirmLinkBtn');
    confirmBtn.disabled = selectedSongsForLink.size === 0;
}

async function confirmLinkSongs() {
    if (selectedSongsForLink.size === 0) {
        showMessage('No songs selected', 'info');
        return;
    }
    
    showLoading();
    closeTokenLinkModal();
    
    try {
        const response = await fetch(`/api/tokens/${currentTokenId}/link-songs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                songIds: Array.from(selectedSongsForLink)
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showMessage(`Successfully linked ${selectedSongsForLink.size} songs to token`, 'success');
            selectedSongsForLink.clear();
            loadQualityCounts();
        } else {
            throw new Error(result.error || 'Failed to link songs');
        }
    } catch (error) {
        console.error('Link songs error:', error);
        showMessage(`Failed to link songs: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

function closeTokenLinkModal() {
    document.getElementById('tokenLinkModal').style.display = 'none';
    selectedSongsForLink.clear();
    currentTokenId = null;
}

async function viewTokenDetails(tokenId) {
    showLoading();
    
    try {
        const response = await fetch(`/api/tokens/${tokenId}`);
        const token = await response.json();
        
        if (response.ok) {
            alert(`Token Details:
Asset Name: ${token.asset_name}
Policy ID: ${token.policy_id}
Release Title: ${token.release_title || 'N/A'}
Songs Count: ${token.songs_count}
Processing Status: ${token.processing_status}
Has Images: ${token.has_images ? 'Yes' : 'No'}
Indexed: ${new Date(token.indexed_at).toLocaleString()}`);
        } else {
            throw new Error(token.error || 'Failed to load token details');
        }
    } catch (error) {
        console.error('Token details error:', error);
        showMessage(`Failed to load token details: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

async function deleteToken(tokenId) {
    const card = document.querySelector(`[data-token-id="${tokenId}"]`);
    const tokenName = card.querySelector('.token-title').textContent;
    
    if (!confirm(`Are you sure you want to delete token "${tokenName}"? This action cannot be undone.`)) {
        return;
    }
    
    showLoading();
    
    try {
        const response = await fetch(`/api/tokens/${tokenId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showMessage(`Successfully deleted "${tokenName}"`, 'success');
            card.remove();
            loadQualityCounts();
            loadStats();
        } else {
            throw new Error(result.error || 'Failed to delete token');
        }
    } catch (error) {
        console.error('Delete token error:', error);
        showMessage(`Failed to delete token: ${error.message}`, 'error');
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
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const counts = await response.json();
        
        // Defensive programming - ensure counts is an object
        if (!counts || typeof counts !== 'object') {
            throw new Error('Invalid response format: expected object');
        }
        
        // Update all count elements with fallback to 0
        const countElements = {
            'noArtistsCount': counts.no_artists,
            'noGenresCount': counts.no_genres,
            'noAudioCount': counts.no_audio,
            'noDurationCount': counts.no_duration,
            'noTokensCount': counts.no_tokens,
            'noImagesCount': counts.no_images,
            'orphanArtistsCount': counts.orphan_artists,
            'orphanGenresCount': counts.orphan_genres,
            'orphanTokensCount': counts.orphan_tokens,
            'orphanImagesCount': counts.orphan_images,
            'unprocessedAssetsCount': counts.unprocessed_assets,
            'failedAssetsCount': counts.failed_assets,
            'emptyPlaylistsCount': counts.empty_playlists,
            'inactiveUsersCount': counts.inactive_users
        };
        
        Object.entries(countElements).forEach(([elementId, value]) => {
            const element = document.getElementById(elementId);
            if (element) {
                element.textContent = value || 0;
            }
        });
        
        // Apply styling based on counts
        document.querySelectorAll('.quality-count').forEach(el => {
            const count = parseInt(el.textContent);
            if (count === 0) {
                el.classList.add('zero');
            } else {
                el.classList.remove('zero');
            }
        });
        
    } catch (error) {
        console.error('Failed to load quality counts:', error);
        showMessage(`Failed to load data quality information: ${error.message}`, 'error');
        
        // Set all counts to error state
        document.querySelectorAll('.quality-count').forEach(el => {
            el.textContent = '?';
            el.classList.remove('zero');
        });
    }
}

// Add debug function to help troubleshoot API issues
async function debugAPIResponse(endpoint) {
    try {
        console.log(`🔍 Debug: Fetching ${endpoint}`);
        const response = await fetch(endpoint);
        console.log(`📡 Response status: ${response.status} ${response.statusText}`);
        
        const text = await response.text();
        console.log(`📝 Raw response:`, text);
        
        try {
            const json = JSON.parse(text);
            console.log(`📋 Parsed JSON:`, json);
            console.log(`📊 Type: ${typeof json}, Is Array: ${Array.isArray(json)}`);
            return json;
        } catch (parseError) {
            console.error(`❌ JSON Parse Error:`, parseError);
            throw new Error(`Invalid JSON response: ${text.substring(0, 100)}...`);
        }
    } catch (error) {
        console.error(`💥 Debug Error:`, error);
        throw error;
    }
}

async function loadDataIssues(issueType) {
    currentIssueType = issueType;
    selectedItems.clear();
    showLoading();
    
    try {
        const endpoint = `/api/quality/issues/${issueType}`;
        
        // Use debug function to get better error information
        const result = await debugAPIResponse(endpoint);
        
        // Ensure we have an array
        const issues = Array.isArray(result) ? result : [];
        console.log(`✅ Loaded ${issues.length} issues for ${issueType}`);
        
        displayIssues(issues, issueType);
    } catch (error) {
        console.error('❌ Failed to load issues:', error);
        showMessage(`Failed to load data issues: ${error.message}`, 'error');
        
        // Display empty state on error
        const container = document.getElementById('issuesContainer');
        container.innerHTML = `
            <div class="empty-state">
                <p>❌ Failed to load issues</p>
                <p style="font-size: 12px; color: #666; margin-top: 8px;">
                    Error: ${error.message}
                </p>
                <button class="btn btn-primary" onclick="loadDataIssues('${issueType}')" style="margin-top: 12px;">
                    Try Again
                </button>
            </div>
        `;
    } finally {
        hideLoading();
    }
}

function displayIssues(issues, issueType) {
    const container = document.getElementById('issuesContainer');
    
    // Ensure issues is an array
    if (!Array.isArray(issues)) {
        console.error('Expected issues to be an array, got:', typeof issues, issues);
        container.innerHTML = '<div class="empty-state"><p>Error: Invalid data format received</p></div>';
        return;
    }
    
    if (issues.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No issues found! 🎉</p></div>';
        return;
    }
    
    const issueTitle = getIssueTitle(issueType);
    const showBulkActions = isOrphanIssueType(issueType);
    
    try {
        container.innerHTML = `
            <h4>${issueTitle} (${issues.length} found)</h4>
            ${showBulkActions ? createBulkActionsHTML(issueType) : ''}
            <div class="issues-list">
                ${showBulkActions ? createSelectAllHTML() : ''}
                ${issues.map(issue => createIssueItem(issue, issueType)).join('')}
            </div>
        `;
        
        updateBulkActionsVisibility();
    } catch (error) {
        console.error('Error displaying issues:', error, 'Issues data:', issues);
        container.innerHTML = '<div class="empty-state"><p>Error displaying issues. Check console for details.</p></div>';
    }
}

function isOrphanIssueType(issueType) {
    return ['orphan-artists', 'orphan-genres', 'orphan-tokens', 'orphan-images', 'empty-playlists'].includes(issueType);
}

function createBulkActionsHTML(issueType) {
    const entityType = getEntityTypeFromIssueType(issueType);
    return `
        <div class="bulk-actions" id="bulkActions">
            <div class="bulk-actions-header">
                <span class="selection-info" id="selectionInfo">0 items selected</span>
                <div class="bulk-buttons">
                    <button class="btn btn-small btn-danger" onclick="bulkDeleteSelected()">Delete Selected</button>
                    <button class="btn btn-small btn-danger" onclick="bulkDeleteAll('${issueType}')">Delete All ${entityType}</button>
                </div>
            </div>
        </div>
    `;
}

function getEntityTypeFromIssueType(issueType) {
    if (issueType.includes('artists')) return 'artists';
    if (issueType.includes('genres')) return 'genres';
    if (issueType.includes('tokens')) return 'tokens';
    if (issueType.includes('images')) return 'images';
    if (issueType.includes('playlists')) return 'playlists';
    return 'items';
}

function createSelectAllHTML() {
    return `
        <div class="select-all-container">
            <input type="checkbox" id="selectAllCheckbox" class="issue-checkbox" onchange="toggleSelectAll()">
            <label for="selectAllCheckbox">Select All</label>
        </div>
    `;
}

function createIssueItem(issue, issueType) {
    // Defensive programming - ensure issue is an object
    if (!issue || typeof issue !== 'object') {
        console.warn('Invalid issue object:', issue);
        return '<div class="issue-item"><div class="issue-content"><span class="issue-title">Invalid item</span></div></div>';
    }
    
    try {
        if (issueType.includes('songs') || issueType.includes('no-')) {
            const title = issue.title || issue.name || `Item ${issue.id || 'Unknown'}`;
            const id = issue.id || 0;
            
            return `
                <div class="issue-item" onclick="editSongFromIssue(${id})">
                    <div class="issue-content">
                        <span class="issue-title">${escapeHtml(title)}</span>
                        <span class="issue-id">ID: ${id}</span>
                    </div>
                    <div class="issue-actions">
                        <button class="btn btn-small btn-primary" onclick="event.stopPropagation(); editSongFromIssue(${id})">Edit</button>
                    </div>
                </div>
            `;
        } else if (isOrphanIssueType(issueType)) {
            const name = issue.name || issue.release_title || issue.asset_name || `Item ${issue.id || 'Unknown'}`;
            const id = issue.id || 0;
            
            return `
                <div class="issue-item" data-item-id="${id}">
                    <div class="issue-content">
                        <input type="checkbox" class="issue-checkbox" data-item-id="${id}" onchange="toggleItemSelection(${id})">
                        <span class="issue-title">${escapeHtml(name)}</span>
                        <span class="issue-id">ID: ${id}</span>
                        ${issue.policy_id ? `<span class="issue-detail">Policy: ${escapeHtml(issue.policy_id.substring(0, 10))}...</span>` : ''}
                    </div>
                    <div class="issue-actions">
                        <button class="btn btn-small btn-danger" onclick="deleteOrphan('${issueType}', ${id}, '${escapeHtml(name)}')">Delete</button>
                    </div>
                </div>
            `;
        } else {
            const name = issue.name || issue.title || `Item ${issue.id || 'Unknown'}`;
            const id = issue.id || 0;
            
            return `
                <div class="issue-item">
                    <div class="issue-content">
                        <span class="issue-title">${escapeHtml(name)}</span>
                        <span class="issue-id">ID: ${id}</span>
                    </div>
                    <div class="issue-actions">
                        <button class="btn btn-small btn-primary" onclick="viewIssueDetails('${issueType}', ${id})">View</button>
                    </div>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error creating issue item:', error, 'Issue:', issue, 'Type:', issueType);
        return '<div class="issue-item"><div class="issue-content"><span class="issue-title">Error displaying item</span></div></div>';
    }
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
    
    const entityType = getEntityTypeFromIssueType(currentIssueType);
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
    const entityType = getEntityTypeFromIssueType(issueType);
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
        const endpoint = getEndpointFromIssueType(issueType);
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
            loadDataIssues(currentIssueType);
            loadQualityCounts();
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

function getEndpointFromIssueType(issueType) {
    if (issueType.includes('artists')) return 'artists';
    if (issueType.includes('genres')) return 'genres';
    if (issueType.includes('tokens')) return 'tokens';
    if (issueType.includes('images')) return 'images';
    if (issueType.includes('playlists')) return 'playlists';
    return 'items';
}

function getIssueTitle(issueType) {
    const titles = {
        'no-artists': 'Songs Without Artists',
        'no-genres': 'Songs Without Genres', 
        'no-audio': 'Songs Without Audio Files',
        'no-duration': 'Songs Without Duration',
        'no-tokens': 'Songs Without Tokens',
        'no-images': 'Songs Without Images',
        'orphan-artists': 'Artists With No Songs',
        'orphan-genres': 'Genres With No Songs',
        'orphan-tokens': 'Tokens With No Songs',
        'orphan-images': 'Images With No Tokens',
        'unprocessed-assets': 'Unprocessed Assets',
        'failed-assets': 'Failed Assets',
        'empty-playlists': 'Empty Playlists',
        'inactive-users': 'Inactive Users'
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
        const endpoint = getEndpointFromIssueType(type);
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
        document.getElementById('totalTokens').textContent = stats.total_tokens || 0;
        document.getElementById('totalImages').textContent = stats.total_images || 0;
        document.getElementById('totalUsers').textContent = stats.total_users || 0;
        document.getElementById('totalPlaylists').textContent = stats.total_playlists || 0;
        document.getElementById('verifiedSongs').textContent = stats.verified_songs || 0;
        document.getElementById('unverifiedSongs').textContent = stats.unverified_songs || 0;
        document.getElementById('pendingSongs').textContent = stats.pending_songs || 0;
        document.getElementById('processedTokens').textContent = stats.processed_tokens || 0;
        document.getElementById('linkedTokens').textContent = stats.linked_tokens || 0;
        document.getElementById('totalPlays').textContent = stats.total_plays || 0;
        
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

function showMessage(message, type = 'info') {
    const existingMessage = document.querySelector('.success-message, .error-message, .info-message');
    if (existingMessage) {
        existingMessage.remove();
    }
    
    const messageDiv = document.createElement('div');
    
    switch (type) {
        case 'error':
            messageDiv.className = 'error-message';
            break;
        case 'success':
            messageDiv.className = 'success-message';
            break;
        case 'warning':
            messageDiv.className = 'error-message'; // Use error styling for warnings
            break;
        default:
            messageDiv.className = 'info-message';
    }
    
    messageDiv.textContent = message;
    
    const firstContainer = document.querySelector('.container');
    firstContainer.parentNode.insertBefore(messageDiv, firstContainer.nextSibling);
    
    setTimeout(() => {
        if (messageDiv.parentNode) {
            messageDiv.remove();
        }
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

document.getElementById('tokenSearchInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        searchTokens();
    }
});

document.getElementById('linkSongSearch').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        searchSongsForLink();
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

}

async function viewIssueDetails(issueType, itemId) {
    showLoading();
    
    try {
        let endpoint = '';
        let entityType = '';
        
        if (issueType.includes('assets')) {
            endpoint = `/api/tokens/${itemId}`;
            entityType = 'Token';
        } else if (issueType.includes('playlists')) {
            // For future implementation when playlist details API is added
            showMessage('Playlist details view coming soon', 'info');
            return;
        } else if (issueType.includes('users')) {
            // For future implementation when user details API is added  
            showMessage('User details view coming soon', 'info');
            return;
        } else {
            showMessage('Details view not available for this item type', 'info');
            return;
        }
        
        const response = await fetch(endpoint);
        const details = await response.json();
        
        if (response.ok) {
            // Format details for display
            let detailsText = `${entityType} Details:\n`;
            Object.entries(details).forEach(([key, value]) => {
                const formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                detailsText += `${formattedKey}: ${value}\n`;
            });
            
            alert(detailsText);
        } else {
            throw new Error(details.error || 'Failed to load details');
        }
    } catch (error) {
        console.error('View details error:', error);
        showMessage(`Failed to load details: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

async function runHealthCheck() {
    showLoading();
    
    try {
        console.log('🏥 Running health check...');
        
        const response = await fetch('/api/debug/health');
        const healthData = await response.json();
        
        const healthContainer = document.getElementById('healthCheckResults');
        const healthDetails = document.getElementById('healthDetails');
        
        if (response.ok) {
            console.log('✅ Health check passed:', healthData);
            healthDetails.textContent = JSON.stringify(healthData, null, 2);
            healthContainer.style.display = 'block';
            
            if (healthData.status === 'healthy') {
                showMessage('Health check passed! System is working properly.', 'success');
            } else {
                showMessage('Health check completed with warnings. Check details below.', 'warning');
            }
        } else {
            console.error('❌ Health check failed:', healthData);
            healthDetails.textContent = JSON.stringify(healthData, null, 2);
            healthContainer.style.display = 'block';
            showMessage(`Health check failed: ${healthData.error}`, 'error');
        }
    } catch (error) {
        console.error('💥 Health check error:', error);
        
        const healthContainer = document.getElementById('healthCheckResults');
        const healthDetails = document.getElementById('healthDetails');
        
        healthDetails.textContent = `Error running health check: ${error.message}`;
        healthContainer.style.display = 'block';
        showMessage(`Health check failed: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

// Also add this helper function for better error messages
function showError(message) {
    showMessage(message, 'error');
}

window.onclick = function(event) {
    const modal = document.getElementById('saveModal');
    const bulkModal = document.getElementById('bulkModal');
    const bulkEditModal = document.getElementById('bulkEditModal');
    const deleteModal = document.getElementById('deleteConfirmModal');
    const tokenLinkModal = document.getElementById('tokenLinkModal');
    
    if (event.target === modal) {
        closeModal();
    } else if (event.target === bulkModal) {
        closeBulkModal();
    } else if (event.target === bulkEditModal) {
        closeBulkEditModal();
    } else if (event.target === deleteModal) {
        closeDeleteModal();
    } else if (event.target === tokenLinkModal) {
        closeTokenLinkModal();
    }
}