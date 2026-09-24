import { APIClient } from './api.js';
import { UIComponents } from './ui.js';
import { state, refreshCountsAndStats } from './state.js';
import { SongEditor } from './song-editor.js';

// Role is free text in the DB; these are suggestions, with "Other..." for anything else
const CONTRIBUTOR_ROLE_GROUPS = {
    Performance: ['performer', 'featured artist', 'vocalist', 'backing vocalist', 'instrumentalist', 'DJ', 'remixer'],
    Writing: ['composer', 'lyricist', 'songwriter', 'arranger'],
    Production: ['producer', 'co-producer', 'recording engineer', 'mixing engineer', 'mastering engineer'],
    Business: ['publisher', 'label']
};
const CUSTOM_ROLE_VALUE = '__custom';

let contributorSearchTimeout = null;

export class RelationshipManager {
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
                
                ${RelationshipManager.createContributorsSection(song, song.contributors || [])}

                ${RelationshipManager.createTokensSection(song, tokens)}
            </div>
        `;
    }

    static createContributorsSection(song, contributors) {
        const sorted = [...contributors].sort((a, b) =>
            (a.role || '').localeCompare(b.role || '') || (a.name || '').localeCompare(b.name || ''));

        return `
                <div class="relations-title" style="margin-top: 16px;">
                    Contributors (${contributors.length})
                    <button class="btn btn-small btn-primary" onclick="RelationshipManager.toggleAddContributorForm(${song.id})">Add Contributor</button>
                </div>

                <div id="addContributorForm-${song.id}" class="add-form">
                    <div class="form-row">
                        <select id="contributorRole-${song.id}" onchange="RelationshipManager.onContributorRoleChange(${song.id})">
                            <option value="" selected disabled>Select role...</option>
                            ${Object.entries(CONTRIBUTOR_ROLE_GROUPS).map(([group, roles]) => `
                                <optgroup label="${group}">
                                    ${roles.map(role => `<option value="${role}">${role}</option>`).join('')}
                                </optgroup>
                            `).join('')}
                            <option value="${CUSTOM_ROLE_VALUE}">Other...</option>
                        </select>
                        <input type="text" placeholder="Custom role" id="contributorRoleCustom-${song.id}" hidden>
                    </div>
                    <div class="form-row">
                        <div class="search-dropdown">
                            <input type="text" placeholder="Search or create contributor..." id="contributorSearch-${song.id}"
                                   oninput="RelationshipManager.searchContributors(${song.id}, this.value)"
                                   onkeydown="if (event.key === 'Escape') RelationshipManager.toggleAddContributorForm(${song.id})"
                                   autocomplete="off">
                            <div class="search-results" id="contributorResults-${song.id}"></div>
                        </div>
                        <button class="btn btn-small btn-secondary" onclick="RelationshipManager.toggleAddContributorForm(${song.id})">Cancel</button>
                    </div>
                </div>

