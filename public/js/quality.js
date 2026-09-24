import { APIClient } from './api.js';
import { UIComponents } from './ui.js';
import { BulkActionManager } from './bulk-actions.js';
import { state, refreshCountsAndStats, refreshCurrentIssues } from './state.js';

export class QualityManager {
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
        state.currentIssueType = issueType;
        state.selectedItems.clear();
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
