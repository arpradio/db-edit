import { APIClient } from './api.js';
import { UIComponents } from './ui.js';

export class StatsManager {
    static async loadStats() {
        try {
            const stats = await APIClient.get('/api/stats');
            
            const statElements = {
                'totalSongs': stats.total_songs || 0,
                'totalArtists': stats.total_artists || 0,
                'totalGenres': stats.total_genres || 0,
                'verifiedSongs': stats.verified_songs || 0,
                'unverifiedSongs': stats.unverified_songs || 0,
                'pendingSongs': stats.pending_songs || 0
            };
            
            Object.entries(statElements).forEach(([id, value]) => {
                const element = document.getElementById(id);
                if (element) element.textContent = value;
            });
            
        } catch (error) {
            console.error('Failed to load statistics:', error);
            UIComponents.showMessage('Failed to load statistics', 'error');
        }
    }
}