                ${sorted.map(contributor => `
                    <div class="relation-item">
                        <div class="relation-info">
                            <div class="relation-type">${UIComponents.escapeHtml(contributor.role)}</div>
                            <div class="relation-name">${UIComponents.escapeHtml(contributor.name)}</div>
                            ${contributor.ipi || contributor.isni ? `
                                <div class="relation-meta">
                                    ${contributor.ipi ? `IPI: ${UIComponents.escapeHtml(contributor.ipi)}` : ''}
                                    ${contributor.ipi && contributor.isni ? ' · ' : ''}
                                    ${contributor.isni ? `ISNI: ${UIComponents.escapeHtml(contributor.isni)}` : ''}
                                </div>` : ''}
                        </div>
                        <div class="relation-actions">
                            <button class="btn btn-small btn-danger"
                                    data-role="${UIComponents.escapeHtml(contributor.role)}"
                                    data-name="${UIComponents.escapeHtml(contributor.name)}"
                                    onclick="RelationshipManager.unlinkContributor(${song.id}, ${contributor.id}, this.dataset.role, this.dataset.name)">Unlink</button>
                        </div>
                    </div>
                `).join('')}`;
    }

    static toggleAddContributorForm(songId) {
        const form = document.getElementById(`addContributorForm-${songId}`);
        form.classList.toggle('active');

        if (form.classList.contains('active')) {
            document.getElementById(`contributorSearch-${songId}`).focus();
        } else {
            document.getElementById(`contributorResults-${songId}`).style.display = 'none';
        }
    }

    static searchContributors(songId, query) {
        clearTimeout(contributorSearchTimeout);
        const resultsContainer = document.getElementById(`contributorResults-${songId}`);
        const trimmed = query.trim();

        if (trimmed.length < 2) {
            resultsContainer.style.display = 'none';
            return;
        }

        contributorSearchTimeout = setTimeout(async () => {
            try {
                const contributors = await APIClient.get(`/api/contributors/search?q=${encodeURIComponent(trimmed)}`);

                const exactMatch = contributors.some(c => (c.name || '').toLowerCase() === trimmed.toLowerCase());
                resultsContainer.innerHTML = contributors.map(contributor => `
                    <div class="search-result-item" onclick="RelationshipManager.selectContributor(${songId}, ${contributor.id})">
                        <div><strong>${UIComponents.escapeHtml(contributor.name)}</strong></div>
                        ${contributor.ipi || contributor.isni ? `
                            <div style="font-size: 11px; color: #6c757d;">
                                ${contributor.ipi ? `IPI ${UIComponents.escapeHtml(contributor.ipi)}` : ''}
                                ${contributor.isni ? `ISNI ${UIComponents.escapeHtml(contributor.isni)}` : ''}
                            </div>` : ''}
                    </div>
                `).join('') + (exactMatch ? '' : `
                    <div class="search-result-item search-result-create" onclick="RelationshipManager.createAndLinkContributor(${songId})">
                        + Create "${UIComponents.escapeHtml(trimmed)}"
                    </div>
                `);
                resultsContainer.style.display = 'block';
            } catch (error) {
                console.error('Search contributors error:', error);
                resultsContainer.style.display = 'none';
            }
        }, 300);
    }

    static onContributorRoleChange(songId) {
        const isCustom = document.getElementById(`contributorRole-${songId}`).value === CUSTOM_ROLE_VALUE;
        const customInput = document.getElementById(`contributorRoleCustom-${songId}`);
        customInput.hidden = !isCustom;
        if (isCustom) customInput.focus();
    }

    // Returns null (and prompts) when no role has been chosen yet
    static getContributorRole(songId) {
        const select = document.getElementById(`contributorRole-${songId}`);
        const role = select.value === CUSTOM_ROLE_VALUE
            ? document.getElementById(`contributorRoleCustom-${songId}`).value.trim()
            : select.value;

        if (!role) {
            UIComponents.showMessage('Choose a role for this contributor first', 'error');
            (select.value === CUSTOM_ROLE_VALUE ? document.getElementById(`contributorRoleCustom-${songId}`) : select).focus();
            return null;
        }
        return role;
    }

    static async selectContributor(songId, contributorId) {
        const role = RelationshipManager.getContributorRole(songId);
        if (!role) return;
        await RelationshipManager.linkContributor(songId, contributorId, role);
    }

    static async createAndLinkContributor(songId) {
        const name = document.getElementById(`contributorSearch-${songId}`).value.trim();
        if (!name) return;
        // Check the role before creating, so a missing role doesn't leave an unlinked contributor behind
        const role = RelationshipManager.getContributorRole(songId);
        if (!role) return;

        try {
            const result = await APIClient.post('/api/contributors', { name });
            await RelationshipManager.linkContributor(songId, result.contributor.id, role);
        } catch (error) {
            console.error('Create contributor error:', error);
            UIComponents.showMessage(`Failed to create contributor: ${error.message}`, 'error');
        }
    }

    static async linkContributor(songId, contributorId, role) {
        document.getElementById(`contributorResults-${songId}`).style.display = 'none';

        try {
            await APIClient.post(`/api/songs/${songId}/contributors/${contributorId}/link`, { role });
            UIComponents.showMessage('Contributor linked successfully', 'success');
            await RelationshipManager.refreshSongData(songId);
            refreshCountsAndStats();
        } catch (error) {
            console.error('Link contributor error:', error);
            UIComponents.showMessage(`Failed to link contributor: ${error.message}`, 'error');
        }
    }

    static async unlinkContributor(songId, contributorId, role, name) {
        if (!confirm(`Remove ${name ? `"${name}"` : 'this contributor'} (${role}) from this song?`)) {
            return;
        }

        try {
            await APIClient.delete(`/api/songs/${songId}/contributors/${contributorId}/unlink?role=${encodeURIComponent(role)}`);
            UIComponents.showMessage('Contributor removed successfully', 'success');
            await RelationshipManager.refreshSongData(songId);
            refreshCountsAndStats();
        } catch (error) {
            console.error('Unlink contributor error:', error);
            UIComponents.showMessage(`Failed to remove contributor: ${error.message}`, 'error');
        }
    }

    // Tokens can number in the dozens, so the list is collapsed by default behind a summary row.
    static createTokensSection(song, tokens) {
        const addTokenForm = `
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
                </div>`;

        if (tokens.length === 0) {
            return `
                <div class="relations-title missing-relation" style="margin-top: 16px;">
                    Blockchain Tokens (0)
                    <button class="btn btn-small btn-warning" onclick="RelationshipManager.toggleAddTokenForm(${song.id})">
                        ⚠️ Link Token (Required)
                    </button>
                </div>
                <div class="missing-relation-warning">⚠️ <strong>WARNING:</strong> This song has no blockchain tokens associated. Every song should have at least one token.</div>
                ${addTokenForm}`;
        }

        const policyCount = new Set(tokens.map(token => token.policy_id)).size;
        const sortedTokens = [...tokens].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        return `
                <details class="relation-collapse" id="tokensCollapse-${song.id}">
                    <summary class="relations-title relation-collapse-summary">
                        <span class="relation-collapse-label">
                            Blockchain Tokens (${tokens.length})
                            <span class="relation-collapse-hint">${policyCount} ${policyCount === 1 ? 'policy' : 'policies'}</span>
                        </span>
                        <button class="btn btn-small btn-primary" onclick="event.preventDefault(); RelationshipManager.toggleAddTokenForm(${song.id})">Link Token</button>
                    </summary>
                    <div class="relation-collapse-body">
                        ${tokens.length > 5 ? `
                            <input type="text" class="relation-filter" placeholder="Filter ${tokens.length} tokens..."
                                   oninput="RelationshipManager.filterTokens(${song.id}, this.value)" autocomplete="off">
                        ` : ''}
                        ${sortedTokens.map(token => `
                            <div class="relation-item" id="token-${token.id}" data-filter-text="${UIComponents.escapeHtml(`${token.name || ''} ${token.asset_name || ''} ${token.policy_id}`.toLowerCase())}">
                                <div class="relation-info">
                                    <div class="relation-type" title="${UIComponents.escapeHtml(token.policy_id)}">${token.policy_id.substring(0, 8)}...</div>
                                    <div class="relation-name">${UIComponents.escapeHtml(token.name)}</div>
                                </div>
                                <div class="relation-actions">
                                    <button class="btn btn-small btn-danger" onclick="RelationshipManager.unlinkToken(${song.id}, ${token.id})">Unlink</button>
                                </div>
                            </div>
                        `).join('')}
                        <div class="relation-filter-empty" id="tokenFilterEmpty-${song.id}" hidden>No tokens match</div>
                    </div>
                </details>
                ${addTokenForm}`;
    }

    static filterTokens(songId, query) {
        const needle = query.trim().toLowerCase();
        const items = document.querySelectorAll(`#tokensCollapse-${songId} .relation-item`);
        let visible = 0;
        items.forEach(item => {
            const match = !needle || item.dataset.filterText.includes(needle);
            item.hidden = !match;
            if (match) visible++;
        });
        const empty = document.getElementById(`tokenFilterEmpty-${songId}`);
        if (empty) empty.hidden = visible > 0;
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
        if (state.searchTimeout) {
            clearTimeout(state.searchTimeout);
        }
        
