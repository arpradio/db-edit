import { UIComponents } from './ui.js';
import { StateManager } from './state.js';
import { ModalManager } from './modals.js';
import { QualityManager } from './quality.js';
import { BulkActionManager } from './bulk-actions.js';
import { SearchManager } from './search.js';
import { SongEditor } from './song-editor.js';
import { RelationshipManager } from './relationships.js';
import { TokenManager } from './tokens.js';
import { AssetManager } from './assets.js';
import { StatsManager } from './stats.js';
import { IndexerPanel } from './indexer.js';
import { GlobalSave } from './global-save.js';

// These classes are invoked as bare `ClassName.method(...)` from inline
// onclick/onchange/oninput attributes in index.html and in HTML strings
// built by the modules themselves, so they need to be reachable on window.
window.StateManager = StateManager;
window.QualityManager = QualityManager;
window.BulkActionManager = BulkActionManager;
window.SearchManager = SearchManager;
window.SongEditor = SongEditor;
window.RelationshipManager = RelationshipManager;
window.TokenManager = TokenManager;
window.AssetManager = AssetManager;
window.GlobalSave = GlobalSave;

// Thin global wrappers for the bare function names index.html calls directly.
window.showTab = function showTab(tabName) {
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
};

window.searchSongs = async function searchSongs() {
    await SearchManager.searchSongs();
};

window.clearResults = function clearResults() {
    SearchManager.clearResults();
};

window.loadDataIssues = async function loadDataIssues(issueType) {
    await QualityManager.loadDataIssues(issueType);
};

window.loadStats = async function loadStats() {
    await StatsManager.loadStats();
};

window.markChanged = function markChanged(songId) {
    StateManager.markSongChanged(songId);
};

window.removeTag = function removeTag(element, songId) {
    SongEditor.removeTag(element, songId);
};

window.addTag = function addTag(event, containerId, songId) {
    SongEditor.addTag(event, containerId, songId);
};

window.saveSong = function saveSong(songId) {
    SongEditor.saveSong(songId);
};

window.confirmSave = async function confirmSave() {
    await SongEditor.confirmSave();
};

window.closeModal = function closeModal() {
    ModalManager.hide('saveModal');
};

window.closeBulkModal = function closeBulkModal() {
    ModalManager.hide('bulkModal');
};

window.closeBulkEditModal = function closeBulkEditModal() {
    ModalManager.hide('bulkEditModal');
};

window.closeDeleteModal = function closeDeleteModal() {
    ModalManager.hide('deleteConfirmModal');
};

window.revertSong = function revertSong(songId) {
    SongEditor.revertSong(songId);
};

// The bulk-edit modal's "Apply Changes" button called this by bare name with
// no wrapper defined anywhere, throwing a ReferenceError on click.
window.applyBulkChanges = async function applyBulkChanges() {
    await BulkActionManager.applyBulkChanges();
};

document.getElementById('searchInput').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        searchSongs();
    }
});

document.addEventListener('DOMContentLoaded', async function () {
    await Promise.all([StatsManager.loadStats(), QualityManager.loadQualityCounts()]);
});

document.addEventListener('click', function (event) {
    const searchResults = document.querySelectorAll('.search-results');
    searchResults.forEach(result => {
        const dropdown = result.closest('.search-dropdown');
        if (dropdown && !dropdown.contains(event.target)) {
            result.style.display = 'none';
        }
    });
});

window.onclick = function (event) {
    const modals = ['saveModal', 'saveAllModal', 'bulkModal', 'bulkEditModal', 'deleteConfirmModal', 'linkTokenModal', 'fixTokenModal', 'bulkTokenLinkModal', 'editTokenModal', 'bulkEditTokensModal', 'bulkAddImageModal', 'bulkAddAudioModal'];
    modals.forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (modal && event.target === modal) {
            modal.style.display = 'none';
        }
    });
};

IndexerPanel.init();
GlobalSave.init();
