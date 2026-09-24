# Music Database Editor

A lightweight web application for editing complex relationships in your ArpRADIO music database. Simplifies editing song metadata, artists, and genres while maintaining referential integrity across all related tables.

## Features

- **Visual Relationship Editing**: Tag-based interface for managing artists and genres
- **Auto-Creation**: Automatically creates new artists/genres when needed
- **Transaction Safety**: All related table updates happen atomically
- **Search Functionality**: Full-text search across songs, artists, and genres
- **Change Preview**: Shows exactly which database tables will be updated
- **Responsive Design**: Works on desktop and mobile devices

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Database
Copy `.env.example` to `.env` and update with your database credentials:
```bash
cp .env .env.local
```

Edit `.env.local`:
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=your_database_name
DB_USER=your_username
DB_PASSWORD=your_password
```

### 3. Set Up Database Functions
Run the additional SQL functions in your database:
```bash
psql -d your_database -f database/setup.sql
```

### 4. Start the Server
```bash
npm start
```

Visit `http://localhost:3000` to access the editor.

## How It Works

### Database Operations

When you edit a song's relationships, the application:

1. **Songs Table**: Updates basic metadata (title, duration, status)
2. **Junction Tables**: Rebuilds artist and genre relationships
3. **Entity Tables**: Auto-creates new artists or genres as needed
4. **Transaction Safety**: All changes happen in a single database transaction

### Example Operations

**Change Artist**: "John Doe" → "Jane Smith"
- Updates `metadata.song_artists` table
- Creates "Jane Smith" in `metadata.artists` if doesn't exist
- Maintains all other relationships

**Add Genre**: Add "Electronic" to existing song
- Creates "Electronic" in `metadata.genres` if needed
- Adds relationship in `metadata.song_genres`

**Update Multiple Fields**: Change title, add artist, remove genre
- Single atomic transaction updates all affected tables
- Rollback if any operation fails

## Indexer Progress Relay

The **Indexer** tab shows live sync status from `arp-indexer`. The server connects to the indexer's progress WebSocket and re-broadcasts it to the browser at `/ws/indexer`. Configure it in `.env`:

| Variable | Default | Description |
|---|---|---|
| `INDEXER_ENABLED` | `true` | Set to `false` to disable the relay entirely |
| `INDEXER_HOST` | `localhost` | Host running arp-indexer |
| `INDEXER_PORT` | `3001` | Must match arp-indexer's `PROGRESS_PORT` |
| `INDEXER_WS_URL` | — | Full URL (e.g. `wss://indexer.example.com`); overrides host/port |
| `INDEXER_RECONNECT_MS` | `5000` | Delay before reconnecting after the upstream drops |
| `OGMIOS_HEALTH_URL` | — | Ogmios `/health` endpoint (e.g. `http://host:1337/health`) shown in the header; unset to hide |
| `OGMIOS_HEALTH_INTERVAL_MS` | `10000` | How often the server polls Ogmios health |

## File Structure

```
music-db-editor/
├── package.json              # Dependencies and scripts
├── server.js                 # Express.js API server
├── .env                      # Database configuration
├── database/
│   └── setup.sql            # Additional database functions
├── public/
│   ├── index.html           # Main web interface
│   ├── css/
│   │   └── styles.css       # Application styling
│   └── js/
│       └── app.js           # Frontend JavaScript
└── config/
    └── database.js          # Database connection setup
```

## API Endpoints

### Search Songs
```
GET /api/songs/search?q=searchterm
```
Returns songs matching the search term across titles, artists, and genres.

### Get Song Details
```
GET /api/songs/:id
```
Returns complete song information including all relationships.

### Update Song
```
POST /api/songs/:id/update
```
Updates song metadata and relationships. Expects JSON body with changes.

### Search Artists/Genres
```
GET /api/artists/search?q=term
GET /api/genres/search?q=term
```
Returns matching artists or genres for autocomplete functionality.

## Usage Examples

### Basic Song Editing
1. Search for a song using the search bar
2. Click on any field to edit (title, duration, status)
3. Add/remove artists and genres using the tag interface
4. Click "Save Changes" to preview the database operations
5. Confirm to execute the transaction

### Bulk Artist Changes
To change an artist across multiple songs:
1. Search for the artist name
2. Edit each song individually, or
3. Use the SQL functions directly for bulk operations

### Adding New Content
- **New Artists**: Just type the name in the artist field - they'll be created automatically
- **New Genres**: Same for genres - type and they'll be created when you save
- **New Songs**: Use your existing database tools to create songs, then edit relationships here

## Database Functions

The application includes several helpful SQL functions you can use directly:

```sql
-- Edit a single artist relationship
SELECT edit_song_artist(1, 'Old Artist', 'New Artist');

-- Add an artist with specific role
SELECT add_song_artist(1, 'Featured Artist', 'featured');

-- Update all genres for a song
SELECT update_song_genres(1, ARRAY['Rock', 'Alternative']);

-- View song details
SELECT * FROM get_song_details(1);

-- Get database statistics
SELECT * FROM get_song_stats();

-- Find duplicate artists for cleanup
SELECT * FROM find_duplicate_artists();
```

## Security Considerations

- **Input Validation**: All inputs are sanitized to prevent SQL injection
- **Transaction Safety**: Database operations are wrapped in transactions
- **Error Handling**: Failed operations are rolled back automatically
- **Access Control**: Add authentication middleware as needed for production

## Development

### Adding Features
- **Backend**: Add new routes in `server.js`
- **Frontend**: Extend `public/js/app.js` for new UI features
- **Database**: Add functions in `database/setup.sql`

### Running in Development
```bash
npm run dev  # Uses nodemon for auto-restart
```

### Production Deployment
```bash
npm start
```

Set `NODE_ENV=production` for production optimizations.

## Troubleshooting

### Database Connection Issues
- Verify credentials in `.env`
- Check PostgreSQL is running
- Ensure database exists and user has proper permissions

### Search Not Working
- Check if the setup.sql functions were installed
- Verify search indexes were created successfully

### Transaction Failures
- Check database logs for constraint violations
- Ensure all referenced songs/artists exist
- Verify no circular dependencies in relationships

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - feel free to use this in your own projects.