        const resultsContainer = document.getElementById(`tokenResults-${songId}`);
        
        if (!query || query.length < 2) {
            resultsContainer.style.display = 'none';
            return;
        }
        
        state.searchTimeout = setTimeout(async () => {
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
            await RelationshipManager.refreshSongData(songId, { expandTokens: true });
            refreshCountsAndStats();
        } catch (error) {
            console.error('Link token error:', error);
            UIComponents.showMessage(`Failed to link token: ${error.message}`, 'error');
        }
    }

    static async unlinkToken(songId, tokenId) {
        const tokenName = document.querySelector(`#token-${tokenId} .relation-name`)?.textContent.trim();
        if (!confirm(`Unlink ${tokenName ? `"${tokenName}"` : 'this token'} from this song?`)) {
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

    static async refreshSongData(songId, { expandTokens = false } = {}) {
        try {
            const song = await APIClient.get(`/api/songs/${songId}`);
            const songCard = document.querySelector(`[data-song-id="${songId}"]`);

            // Capture unsaved field edits before originalData is replaced, since detectChanges diffs against it
            const pendingChanges = songCard && state.dirtySongs.has(songId) ? SongEditor.detectChanges(songId) : {};
            state.originalData[songId] = { ...song };

            if (songCard) {
                // Re-rendering the card would otherwise snap the token list back to collapsed
                const wasExpanded = document.getElementById(`tokensCollapse-${songId}`)?.open;
                songCard.outerHTML = UIComponents.createSongCard(song);
                const collapse = document.getElementById(`tokensCollapse-${songId}`);
                if (collapse && (wasExpanded || expandTokens)) collapse.open = true;
                SongEditor.applyChanges(songId, pendingChanges);
            }
        } catch (error) {
            console.error('Refresh song data error:', error);
        }
    }
}
